import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRateLimitStore } from "@/stores/rateLimitStore";
import { formatDurationFromMs, formatNumber } from "@/lib/formatUtils";
import { findLlmModelConfig, findWhisperModelConfig } from "@/lib/modelRegistry";

export interface QuotaDimension {
  remaining: number;
  label: string;
}

export interface QuotaInfo {
  percent: number;
  colorClass: string;
  dimensions: QuotaDimension[];
  bottleneckLabel: string;
}

export function useQuotaInfo(): QuotaInfo {
  const { t } = useTranslation();
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const selectedWhisperModelId = useSettingsStore((s) => s.selectedWhisperModelId);
  const selectedLlmModelId = useSettingsStore((s) => s.selectedLlmModelId);
  const whisperRateLimit = useRateLimitStore((s) => s.whisper);
  const chatRateLimit = useRateLimitStore((s) => s.chat);

  return useMemo(() => {
    const usage = dashboardStats.dailyQuotaUsage;
    const wConfig = findWhisperModelConfig(selectedWhisperModelId);
    const lConfig = findLlmModelConfig(selectedLlmModelId);

    // Use API-reported limits when available, fall back to hardcoded config
    const wRpdLimit = whisperRateLimit?.limitRequests ?? wConfig?.freeQuotaRpd ?? 2000;
    const wAudioLimitMs = (wConfig?.freeQuotaAudioSecondsPerDay ?? 28800) * 1000;
    const lRpdLimit = chatRateLimit?.limitRequests ?? lConfig?.freeQuotaRpd ?? 1000;
    const lTpdLimit = chatRateLimit?.limitTokens ?? lConfig?.freeQuotaTpd ?? 100_000;

    // Use API-reported remaining when available, otherwise self-calculate
    const wRpdRemaining =
      whisperRateLimit?.remainingRequests != null && wRpdLimit > 0
        ? whisperRateLimit.remainingRequests / wRpdLimit
        : wRpdLimit > 0
          ? 1 - usage.whisperRequestCount / wRpdLimit
          : 0;

    const wAudioRemaining =
      wAudioLimitMs > 0 ? 1 - usage.whisperBilledAudioMs / wAudioLimitMs : 0;

    const lRpdRemaining =
      chatRateLimit?.remainingRequests != null && lRpdLimit > 0
        ? chatRateLimit.remainingRequests / lRpdLimit
        : lRpdLimit > 0
          ? 1 - usage.llmRequestCount / lRpdLimit
          : 0;

    const lTpdRemaining =
      chatRateLimit?.remainingTokens != null && lTpdLimit > 0
        ? chatRateLimit.remainingTokens / lTpdLimit
        : lTpdLimit > 0
          ? 1 - usage.llmTotalTokens / lTpdLimit
          : 0;

    // Labels always use self-tracked usage for concrete used/limit display
    const dimensions: QuotaDimension[] = [
      {
        remaining: wRpdRemaining,
        label: t("dashboard.quotaWhisperRequests", {
          used: whisperRateLimit?.remainingRequests != null
            ? wRpdLimit - whisperRateLimit.remainingRequests
            : usage.whisperRequestCount,
          limit: formatNumber(wRpdLimit),
        }),
      },
      {
        remaining: wAudioRemaining,
        label: t("dashboard.quotaAudio", {
          used: formatDurationFromMs(usage.whisperBilledAudioMs),
          limit: formatDurationFromMs(wAudioLimitMs),
        }),
      },
      {
        remaining: lRpdRemaining,
        label: t("dashboard.quotaLlmRequests", {
          used: chatRateLimit?.remainingRequests != null
            ? lRpdLimit - chatRateLimit.remainingRequests
            : usage.llmRequestCount,
          limit: formatNumber(lRpdLimit),
        }),
      },
      {
        remaining: lTpdRemaining,
        label: t("dashboard.quotaLlmTokens", {
          used: chatRateLimit?.remainingTokens != null
            ? formatNumber(lTpdLimit - chatRateLimit.remainingTokens)
            : formatNumber(usage.llmTotalTokens),
          limit: formatNumber(lTpdLimit),
        }),
      },
    ];

    const minRemaining = Math.max(0, Math.min(...dimensions.map((d) => d.remaining)));
    const percent = Math.floor(minRemaining * 100);
    const colorClass =
      percent >= 50 ? "bg-primary" : percent >= 20 ? "bg-warning" : "bg-destructive";

    const sorted = [...dimensions].sort((a, b) => a.remaining - b.remaining);
    const bottleneckLabel = sorted[0]?.label ?? "";

    return { percent, colorClass, dimensions, bottleneckLabel };
  }, [dashboardStats, selectedWhisperModelId, selectedLlmModelId, whisperRateLimit, chatRateLimit, t]);
}
