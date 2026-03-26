/**
 * Tests for the surrounding-text context feature across all layers:
 * - buildSystemPrompt: correct <surrounding_text> XML placement
 * - getSurroundingTextInstruction: locale-aware instruction strings
 * - composeContextAwarePrompt + surrounding text: full prompt composition
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/enhancer";
import {
  getSurroundingTextInstruction,
  composeContextAwarePrompt,
} from "@/lib/contextPrompts";
import type { SupportedLocale } from "@/i18n/languageConfig";

const BASE = "Fix typos and add punctuation.";

// ─── buildSystemPrompt: surroundingText parameter ───

describe("buildSystemPrompt — surrounding text", () => {
  it("appends <surrounding_text> section when provided", () => {
    const result = buildSystemPrompt(BASE, undefined, "Dear Mr. Chen,");
    expect(result).toContain("<surrounding_text>");
    expect(result).toContain("Dear Mr. Chen,");
    expect(result).toContain("</surrounding_text>");
  });

  it("does NOT add surrounding_text when undefined", () => {
    const result = buildSystemPrompt(BASE, undefined, undefined);
    expect(result).not.toContain("<surrounding_text>");
    expect(result).toBe(BASE);
  });

  it("does NOT add surrounding_text when empty string", () => {
    const result = buildSystemPrompt(BASE, undefined, "");
    expect(result).not.toContain("<surrounding_text>");
    expect(result).toBe(BASE);
  });

  it("surrounding_text appears BEFORE vocabulary", () => {
    const result = buildSystemPrompt(BASE, ["React"], "some context");
    const stIdx = result.indexOf("<surrounding_text>");
    const vocabIdx = result.indexOf("<vocabulary>");
    expect(stIdx).toBeGreaterThan(-1);
    expect(vocabIdx).toBeGreaterThan(-1);
    expect(stIdx).toBeLessThan(vocabIdx);
  });

  it("all three sections in correct order: base → surrounding → vocabulary", () => {
    const result = buildSystemPrompt(BASE, ["TypeScript"], "existing paragraph");
    const baseIdx = result.indexOf(BASE);
    const stIdx = result.indexOf("<surrounding_text>");
    const vocabIdx = result.indexOf("<vocabulary>");
    expect(baseIdx).toBeLessThan(stIdx);
    expect(stIdx).toBeLessThan(vocabIdx);
  });

  it("preserves CJK characters in surrounding text", () => {
    const cjk = "這是一段中文，測試游標附近的文字";
    const result = buildSystemPrompt(BASE, undefined, cjk);
    expect(result).toContain(cjk);
  });

  it("preserves newlines within surrounding text", () => {
    const multiline = "Line 1\nLine 2\nLine 3";
    const result = buildSystemPrompt(BASE, undefined, multiline);
    expect(result).toContain(multiline);
  });

  it("works with surroundingText but no vocabulary", () => {
    const result = buildSystemPrompt(BASE, [], "some context");
    expect(result).toContain("<surrounding_text>");
    expect(result).not.toContain("<vocabulary>");
  });

  it("works with vocabulary but no surroundingText", () => {
    const result = buildSystemPrompt(BASE, ["React"], undefined);
    expect(result).not.toContain("<surrounding_text>");
    expect(result).toContain("<vocabulary>");
  });
});

// ─── getSurroundingTextInstruction ───

describe("getSurroundingTextInstruction", () => {
  it("returns non-empty string for 'en'", () => {
    const result = getSurroundingTextInstruction("en");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("surrounding_text");
  });

  it("returns zh-TW instruction with correct keywords", () => {
    const result = getSurroundingTextInstruction("zh-TW");
    expect(result).toContain("surrounding_text");
    expect(result).toContain("書寫風格");
  });

  it("returns zh-CN instruction", () => {
    const result = getSurroundingTextInstruction("zh-CN");
    expect(result).toContain("surrounding_text");
    expect(result).toContain("书写风格");
  });

  it("returns ja instruction", () => {
    const result = getSurroundingTextInstruction("ja");
    expect(result).toContain("surrounding_text");
  });

  it("returns ko instruction", () => {
    const result = getSurroundingTextInstruction("ko");
    expect(result).toContain("surrounding_text");
  });

  it("falls back to English for unsupported locale", () => {
    const result = getSurroundingTextInstruction("fr" as SupportedLocale);
    // Should return English fallback
    expect(result).toBe(getSurroundingTextInstruction("en"));
  });

  it("every supported locale returns a non-empty string", () => {
    const locales: SupportedLocale[] = ["en", "zh-TW", "zh-CN", "ja", "ko"];
    for (const locale of locales) {
      expect(getSurroundingTextInstruction(locale).length).toBeGreaterThan(0);
    }
  });
});

// ─── Full prompt composition (integration-style) ───

describe("full prompt composition with surrounding text", () => {
  it("context-aware email + surrounding text produces correct structure", () => {
    // Simulate what the pipeline does:
    // 1. getContextAwarePrompt → category prefix + base + surrounding instruction
    const prompt = composeContextAwarePrompt(BASE, "email", "en");
    const instruction = getSurroundingTextInstruction("en");
    const systemPrompt = `${prompt}\n${instruction}`;

    // 2. buildSystemPrompt → adds <surrounding_text> + <vocabulary>
    const full = buildSystemPrompt(
      systemPrompt,
      ["TypeScript", "React"],
      "Dear Mr. Chen, Thank you for your",
    );

    // Verify all pieces are present
    expect(full).toContain("[Context: Email]");
    expect(full).toContain(BASE);
    expect(full).toContain(instruction);
    expect(full).toContain("<surrounding_text>");
    expect(full).toContain("Dear Mr. Chen, Thank you for your");
    expect(full).toContain("</surrounding_text>");
    expect(full).toContain("<vocabulary>");
    expect(full).toContain("TypeScript, React");
  });

  it("default category omits prefix but can still have surrounding text", () => {
    const prompt = composeContextAwarePrompt(BASE, "default", "en");
    expect(prompt).toBe(BASE); // default → no prefix

    const full = buildSystemPrompt(prompt, undefined, "some existing text");
    expect(full).toContain(BASE);
    expect(full).toContain("<surrounding_text>");
    expect(full).toContain("some existing text");
    expect(full).not.toContain("[Context:");
  });

  it("disabled context-aware: only base prompt + surrounding text", () => {
    // When context-aware is off, pipeline uses getAiPrompt() (base only)
    const full = buildSystemPrompt(BASE, ["term1"], "cursor adjacent text");
    expect(full).toContain(BASE);
    expect(full).toContain("<surrounding_text>");
    expect(full).toContain("<vocabulary>");
    // No [Context: ...] prefix
    expect(full).not.toContain("[Context:");
  });

  it("no surrounding text captured → instruction present but no XML block", () => {
    // Simulate: context-aware ON, but capture returned null
    const prompt = composeContextAwarePrompt(BASE, "ide", "zh-TW");
    const instruction = getSurroundingTextInstruction("zh-TW");
    const systemPrompt = `${prompt}\n${instruction}`;

    const full = buildSystemPrompt(systemPrompt, ["React"], undefined);
    expect(full).toContain("[情境：程式編輯器]");
    expect(full).toContain(instruction);
    // The instruction TEXT mentions <surrounding_text> as a reference,
    // but the actual XML block (with newline-delimited content) should NOT be present
    expect(full).not.toMatch(/<surrounding_text>\n/);
    expect(full).toContain("<vocabulary>");
  });
});
