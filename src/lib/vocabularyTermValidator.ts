/**
 * Clipboard-captured vocabulary term classifier.
 *
 * Used by the correction-detection flow to decide whether a clipboard snippet
 * looks like a proper-noun / technical term worth auto-adding to the dictionary,
 * a full sentence that should be rejected outright, or an ambiguous mid-length
 * phrase that warrants a Layer-2 LLM refinement pass.
 *
 * Pure function — no I/O, no global state. Cheap enough to run on every
 * clipboard poll tick (~2/sec).
 */

export const MAX_TERM_CHAR_LENGTH = 30;
export const MAX_CHINESE_CHARS_ACCEPT = 6;
export const MAX_CHINESE_CHARS_NEEDS_LLM = 15;
export const MAX_ENGLISH_WORDS_ACCEPT = 3;
export const MAX_ENGLISH_WORDS_NEEDS_LLM = 8;

const NEWLINE_PATTERN = /[\n\r]/;
// Sentence-ending punctuation: CJK 。！？ always rejects; Western .!? must be
// followed by whitespace or end-of-string so identifiers like Vue.js / Node.js
// pass through.
const SENTENCE_END_PATTERN = /[。！？]|[!?](?:\s|$)|\.(?:\s|$)/;
const CJK_LIST_SEP_PATTERN = /[，；]/;
const WESTERN_LIST_SEP_PATTERN = /[,;]/;
const CHINESE_CHAR_PATTERN = /[一-鿿]/;
const CHINESE_CHAR_GLOBAL = /[一-鿿]/g;

// Words that strongly suggest the text is a sentence rather than a noun.
// Curated from the user's reported sentence-pollution cases; conservative —
// only includes openers unlikely to start a proper noun.
export const SENTENCE_STARTER_WORDS: readonly string[] = [
  // Interrogatives & requests
  "如何",
  "為什麼",
  "怎麼",
  "為何",
  "給我",
  "請問",
  "幫我",
  "可以",
  "能不能",
  "是不是",
  // Conjunctions / conditionals
  "只要",
  "因為",
  "所以",
  "如果",
  "雖然",
  "但是",
  "不過",
  "雖說",
  "儘管",
  // Common verb openers seen in the user's dictionary pollution
  "參考",
  "整體",
  "摘要",
  "設計",
  "提供",
  "新增",
];

export type RejectReason =
  | "empty"
  | "too-long"
  | "newline"
  | "sentence-punctuation"
  | "list-separator"
  | "sentence-starter"
  | "too-many-chinese-chars"
  | "too-many-words";

export type ClipboardTermClassification =
  | { kind: "reject"; reason: RejectReason }
  | { kind: "accept" }
  | { kind: "needs-llm" };

export function classifyClipboardTerm(rawText: string): ClipboardTermClassification {
  const text = rawText.trim();
  if (!text) return { kind: "reject", reason: "empty" };

  if (text.length > MAX_TERM_CHAR_LENGTH) {
    return { kind: "reject", reason: "too-long" };
  }
  if (NEWLINE_PATTERN.test(text)) {
    return { kind: "reject", reason: "newline" };
  }
  if (SENTENCE_END_PATTERN.test(text)) {
    return { kind: "reject", reason: "sentence-punctuation" };
  }

  const hasChinese = CHINESE_CHAR_PATTERN.test(text);

  if (CJK_LIST_SEP_PATTERN.test(text)) {
    return { kind: "reject", reason: "list-separator" };
  }
  // Western commas are tolerated in pure-English snippets ("Pro, Monthly")
  // but in mixed CJK contexts they almost always indicate a sentence.
  if (hasChinese && WESTERN_LIST_SEP_PATTERN.test(text)) {
    return { kind: "reject", reason: "list-separator" };
  }

  for (const starter of SENTENCE_STARTER_WORDS) {
    if (text.startsWith(starter)) {
      return { kind: "reject", reason: "sentence-starter" };
    }
  }

  if (hasChinese) {
    const chineseChars = (text.match(CHINESE_CHAR_GLOBAL) ?? []).length;
    if (chineseChars <= MAX_CHINESE_CHARS_ACCEPT) return { kind: "accept" };
    if (chineseChars <= MAX_CHINESE_CHARS_NEEDS_LLM) return { kind: "needs-llm" };
    return { kind: "reject", reason: "too-many-chinese-chars" };
  }

  const wordCount = text.split(/\s+/).filter((token) => token.length > 0).length;
  if (wordCount <= MAX_ENGLISH_WORDS_ACCEPT) return { kind: "accept" };
  if (wordCount <= MAX_ENGLISH_WORDS_NEEDS_LLM) return { kind: "needs-llm" };
  return { kind: "reject", reason: "too-many-words" };
}
