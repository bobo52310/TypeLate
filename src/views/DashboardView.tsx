import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { KeyRound, MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatNumber,
} from "@/lib/formatUtils";
import { useQuotaInfo } from "@/hooks/useQuotaInfo";

const TRANSCRIPTION_COMPLETED = "transcription:completed";
// TODO: Update URL if repo moves
const COMMUNITY_URL = "https://github.com/bobo52310/TypeLate/issues";

export default function DashboardView() {
  const { t } = useTranslation();
  const refreshDashboard = useHistoryStore((s) => s.refreshDashboard);
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const recentTranscriptionList = useHistoryStore((s) => s.recentTranscriptionList);
  const dailyUsageTrendList = useHistoryStore((s) => s.dailyUsageTrendList);

  const hasApiKey = useSettingsStore((s) => s.hasApiKey);

  const quotaInfo = useQuotaInfo();
  const quotaDimensionList = quotaInfo.dimensions;
  const quotaRemainingPercent = quotaInfo.percent / 100;
  const quotaBottleneckLabel = quotaInfo.bottleneckLabel;
  const quotaBarColorClass = quotaInfo.colorClass;

  const avgCharacters = useMemo(() => {
    if (dashboardStats.totalTranscriptions <= 0) return 0;
    return Math.round(dashboardStats.totalCharacters / dashboardStats.totalTranscriptions);
  }, [dashboardStats]);

  const estimatedTypingTimeMs = useMemo(() => {
    return dashboardStats.estimatedTimeSavedMs + dashboardStats.totalRecordingDurationMs;
  }, [dashboardStats.estimatedTimeSavedMs, dashboardStats.totalRecordingDurationMs]);

  const speedMultiplier = useMemo(() => {
    if (dashboardStats.totalRecordingDurationMs <= 0) return 0;
    return estimatedTypingTimeMs / dashboardStats.totalRecordingDurationMs;
  }, [estimatedTypingTimeMs, dashboardStats.totalRecordingDurationMs]);

  const charsPerMinute = useMemo(() => {
    if (dashboardStats.totalRecordingDurationMs <= 0) return 0;
    const minutes = dashboardStats.totalRecordingDurationMs / 60000;
    return Math.round(dashboardStats.totalCharacters / minutes);
  }, [dashboardStats.totalCharacters, dashboardStats.totalRecordingDurationMs]);

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

  function openCommunityUrl() {
    void open(COMMUNITY_URL);
  }

  const apiKeyMissing = !hasApiKey();

  function navigateToSettings() {
    window.location.hash = "#/settings?tab=ai";
  }

  async function restartOnboarding() {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      await store.set("onboardingCompleted", false);
      await store.save();
      window.location.reload();
    } catch {
      // fallback to settings page
      navigateToSettings();
    }
  }

  return (
    <div className="p-5">
      {/* API Key setup prompt */}
      {apiKeyMissing && (
        <Card className="mb-5 border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-4 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {t("dashboard.apiKeyMissing.title")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboard.apiKeyMissing.description")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={navigateToSettings}>
                {t("dashboard.apiKeyMissing.action")}
              </Button>
              <Button size="sm" onClick={() => void restartOnboarding()}>
                {t("dashboard.apiKeyMissing.guide")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero: Speed comparison */}
      {dashboardStats.totalTranscriptions > 0 && speedMultiplier > 1 && (
        <Card className="mb-5">
          <CardContent className="pt-6">
            <p className="text-center text-lg text-muted-foreground">
              {t("dashboard.heroPrefix")}{" "}
              <span className="text-3xl font-bold text-primary">
                {t("dashboard.heroMultiplier", {
                  value: speedMultiplier.toFixed(1),
                })}
              </span>{" "}
              {t("dashboard.heroSuffix")}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 px-4 py-3">
                <p className="text-2xl font-bold text-foreground">
                  {formatDurationFromMs(dashboardStats.totalRecordingDurationMs)}
                </p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("dashboard.speakingTime")}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 px-4 py-3">
                <p className="text-2xl font-bold text-foreground">
                  {formatDurationFromMs(estimatedTypingTimeMs)}
                </p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("dashboard.typingTime")}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboard.timeSaved")}
              </p>
              <p className="text-2xl font-bold text-primary">
                {formatDurationFromMs(dashboardStats.estimatedTimeSavedMs)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("dashboard.totalCharacters")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(dashboardStats.totalCharacters)} {t("dashboard.characterUnit")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("dashboard.totalTranscriptions")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(dashboardStats.totalTranscriptions)} {t("dashboard.transcriptionUnit")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("dashboard.charsPerMinute")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(charsPerMinute)} {t("dashboard.charsPerMinuteUnit")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("dashboard.avgCharacters")}</CardDescription>
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
                  <CardDescription>{t("dashboard.dailyQuota")}</CardDescription>
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
              <p className="mb-2 text-xs font-medium">{t("dashboard.dailyQuotaDetail")}</p>
              <div className="space-y-2">
                {quotaDimensionList.map((dim, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{dim.label}</span>
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
              {dashboardStats.dailyQuotaUsage.vocabularyAnalysisRequestCount > 0 && (
                <div className="mt-2 border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    {t("dashboard.vocabularyAnalysisUsage", {
                      requests: dashboardStats.dailyQuotaUsage.vocabularyAnalysisRequestCount,
                      tokens: formatNumber(
                        dashboardStats.dailyQuotaUsage.vocabularyAnalysisTotalTokens,
                      ),
                    })}
                  </span>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Card
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={openCommunityUrl}
        >
          <CardContent className="flex items-center gap-3 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("dashboard.communityTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("dashboard.communityDescription")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily usage trend */}
      <Card className="mt-5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("dashboard.usageTrend")}</CardTitle>
            <CardDescription>{t("dashboard.last30Days")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {dailyUsageTrendList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("dashboard.emptyState")}
            </p>
          ) : (
            <div>
              <div className="flex h-40 items-end gap-[3px]">
                {dailyUsageTrendList.map((day, i) => {
                  const maxCount = Math.max(...dailyUsageTrendList.map((d) => d.count), 1);
                  const heightPct = day.count === 0 ? 0 : Math.max(6, (day.count / maxCount) * 100);
                  const isToday = i === dailyUsageTrendList.length - 1;
                  return (
                    <div key={i} className="group relative flex-1" style={{ height: "100%" }}>
                      {/* Hover tooltip: count prominent, date below */}
                      <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md group-hover:flex whitespace-nowrap">
                        <span className="text-sm font-bold tabular-nums text-popover-foreground">
                          {day.count} {t("dashboard.transcriptionUnit")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {day.date.slice(5).replace("-", "/")}
                        </span>
                      </div>
                      {/* Bar */}
                      <div
                        className={`absolute bottom-0 w-full rounded-t transition-colors ${
                          isToday ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/70"
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* X-axis */}
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>{dailyUsageTrendList[0]?.date.slice(5).replace("-", "/")}</span>
                <span>
                  {dailyUsageTrendList[Math.floor(dailyUsageTrendList.length / 2)]?.date
                    .slice(5)
                    .replace("-", "/")}
                </span>
                <span>
                  {dailyUsageTrendList[dailyUsageTrendList.length - 1]?.date
                    .slice(5)
                    .replace("-", "/")}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent transcriptions */}
      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("dashboard.recentTranscriptions")}</CardTitle>
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
                      <Badge className="border-0 bg-primary/20 text-primary">
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
