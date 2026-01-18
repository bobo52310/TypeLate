import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
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

  return useMemo(() => {
    const usage = dashboardStats.dailyQuotaUsage;
    const wConfig = findWhisperModelConfig(selectedWhisperModelId);
    const lConfig = findLlmModelConfig(selectedLlmModelId);

    const wRpdLimit = wConfig?.freeQuotaRpd ?? 2000;
    const wAudioLimitMs = (wConfig?.freeQuotaAudioSecondsPerDay ?? 28800) * 1000;
    const lRpdLimit = lConfig?.freeQuotaRpd ?? 1000;
    const lTpdLimit = lConfig?.freeQuotaTpd ?? 100_000;

    const dimensions: QuotaDimension[] = [
      {
        remaining: wRpdLimit > 0 ? 1 - usage.whisperRequestCount / wRpdLimit : 0,
        label: t("dashboard.quotaWhisperRequests", {
          used: usage.whisperRequestCount,
          limit: formatNumber(wRpdLimit),
        }),
      },
      {
        remaining: wAudioLimitMs > 0 ? 1 - usage.whisperBilledAudioMs / wAudioLimitMs : 0,
        label: t("dashboard.quotaAudio", {
          used: formatDurationFromMs(usage.whisperBilledAudioMs),
          limit: formatDurationFromMs(wAudioLimitMs),
        }),
      },
      {
        remaining: lRpdLimit > 0 ? 1 - usage.llmRequestCount / lRpdLimit : 0,
        label: t("dashboard.quotaLlmRequests", {
          used: usage.llmRequestCount,
          limit: formatNumber(lRpdLimit),
        }),
      },
      {
        remaining: lTpdLimit > 0 ? 1 - usage.llmTotalTokens / lTpdLimit : 0,
        label: t("dashboard.quotaLlmTokens", {
          used: formatNumber(usage.llmTotalTokens),
          limit: formatNumber(lTpdLimit),
        }),
      },
    ];

    const minRemaining = Math.max(0, Math.min(...dimensions.map((d) => d.remaining)));
    const percent = Math.round(minRemaining * 100);
    const colorClass =
      percent >= 50 ? "bg-primary" : percent >= 20 ? "bg-warning" : "bg-destructive";

    const sorted = [...dimensions].sort((a, b) => a.remaining - b.remaining);
    const bottleneckLabel = sorted[0]?.label ?? "";

    return { percent, colorClass, dimensions, bottleneckLabel };
  }, [dashboardStats, selectedWhisperModelId, selectedLlmModelId, t]);
}
