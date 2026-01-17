import type { TranscriptionRecord } from "../types/transcription";
import i18n from "../i18n";

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

function currentLocale(): string {
  return i18n.global.locale.value;
}

export function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateText(text: string, maxLength = 50): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function getDisplayText(record: TranscriptionRecord): string {
  return record.processedText ?? record.rawText;
}

/** 格式化毫秒為人類可讀的長時間格式（如「3 小時 12 分鐘」） */
export function formatDurationFromMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return t("format.minutes", { count: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0
    ? t("format.hoursMinutes", { hours, minutes })
    : t("format.hours", { count: hours });
}

/** 格式化毫秒為短時間格式（如「1:30」或「45 秒」） */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t("format.seconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

/** 格式化毫秒為精確時間格式（如「1.2 秒」或「350 ms」） */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return t("format.milliseconds", { count: Math.round(ms) });
  return t("format.seconds", { count: (ms / 1000).toFixed(1) });
}

export function formatNumber(n: number): string {
  return n.toLocaleString(currentLocale());
}

export function formatCostCeiling(cost: number): string {
  if (cost === 0) return "$0";
  return `≤ $${cost.toFixed(4)}`;
}
