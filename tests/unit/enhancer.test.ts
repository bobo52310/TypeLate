import { describe, expect, it } from "vitest";
import { buildSystemPrompt, stripReasoningTags } from "@/lib/enhancer";

describe("buildSystemPrompt", () => {
  const BASE_PROMPT = "Fix typos and add punctuation.";

  it("returns base prompt when no vocabulary", () => {
    expect(buildSystemPrompt(BASE_PROMPT)).toBe(BASE_PROMPT);
  });

  it("returns base prompt for empty vocabulary list", () => {
    expect(buildSystemPrompt(BASE_PROMPT, [])).toBe(BASE_PROMPT);
  });

  it("appends vocabulary section for non-empty list", () => {
    const result = buildSystemPrompt(BASE_PROMPT, ["React", "TypeScript"]);
    expect(result).toContain(BASE_PROMPT);
    expect(result).toContain("<vocabulary>");
    expect(result).toContain("React, TypeScript");
    expect(result).toContain("</vocabulary>");
  });

  it("truncates vocabulary to 50 terms", () => {
    const terms = Array.from({ length: 100 }, (_, i) => `term${i}`);
    const result = buildSystemPrompt(BASE_PROMPT, terms);
    // Should contain term0 through term49, but not term50+
    expect(result).toContain("term0");
    expect(result).toContain("term49");
    expect(result).not.toContain("term50");
  });

  it("handles undefined vocabulary", () => {
    expect(buildSystemPrompt(BASE_PROMPT, undefined)).toBe(BASE_PROMPT);
  });
});

describe("stripReasoningTags", () => {
  it("removes <think> blocks from text", () => {
    const input = "<think>Let me reason about this...</think>Hello, world.";
    expect(stripReasoningTags(input)).toBe("Hello, world.");
  });

  it("removes multiple <think> blocks", () => {
    const input = "<think>First thought</think>Hello<think>Second thought</think> world.";
    expect(stripReasoningTags(input)).toBe("Hello world.");
  });

  it("handles multiline <think> blocks", () => {
    const input = `<think>
Line 1
Line 2
</think>Clean output.`;
    expect(stripReasoningTags(input)).toBe("Clean output.");
  });

  it("returns text as-is when no <think> tags present", () => {
    expect(stripReasoningTags("Just normal text.")).toBe("Just normal text.");
  });

  it("trims whitespace after removing tags", () => {
    expect(stripReasoningTags("  <think>x</think>  result  ")).toBe("result");
  });

  it("handles empty string", () => {
    expect(stripReasoningTags("")).toBe("");
  });

  it("handles only <think> block with no output", () => {
    expect(stripReasoningTags("<think>reasoning only</think>")).toBe("");
  });
});
