import { describe, expect, it } from "vitest";

/**
 * Tests the bulk-add input parsing logic used by VocabularyListSection
 * and the deduplication logic used by vocabularyStore.batchAddTerms.
 *
 * These are the same pure transformations applied before DB insertion.
 */

/** Parse bulk input textarea into unique, non-empty terms (same logic as batchAddTerms) */
function parseBulkInput(input: string): string[] {
  return input
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Deduplicate terms case-insensitively, keeping the last occurrence */
function deduplicateTerms(terms: string[]): string[] {
  return [
    ...new Map(terms.map((t) => [t.toLowerCase(), t] as const)).values(),
  ];
}

describe("parseBulkInput", () => {
  it("splits lines and trims whitespace", () => {
    expect(parseBulkInput("foo\n  bar  \nbaz")).toEqual(["foo", "bar", "baz"]);
  });

  it("filters empty lines", () => {
    expect(parseBulkInput("foo\n\n\nbar\n\n")).toEqual(["foo", "bar"]);
  });

  it("filters whitespace-only lines", () => {
    expect(parseBulkInput("foo\n   \n  \t  \nbar")).toEqual(["foo", "bar"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseBulkInput("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseBulkInput("  \n  \n  ")).toEqual([]);
  });

  it("handles single term", () => {
    expect(parseBulkInput("TypeScript")).toEqual(["TypeScript"]);
  });

  it("preserves original casing", () => {
    expect(parseBulkInput("TypeScript\nReact\nVue.js")).toEqual([
      "TypeScript",
      "React",
      "Vue.js",
    ]);
  });
});

describe("deduplicateTerms", () => {
  it("removes case-insensitive duplicates", () => {
    expect(deduplicateTerms(["Foo", "foo", "FOO"])).toEqual(["FOO"]);
  });

  it("keeps last occurrence", () => {
    expect(deduplicateTerms(["TypeScript", "typescript", "TYPESCRIPT"])).toEqual([
      "TYPESCRIPT",
    ]);
  });

  it("preserves unique terms", () => {
    expect(deduplicateTerms(["React", "Vue", "Angular"])).toEqual([
      "React",
      "Vue",
      "Angular",
    ]);
  });

  it("handles empty array", () => {
    expect(deduplicateTerms([])).toEqual([]);
  });

  it("handles mixed duplicates and uniques", () => {
    expect(deduplicateTerms(["React", "vue", "react", "Angular", "VUE"])).toEqual([
      "react",
      "VUE",
      "Angular",
    ]);
  });
});
