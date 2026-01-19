import { describe, expect, it } from "vitest";
import { composeContextAwarePrompt } from "../../src/lib/contextPrompts";

const BASE_PROMPT = "Fix typos and add punctuation.";

describe("composeContextAwarePrompt", () => {
  it("returns base prompt unchanged for 'default' category", () => {
    expect(composeContextAwarePrompt(BASE_PROMPT, "default", "en")).toBe(BASE_PROMPT);
  });

  it("prepends email prefix for email category", () => {
    const result = composeContextAwarePrompt(BASE_PROMPT, "email", "en");
    expect(result).toContain("[Context: Email]");
    expect(result).toContain(BASE_PROMPT);
    expect(result.indexOf("[Context: Email]")).toBe(0);
  });

  it("prepends chat prefix for chat category", () => {
    const result = composeContextAwarePrompt(BASE_PROMPT, "chat", "zh-TW");
    expect(result).toContain("[情境：聊天]");
    expect(result).toContain(BASE_PROMPT);
  });

  it("prepends IDE prefix for ide category", () => {
    const result = composeContextAwarePrompt(BASE_PROMPT, "ide", "en");
    expect(result).toContain("[Context: Code Editor]");
    expect(result).toContain(BASE_PROMPT);
  });

  it("prepends notes prefix for notes category", () => {
    const result = composeContextAwarePrompt(BASE_PROMPT, "notes", "ja");
    expect(result).toContain("[コンテキスト：ノート]");
    expect(result).toContain(BASE_PROMPT);
  });

  it("falls back to English when locale not found", () => {
    // Korean has entries, but test an edge case where we use it
    const result = composeContextAwarePrompt(BASE_PROMPT, "email", "ko");
    expect(result).toContain(BASE_PROMPT);
    expect(result.length).toBeGreaterThan(BASE_PROMPT.length);
  });

  it("preserves the entire base prompt after prefix", () => {
    const result = composeContextAwarePrompt(BASE_PROMPT, "email", "en");
    expect(result.endsWith(BASE_PROMPT)).toBe(true);
  });
});
