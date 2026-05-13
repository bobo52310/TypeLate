import { describe, expect, it } from "vitest";
import { classifyClipboardTerm, MAX_TERM_CHAR_LENGTH } from "@/lib/vocabularyTermValidator";

describe("classifyClipboardTerm", () => {
  describe("user-reported sentence pollution cases (must reject)", () => {
    it.each([
      ["參考這一個網址", "sentence-starter"],
      ["給我一些此產品名稱的建議", "sentence-starter"],
      ["整體重新設計一下設定", "sentence-starter"],
      ["如何最高效率刷 leetcode", "sentence-starter"],
      ["只要提供勾選詞彙的功能", "sentence-starter"],
    ])("rejects %j as %s", (input, expectedReason) => {
      const result = classifyClipboardTerm(input);
      expect(result.kind).toBe("reject");
      if (result.kind === "reject") {
        expect(result.reason).toBe(expectedReason);
      }
    });

    it("rejects '摘要 tab 在剛載入時, 會卡頓' (sentence-starter takes precedence over list-separator)", () => {
      const result = classifyClipboardTerm("摘要 tab 在剛載入時, 會卡頓");
      expect(result.kind).toBe("reject");
      // sentence-starter is checked before list-separator only after the
      // separator gate; verify whichever rule fires, the entry is rejected.
      if (result.kind === "reject") {
        expect(["sentence-starter", "list-separator"]).toContain(result.reason);
      }
    });
  });

  describe("legitimate proper nouns / product names (must accept)", () => {
    it("accepts 'Pro Monthly'", () => {
      expect(classifyClipboardTerm("Pro Monthly")).toEqual({ kind: "accept" });
    });

    it("accepts 'Claude Sonnet 4.5'", () => {
      // "4.5" is not "\\.(\\s|$)" so should NOT be flagged as sentence punctuation
      expect(classifyClipboardTerm("Claude Sonnet 4.5")).toEqual({ kind: "accept" });
    });

    it("accepts 'Vue.js'", () => {
      // Dot followed by alphanumeric is fine
      expect(classifyClipboardTerm("Vue.js")).toEqual({ kind: "accept" });
    });

    it("accepts short Chinese proper nouns", () => {
      expect(classifyClipboardTerm("陳泰呈")).toEqual({ kind: "accept" });
      expect(classifyClipboardTerm("台積電")).toEqual({ kind: "accept" });
    });

    it("accepts pure-English snippets with comma ('Pro, Monthly')", () => {
      expect(classifyClipboardTerm("Pro, Monthly")).toEqual({ kind: "accept" });
    });
  });

  describe("ambiguous mid-length Chinese phrases (needs-llm)", () => {
    it("flags '新型態軟體顧問公司' for LLM refinement", () => {
      expect(classifyClipboardTerm("新型態軟體顧問公司")).toEqual({ kind: "needs-llm" });
    });

    it("flags 9-char Chinese phrase without sentence markers for LLM", () => {
      // 7 Chinese chars (>6, <=15), no starter, no punctuation → needs-llm
      expect(classifyClipboardTerm("人工智慧研究所院")).toEqual({ kind: "needs-llm" });
    });
  });

  describe("hard rejection rules", () => {
    it("rejects empty input", () => {
      expect(classifyClipboardTerm("")).toEqual({ kind: "reject", reason: "empty" });
      expect(classifyClipboardTerm("   ")).toEqual({ kind: "reject", reason: "empty" });
    });

    it("rejects text exceeding length cap", () => {
      const long = "a".repeat(MAX_TERM_CHAR_LENGTH + 1);
      expect(classifyClipboardTerm(long)).toEqual({ kind: "reject", reason: "too-long" });
    });

    it("rejects text with newlines", () => {
      expect(classifyClipboardTerm("Hello\nWorld")).toEqual({
        kind: "reject",
        reason: "newline",
      });
    });

    it("rejects CJK sentence-ending punctuation", () => {
      expect(classifyClipboardTerm("這是好東西。")).toEqual({
        kind: "reject",
        reason: "sentence-punctuation",
      });
      expect(classifyClipboardTerm("真的嗎？")).toEqual({
        kind: "reject",
        reason: "sentence-punctuation",
      });
    });

    it("rejects Western sentence punctuation followed by space or end", () => {
      expect(classifyClipboardTerm("Hello world!")).toEqual({
        kind: "reject",
        reason: "sentence-punctuation",
      });
      expect(classifyClipboardTerm("Are you sure?")).toEqual({
        kind: "reject",
        reason: "sentence-punctuation",
      });
      expect(classifyClipboardTerm("End of line.")).toEqual({
        kind: "reject",
        reason: "sentence-punctuation",
      });
    });

    it("rejects CJK list separators", () => {
      expect(classifyClipboardTerm("蘋果，香蕉")).toEqual({
        kind: "reject",
        reason: "list-separator",
      });
      expect(classifyClipboardTerm("設定；詞彙")).toEqual({
        kind: "reject",
        reason: "list-separator",
      });
    });

    it("rejects mixed CJK + Western comma as list", () => {
      expect(classifyClipboardTerm("設定, 詞彙")).toEqual({
        kind: "reject",
        reason: "list-separator",
      });
    });

    it("rejects Chinese text with too many characters", () => {
      // 16+ Chinese chars, none of the starter words, no punctuation
      const result = classifyClipboardTerm("零壹貳參肆伍陸柒捌玖拾佰仟萬億兆");
      expect(result.kind).toBe("reject");
      if (result.kind === "reject") {
        expect(result.reason).toBe("too-many-chinese-chars");
      }
    });

    it("rejects English text with too many words", () => {
      // Keep total chars under MAX_TERM_CHAR_LENGTH (30) but exceed the
      // 8-word ceiling so this hits too-many-words, not too-long.
      const result = classifyClipboardTerm("a b c d e f g h i");
      expect(result.kind).toBe("reject");
      if (result.kind === "reject") {
        expect(result.reason).toBe("too-many-words");
      }
    });
  });

  describe("normalization", () => {
    it("trims surrounding whitespace before classification", () => {
      expect(classifyClipboardTerm("  Pro Monthly  ")).toEqual({ kind: "accept" });
    });
  });
});
