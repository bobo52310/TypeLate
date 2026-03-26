/**
 * 幻覺偵測模組 — 純函式，不依賴 Vue/Pinia/Tauri。
 *
 * 三層偵測邏輯：
 *  Layer 1: 語速異常（錄音 < 1 秒但文字 > 10 字）
 *  Layer 2: 無人聲偵測（靜音 / 低 RMS + 高 NSP 聯合判斷）
 *  Layer 3: 已知幻覺文本 blocklist（Whisper 常見字幕浮水印短語）
 */

// ── 常數 ──

/** Layer 1 錄音時長門檻（ms） */
export const SPEED_ANOMALY_MAX_DURATION_MS = 1000;
/** Layer 1 文字長度門檻 */
export const SPEED_ANOMALY_MIN_CHARS = 10;
/** Layer 2a 靜音峰值能量門檻（0.0 = 完全靜音, 1.0 = 最大音量） */
export const SILENCE_PEAK_ENERGY_THRESHOLD = 0.02;
/** Layer 2b 低 RMS 門檻 — 搭配高 NSP 聯合判斷（人聲 RMS ≥ 0.03，背景噪音 RMS ≈ 0.005~0.02） */
export const SILENCE_RMS_THRESHOLD = 0.015;
/** Layer 2b NSP 門檻（Whisper 認為「可能無語音」的信心度） */
export const SILENCE_NSP_THRESHOLD = 0.7;
/** Layer 2b peak energy 天花板 — peak >= 此值表示有明確可聽聲音，跳過 RMS+NSP 聯合判斷
 *  （避免小聲說話因 RMS 被靜音段稀釋而誤判為幻覺） */
export const LAYER2B_PEAK_ENERGY_CEILING = 0.03;
/** Layer 2c 極高 NSP 門檻 — NSP 超過此值時，無論 peak 多高都視為無人聲。
 *  背景噪音（風扇、冷氣）會推高 peak，但 Whisper 自己很確定沒語音時應直接攔截。
 *  真人說話的 NSP 幾乎不會超過 0.9。 */
export const HIGH_CONFIDENCE_NSP_THRESHOLD = 0.9;

// ── 型別 ──

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  noSpeechProbability: number;
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: "speed-anomaly" | "no-speech-detected" | "known-hallucination-pattern" | null;
  detectedText: string;
}

/**
 * Whisper 已知幻覺文本 blocklist。
 * 靜音或環境噪音時，Whisper 常「幻覺」出訓練資料中的字幕浮水印或制式短語。
 * 比對方式：完全匹配（去除空白後）或包含匹配（子字串）。
 */
export const KNOWN_HALLUCINATION_EXACT: readonly string[] = [
  // 中文常見幻覺
  "謝謝觀看",
  "谢谢观看",
  "感謝觀看",
  "感谢观看",
  "請訂閱",
  "请订阅",
  // 英文常見幻覺
  "Thank you.",
  "Thanks for watching!",
  "Thank you for watching!",
  "Thank you for watching.",
  "Please subscribe.",
  "Like and subscribe.",
];

export const KNOWN_HALLUCINATION_SUBSTRING: readonly string[] = [
  // 中文字幕浮水印
  "明報加拿大",
  "明報多倫多",
  "字幕by",
  "字幕由Amara",
  "字幕由 Amara",
  "Amara.org社群提供",
  "明镜与点点栏目",
  "请不吝点赞",
  // 英文字幕浮水印（含 Whisper 回傳英文拼音的情況）
  "Subtitles by the Amara.org community",
  "Subtitles by Amara.org",
  "Amara.org community",
  "MING PAO CANADA",
  "MING PAO TORONTO",
  "Ming Pao Canada",
  "Ming Pao Toronto",
];

// ── 核心函式 ──

/**
 * 三層幻覺偵測邏輯。
 *
 * Layer 1: 語速異常 — 錄音不到 1 秒但 Whisper 回傳超過 10 字，物理上不可能。
 * Layer 2: 無人聲 — 靜音（peak < 0.02）、或 peak 偏低時（< 0.03）的低 RMS + 高 NSP 聯合判斷、
 *          或極高 NSP（> 0.9）無論 peak 多高都攔截（背景噪音會推高 peak 但非人聲）。
 * Layer 3: 已知幻覺文本 blocklist — Whisper 在靜音/噪音下常輸出的制式浮水印短語。
 */
// ── 增強後偵測 ──

/** 增強後文字長度爆炸倍率門檻 — 校對只加標點空白，正常增幅 < 1.3 倍，2 倍已很寬鬆 */
export const ENHANCEMENT_LENGTH_EXPLOSION_RATIO = 2;

export interface EnhancementAnomalyParams {
  rawText: string;
  enhancedText: string;
}

export interface EnhancementAnomalyResult {
  isAnomaly: boolean;
  reason: "length-explosion" | null;
}

/**
 * 增強後語意偏移偵測 — 檢查 LLM 增強是否產生異常結果。
 *
 * 目前只做一層「長度爆炸」偵測：校對工具只改錯字和加標點，
 * 產出不應比輸入長 3 倍以上。若超過，代表 LLM 在回答問題或產生幻覺。
 */
export function detectEnhancementAnomaly(
  params: EnhancementAnomalyParams,
): EnhancementAnomalyResult {
  const rawLength = params.rawText.trim().length;
  const enhancedLength = params.enhancedText.trim().length;

  // 避免除以零：rawText 為空時不判定異常
  if (rawLength === 0) {
    return { isAnomaly: false, reason: null };
  }

  if (enhancedLength >= rawLength * ENHANCEMENT_LENGTH_EXPLOSION_RATIO) {
    return { isAnomaly: true, reason: "length-explosion" };
  }

  return { isAnomaly: false, reason: null };
}

// ── 轉錄幻覺偵測 ──

export function detectHallucination(
  params: HallucinationDetectionParams,
): HallucinationDetectionResult {
  const { rawText, recordingDurationMs, peakEnergyLevel, rmsEnergyLevel, noSpeechProbability } =
    params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 語速異常（物理定律級判斷）
  if (recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS && charCount > SPEED_ANOMALY_MIN_CHARS) {
    return {
      isHallucination: true,
      reason: "speed-anomaly",
      detectedText: trimmedText,
    };
  }

  // Layer 2: 無人聲偵測
  // 2a: 完全靜音 — 麥克風確認無任何聲音（peak < 0.02）
  // 2b: peak 偏低（< 0.03）+ 低 RMS + 高 NSP 聯合判斷
  //     若 peak >= 0.03 表示有明確可聽聲音，跳過此檢查（escape hatch）
  // 2c: 極高 NSP（> 0.9）— Whisper 非常確定沒語音，無論 peak 多高都攔截。
  //     背景噪音（風扇、冷氣、環境音）會推高 peak 但不代表有人聲。
  if (
    peakEnergyLevel < SILENCE_PEAK_ENERGY_THRESHOLD ||
    (peakEnergyLevel < LAYER2B_PEAK_ENERGY_CEILING &&
      rmsEnergyLevel < SILENCE_RMS_THRESHOLD &&
      noSpeechProbability > SILENCE_NSP_THRESHOLD) ||
    noSpeechProbability > HIGH_CONFIDENCE_NSP_THRESHOLD
  ) {
    return {
      isHallucination: true,
      reason: "no-speech-detected",
      detectedText: trimmedText,
    };
  }

  // Layer 3: 已知幻覺文本 blocklist — 即使物理信號正常，
  // Whisper 仍可能在背景噪音下幻覺出訓練資料中的字幕浮水印
  const normalized = trimmedText.replace(/\s+/g, "");
  if (
    KNOWN_HALLUCINATION_EXACT.some((p) => p.replace(/\s+/g, "") === normalized) ||
    KNOWN_HALLUCINATION_SUBSTRING.some((p) => trimmedText.includes(p))
  ) {
    return {
      isHallucination: true,
      reason: "known-hallucination-pattern",
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    detectedText: trimmedText,
  };
}
