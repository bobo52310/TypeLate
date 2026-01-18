import {
  findWhisperModelConfig,
  findLlmModelConfig,
  findVocabularyAnalysisModelConfig,
  DEFAULT_WHISPER_MODEL_ID,
  DEFAULT_LLM_MODEL_ID,
} from "./modelRegistry";

const WHISPER_MIN_BILLING_MS = 10_000;

/**
 * 計算 Whisper API 費用上限。
 * Groq 最低計費 10 秒/次，不足 10 秒一律按 10 秒算。
 * 從 modelRegistry 查表取得對應模型的每小時費率。
 */
export function calculateWhisperCostCeiling(
  audioDurationMs: number,
  modelId: string = DEFAULT_WHISPER_MODEL_ID,
): number {
  const config = findWhisperModelConfig(modelId);
  const costPerHour = config?.costPerHour ?? 0.111;
  const billedMs = Math.max(audioDurationMs, WHISPER_MIN_BILLING_MS);
  return (billedMs / 3_600_000) * costPerHour;
}

/**
 * 計算 Chat LLM API 費用上限。
 * 全部 token 按較貴的價格算（input vs output 取大），保證是上限。
 */
export function calculateChatCostCeiling(
  totalTokens: number,
  modelId: string = DEFAULT_LLM_MODEL_ID,
): number {
  const config = findLlmModelConfig(modelId) ?? findVocabularyAnalysisModelConfig(modelId);
  const maxCostPerToken = config
    ? Math.max(config.inputCostPerMillion, config.outputCostPerMillion) / 1_000_000
    : 0.00000079;
  return totalTokens * maxCostPerToken;
}
