import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import { getMinimalPromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import i18n from "../i18n";

const GROQ_CHAT_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const ENHANCEMENT_TIMEOUT_MS = 5000;
const MAX_VOCABULARY_TERMS = 50;

export class EnhancerApiError extends Error {
  constructor(
    public statusCode: number,
    statusText: string,
    public body: string,
  ) {
    super(`Enhancement API error: ${statusCode} ${statusText}`);
    this.name = "EnhancerApiError";
  }
}

export function getDefaultSystemPrompt(): string {
  return getMinimalPromptForLocale(i18n.language as SupportedLocale);
}

export interface EnhanceOptions {
  systemPrompt?: string;
  vocabularyTermList?: string[];
  surroundingText?: string;
  modelId?: string;
  signal?: AbortSignal;
}

interface GroqChatChoice {
  message: {
    content: string;
  };
}

interface GroqChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_time: number;
  completion_time: number;
  total_time: number;
}

interface GroqChatResponse {
  choices: GroqChatChoice[];
  usage?: GroqChatUsage;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const raceList: Promise<T>[] = [promise];

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error("Enhancement timeout");
      (err as Error & { code: string }).code = "ENHANCEMENT_TIMEOUT";
      reject(err);
    }, ms);
  });
  raceList.push(timeoutPromise as Promise<T>);

  let abortHandler: (() => void) | undefined;
  if (signal) {
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      abortHandler = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    raceList.push(abortPromise as Promise<T>);
  }

  try {
    return await Promise.race(raceList);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
  }
}

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
  surroundingText?: string,
): string {
  let prompt = basePrompt;

  if (surroundingText) {
    prompt += `\n\n<surrounding_text>\n${surroundingText}\n</surrounding_text>`;
  }

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

function parseUsage(usage?: GroqChatUsage): ChatUsageData | null {
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

/**
 * 移除 reasoning model（如 Qwen3）回應中的 <think>...</think> 區塊，
 * 只保留最終輸出內容。
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<EnhanceResult> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API Key not configured");
  }

  const basePrompt = options?.systemPrompt || getDefaultSystemPrompt();
  const fullPrompt = buildSystemPrompt(
    basePrompt,
    options?.vocabularyTermList,
    options?.surroundingText,
  );

  const body = JSON.stringify({
    model: options?.modelId ?? DEFAULT_LLM_MODEL_ID,
    messages: [
      { role: "system", content: fullPrompt },
      { role: "user", content: rawText },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });

  const response = await withTimeout(
    fetch(GROQ_CHAT_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: options?.signal,
    }),
    ENHANCEMENT_TIMEOUT_MS,
    options?.signal,
  );

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new EnhancerApiError(response.status, response.statusText, errorBody);
  }

  const data = (await response.json()) as GroqChatResponse;
  const usage = parseUsage(data.usage);

  if (!data.choices || data.choices.length === 0) {
    return { text: rawText, usage };
  }

  const rawContent = data.choices[0]?.message.content?.trim();
  if (!rawContent) {
    return { text: rawText, usage };
  }

  const enhancedContent = stripReasoningTags(rawContent);
  return { text: enhancedContent || rawText, usage };
}
