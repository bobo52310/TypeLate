/**
 * Regression test: ensures refreshCrossWindowSettings syncs the same
 * state keys as loadSettings.
 *
 * Background: the HUD window calls refreshCrossWindowSettings() when
 * the Dashboard changes a setting. If a key is set in loadSettings()
 * but omitted from refreshCrossWindowSettings(), the HUD silently
 * uses the default value — the toggle appears to do nothing.
 *
 * This test reads settingsStore.ts, extracts the set({...}) keys from
 * both functions, and asserts parity. Any intentionally excluded keys
 * must be listed in REFRESH_EXCLUDED_KEYS with a reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Keys intentionally excluded from refreshCrossWindowSettings.
// Each entry must document WHY it is safe to exclude.
const REFRESH_EXCLUDED_KEYS: Record<string, string> = {
  // Sound preset only affects Dashboard preview — HUD never reads these.
  soundPresetId: "Sound preset only used in Dashboard settings UI",
  customSoundPaths: "Custom sound paths only used in Dashboard settings UI",
  // Context-aware settings are read from persistent store at recording start,
  // not from the in-memory store, so cross-window sync is not required.
  isContextAwareEnabled: "Read from persistent store at recording start",
  contextAppOverrides: "Read from persistent store at recording start",
};

/**
 * Extract top-level keys from a `set({...})` call inside a named function.
 *
 * Strategy:
 * 1. Find function implementation via `name: async (`
 * 2. Find all `set({` calls within the function body
 * 3. Use the LARGEST one (by character count) — the main state update call
 * 4. Parse top-level object keys, skipping nested objects
 */
function extractSetKeys(source: string, functionName: string): string[] {
  // Step 1: Find function implementation (skip type declarations)
  const implPattern = new RegExp(`${functionName}:\\s*async\\s*\\(\\)`);
  const implMatch = source.match(implPattern);
  if (!implMatch || implMatch.index === undefined) {
    throw new Error(`Implementation of "${functionName}" not found in settingsStore.ts`);
  }
  const funcStart = implMatch.index;

  // Step 2: Find all `set({...})` blocks after this function declaration
  // by scanning for `set({` and matching braces
  const afterFunc = source.slice(funcStart);
  const setBlocks: { start: number; body: string }[] = [];
  const setRegex = /\bset\(\{/g;
  let setMatch: RegExpExecArray | null;

  while ((setMatch = setRegex.exec(afterFunc)) !== null) {
    const absStart = funcStart + setMatch.index;
    const objectStart = source.indexOf("{", absStart + 4);

    // Match braces to find the end
    let depth = 0;
    let objectEnd = -1;
    for (let i = objectStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          objectEnd = i;
          break;
        }
      }
    }

    if (objectEnd !== -1) {
      setBlocks.push({
        start: absStart,
        body: source.slice(objectStart + 1, objectEnd),
      });
    }

    // Stop searching after finding a reasonable number of set() calls
    // or if we've gone too far (into the next function)
    if (setBlocks.length >= 10) break;
  }

  if (setBlocks.length === 0) {
    throw new Error(`No set({...}) found inside "${functionName}"`);
  }

  // Step 3: Use the largest block (the main state update)
  const mainBlock = setBlocks.reduce((a, b) => (a.body.length > b.body.length ? a : b));

  // Step 4: Extract top-level keys
  // Check for key BEFORE counting braces so `key: {` on a new line is captured.
  const keys: string[] = [];
  let braceDepth = 0;
  for (const line of mainBlock.body.split("\n")) {
    const trimmed = line.trim();
    // At top level, extract key name
    if (braceDepth === 0) {
      const keyMatch = trimmed.match(/^(\w+)\s*:/);
      if (keyMatch) {
        keys.push(keyMatch[1]);
      }
    }
    // Then update brace depth
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    braceDepth = Math.max(0, braceDepth);
  }

  return keys.sort();
}

describe("settingsStore cross-window sync parity", () => {
  const storePath = resolve(import.meta.dirname!, "../../src/stores/settingsStore.ts");
  const source = readFileSync(storePath, "utf-8");

  const loadKeys = extractSetKeys(source, "loadSettings");
  const refreshKeys = extractSetKeys(source, "refreshCrossWindowSettings");

  it("loadSettings set() has keys (sanity check)", () => {
    expect(loadKeys.length).toBeGreaterThan(10);
  });

  it("refreshCrossWindowSettings set() has keys (sanity check)", () => {
    expect(refreshKeys.length).toBeGreaterThan(10);
  });

  it("refreshCrossWindowSettings includes all loadSettings keys (minus documented exclusions)", () => {
    const allowedExclusions = new Set(Object.keys(REFRESH_EXCLUDED_KEYS));
    const missing = loadKeys.filter(
      (key) => !refreshKeys.includes(key) && !allowedExclusions.has(key),
    );

    if (missing.length > 0) {
      throw new Error(
        [
          `refreshCrossWindowSettings is missing ${missing.length} key(s) that loadSettings sets:`,
          ...missing.map((k) => `  - ${k}`),
          "",
          "If intentionally excluded, add to REFRESH_EXCLUDED_KEYS with a reason.",
          "Otherwise, add the key to refreshCrossWindowSettings to fix cross-window sync.",
        ].join("\n"),
      );
    }
  });

  it("REFRESH_EXCLUDED_KEYS only lists keys that actually exist in loadSettings", () => {
    const stale = Object.keys(REFRESH_EXCLUDED_KEYS).filter(
      (key) => !loadKeys.includes(key),
    );

    if (stale.length > 0) {
      throw new Error(
        [
          `REFRESH_EXCLUDED_KEYS contains ${stale.length} key(s) not in loadSettings:`,
          ...stale.map((k) => `  - ${k}`),
          "",
          "Remove stale entries from REFRESH_EXCLUDED_KEYS.",
        ].join("\n"),
      );
    }
  });
});
