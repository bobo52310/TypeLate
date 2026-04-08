import { fetch } from "@tauri-apps/plugin-http";
import { DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID } from "./modelRegistry";
import type { ApiUsageInfo } from "./vocabularyAnalyzer";

const SYSTEM_PROMPT = `你是詞彙擷取助手。從使用者提供的文本中，擷取值得加入語音辨識字典的詞彙。

【擷取條件 — 詞彙必須是】
✅ 專有名詞（人名、地名、品牌、公司名、產品名）
✅ 技術術語（框架、程式語言、工具、協定、API）
✅ 特定領域用語（行業術語、學術用語、縮寫）
✅ 常出現但語音辨識容易寫錯的詞彙

【排除】
❌ 一般常用詞彙（今天、因為、the、good）
❌ 單一中文字（至少 2 字）
❌ 純數字
❌ 標點符號

【回傳格式】
JSON array，每個元素：
{ "term": "詞彙", "category": "分類", "relevance": "high|medium|low" }

分類建議：技術、人物、產品、公司、地名、醫療、法律、金融、學術、其他
relevance 判斷：
- high: 文本中反覆出現或為核心主題
- medium: 出現數次且為專業用語
- low: 出現少數次但值得收錄

擷取 5 到 50 個詞彙。只要 JSON array，不要解釋。`;

export interface ExtractedTerm {
  term: string;
  category: string;
  relevance: "high" | "medium" | "low";
}

export interface TextExtractionResult {
  terms: ExtractedTerm[];
  usage: ApiUsageInfo | null;
}

interface GroqChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_time: number;
  completion_time: number;
  total_time: number;
}

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage?: GroqChatUsage;
}

function parseUsage(usage?: GroqChatUsage): ApiUsageInfo | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    promptTimeMs: Math.round(usage.prompt_time * 1000),
    completionTimeMs: Math.round(usage.completion_time * 1000),
    totalTimeMs: Math.round(usage.total_time * 1000),
  };
}

const MIN_CHINESE_CHAR_COUNT = 2;
const MIN_ENGLISH_CHAR_COUNT = 2;
const VALID_RELEVANCE = new Set(["high", "medium", "low"]);

function isTermTooShort(term: string): boolean {
  const trimmed = term.trim();
  const chineseCharCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chineseCharCount > 0) {
    return chineseCharCount < MIN_CHINESE_CHAR_COUNT;
  }
  return trimmed.length < MIN_ENGLISH_CHAR_COUNT;
}

function isValidExtractedTerm(item: unknown): item is ExtractedTerm {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.term === "string" &&
    obj.term.trim().length > 0 &&
    !isTermTooShort(obj.term) &&
    typeof obj.category === "string"
  );
}

function normalizeRelevance(value: unknown): "high" | "medium" | "low" {
  if (typeof value === "string" && VALID_RELEVANCE.has(value)) {
    return value as "high" | "medium" | "low";
  }
  return "medium";
}

function parseExtractedTerms(content: string): ExtractedTerm[] {
  const tryParse = (json: string): ExtractedTerm[] => {
    const parsed = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : parsed?.terms ?? parsed?.keywords;
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidExtractedTerm).map((item) => ({
      term: item.term.trim(),
      category: (item.category as string) || "other",
      relevance: normalizeRelevance(item.relevance),
    }));
  };

  try {
    return tryParse(content.trim());
  } catch {
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        return tryParse(match[0]);
      } catch {
        // parse failed
      }
    }
  }
  return [];
}

export const MAX_TEXT_LENGTH = 10_000;

export async function extractVocabularyFromText(
  text: string,
  apiKey: string,
  options?: { modelId?: string; chatApiUrl?: string },
): Promise<TextExtractionResult> {
  const trimmedText = text.trim().slice(0, MAX_TEXT_LENGTH);

  const body = JSON.stringify({
    model: options?.modelId ?? DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: trimmedText },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  const chatUrl = options?.chatApiUrl ?? "https://api.groq.com/openai/v1/chat/completions";

  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Text analysis API error: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  const data = (await response.json()) as ChatResponse;
  const usage = parseUsage(data.usage);

  if (!data.choices || data.choices.length === 0) {
    return { terms: [], usage };
  }

  const content = data.choices[0]?.message.content?.trim() ?? "";
  const terms = parseExtractedTerms(content);

  // Deduplicate by term (case-insensitive)
  const seen = new Set<string>();
  const uniqueTerms = terms.filter((t) => {
    const key = t.term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { terms: uniqueTerms, usage };
}
