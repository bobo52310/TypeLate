import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatNumber,
} from "@/lib/formatUtils";
import {
  findLlmModelConfig,
  findWhisperModelConfig,
} from "@/lib/modelRegistry";

const TRANSCRIPTION_COMPLETED = "transcription:completed";

export default function DashboardView() {
  const { t } = useTranslation();
  const refreshDashboard = useHistoryStore((s) => s.refreshDashboard);
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const recentTranscriptionList = useHistoryStore(
    (s) => s.recentTranscriptionList,
  );

  const selectedWhisperModelId = useSettingsStore(
    (s) => s.selectedWhisperModelId,
  );
  const selectedLlmModelId = useSettingsStore((s) => s.selectedLlmModelId);

  const quotaDimensionList = useMemo(() => {
    const usage = dashboardStats.dailyQuotaUsage;
    const wConfig = findWhisperModelConfig(selectedWhisperModelId);
    const lConfig = findLlmModelConfig(selectedLlmModelId);

    const wRpdLimit = wConfig?.freeQuotaRpd ?? 2000;
    const wAudioLimitMs =
      (wConfig?.freeQuotaAudioSecondsPerDay ?? 28800) * 1000;
    const lRpdLimit = lConfig?.freeQuotaRpd ?? 1000;
    const lTpdLimit = lConfig?.freeQuotaTpd ?? 100_000;

    return [
      {
        remaining:
          wRpdLimit > 0 ? 1 - usage.whisperRequestCount / wRpdLimit : 0,
        label: t("dashboard.quotaWhisperRequests", {
          used: usage.whisperRequestCount,
          limit: formatNumber(wRpdLimit),
        }),
      },
      {
        remaining:
          wAudioLimitMs > 0
            ? 1 - usage.whisperBilledAudioMs / wAudioLimitMs
            : 0,
        label: t("dashboard.quotaAudio", {
          used: formatDurationFromMs(usage.whisperBilledAudioMs),
          limit: formatDurationFromMs(wAudioLimitMs),
        }),
      },
      {
        remaining:
          lRpdLimit > 0 ? 1 - usage.llmRequestCount / lRpdLimit : 0,
        label: t("dashboard.quotaLlmRequests", {
          used: usage.llmRequestCount,
          limit: formatNumber(lRpdLimit),
        }),
      },
      {
        remaining:
          lTpdLimit > 0 ? 1 - usage.llmTotalTokens / lTpdLimit : 0,
        label: t("dashboard.quotaLlmTokens", {
          used: formatNumber(usage.llmTotalTokens),
          limit: formatNumber(lTpdLimit),
        }),
      },
    ];
  }, [dashboardStats, selectedWhisperModelId, selectedLlmModelId, t]);

  const quotaRemainingPercent = useMemo(() => {
    const minRemaining = Math.min(
      ...quotaDimensionList.map((d) => d.remaining),
    );
    return Math.max(0, minRemaining);
  }, [quotaDimensionList]);

  const quotaBottleneckLabel = useMemo(() => {
    const sorted = [...quotaDimensionList].sort(
      (a, b) => a.remaining - b.remaining,
    );
    return sorted[0]?.label ?? "";
  }, [quotaDimensionList]);

  const quotaBarColorClass = useMemo(() => {
    const pct = quotaRemainingPercent;
    if (pct >= 0.5) return "bg-emerald-500";
    if (pct >= 0.2) return "bg-amber-500";
    return "bg-destructive";
  }, [quotaRemainingPercent]);

  const avgCharacters = useMemo(() => {
    if (dashboardStats.totalTranscriptions <= 0) return 0;
    return Math.round(
      dashboardStats.totalCharacters / dashboardStats.totalTranscriptions,
    );
  }, [dashboardStats]);

  useEffect(() => {
    void refreshDashboard();

    let unlisten: (() => void) | undefined;
    listen(TRANSCRIPTION_COMPLETED, () => {
      void refreshDashboard();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [refreshDashboard]);

  function navigateToHistory() {
    window.location.hash = "#/history";
  }

  return (
    <div className="p-5">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("dashboard.totalRecordingTime")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatDurationFromMs(dashboardStats.totalRecordingDurationMs)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("dashboard.totalCharacters")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(dashboardStats.totalCharacters)}{" "}
              {t("dashboard.characterUnit")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("dashboard.timeSaved")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatDurationFromMs(dashboardStats.estimatedTimeSavedMs)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("dashboard.totalTranscriptions")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(dashboardStats.totalTranscriptions)}{" "}
              {t("dashboard.transcriptionUnit")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {t("dashboard.avgCharacters")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(avgCharacters)} {t("dashboard.characterUnit")}
            </p>
          </CardContent>
        </Card>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-default">
                <CardHeader className="pb-2">
                  <CardDescription>
                    {t("dashboard.dailyQuota")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-foreground">
                    {Math.round(quotaRemainingPercent * 100)}%
                  </p>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${quotaBarColorClass}`}
                      style={{
                        width: `${Math.round(quotaRemainingPercent * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {quotaBottleneckLabel}
                  </p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent
              className="w-72 border border-border bg-card p-3 text-card-foreground"
              side="bottom"
              sideOffset={6}
            >
              <p className="mb-2 text-xs font-medium">
                {t("dashboard.dailyQuotaDetail")}
              </p>
              <div className="space-y-2">
                {quotaDimensionList.map((dim, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {dim.label}
                      </span>
                      <span className="font-medium">
                        {Math.round(Math.max(0, dim.remaining) * 100)}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 w-full rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${quotaBarColorClass}`}
                        style={{
                          width: `${Math.round(Math.max(0, dim.remaining) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {dashboardStats.dailyQuotaUsage
                .vocabularyAnalysisRequestCount > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    {t("dashboard.vocabularyAnalysisUsage", {
                      requests:
                        dashboardStats.dailyQuotaUsage
                          .vocabularyAnalysisRequestCount,
                      tokens: formatNumber(
                        dashboardStats.dailyQuotaUsage
                          .vocabularyAnalysisTotalTokens,
                      ),
                    })}
                  </span>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Recent transcriptions */}
      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            {t("dashboard.recentTranscriptions")}
          </CardTitle>
          {recentTranscriptionList.length > 0 && (
            <Button variant="link" onClick={navigateToHistory}>
              {t("dashboard.viewAll")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {recentTranscriptionList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
              {t("dashboard.emptyState")}
            </div>
          ) : (
            <div className="space-y-2">
              {recentTranscriptionList.map((record) => (
                <Button
                  key={record.id}
                  variant="ghost"
                  className="flex h-auto w-full flex-col items-start rounded-lg border border-border px-4 py-3 text-left"
                  onClick={navigateToHistory}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(record.timestamp)}
                    </span>
                    {record.wasEnhanced && (
                      <Badge className="border-0 bg-emerald-500/20 text-emerald-400">
                        {t("dashboard.aiEnhanced")}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 w-full truncate text-sm text-muted-foreground">
                    {truncateText(getDisplayText(record))}
                  </p>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
