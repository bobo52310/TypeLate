import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { KeyRound, MessageCircle, RotateCw, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHashRouter } from "@/app/router";
import { useQuotaInfo } from "@/hooks/useQuotaInfo";
import { useRateLimitStore, type RateLimitPayload } from "@/stores/rateLimitStore";
import HeroMetricCard from "@/components/dashboard/HeroMetricCard";
import StatCardRow from "@/components/dashboard/StatCardRow";
import FeatureTipCards from "@/components/dashboard/FeatureTipCards";

const TRANSCRIPTION_COMPLETED = "transcription:completed";
const RATE_LIMIT_UPDATED = "rate-limit:updated";
// TODO: Update URL if repo moves
const COMMUNITY_URL = "https://github.com/bobo52310/TypeLate/issues";
const RELEASES_URL = "https://github.com/bobo52310/TypeLate/releases/latest";

export default function DashboardView() {
  const { t } = useTranslation();
  const refreshDashboard = useHistoryStore((s) => s.refreshDashboard);
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const dailyUsageTrendList = useHistoryStore((s) => s.dailyUsageTrendList);
  const requestFailedFilter = useHistoryStore((s) => s.requestFailedFilter);
  const { navigate } = useHashRouter();

  const apiKey = useSettingsStore((s) => s.apiKey);

  const quotaInfo = useQuotaInfo();

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

    const unlistenFns: UnlistenFn[] = [];

    listen(TRANSCRIPTION_COMPLETED, () => {
      void refreshDashboard();
    }).then((fn) => unlistenFns.push(fn));

    listen<RateLimitPayload>(RATE_LIMIT_UPDATED, (event) => {
      useRateLimitStore.getState().applyRemoteUpdate(event.payload);
    }).then((fn) => unlistenFns.push(fn));

    return () => {
      for (const fn of unlistenFns) fn();
    };
  }, [refreshDashboard]);

  function openCommunityUrl() {
    void open(COMMUNITY_URL);
  }

  const apiKeyMissing = !apiKey;

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

  const hasData = dashboardStats.totalTranscriptions > 0 && speedMultiplier > 1;
  const failedRecoverableCount = dashboardStats.failedRecoverableCount;

  const RECOVERY_BANNER_DISMISSED_KEY = "recoveryBanner.dismissed";
  const [recoveryBannerDismissed, setRecoveryBannerDismissed] = useState(
    () => localStorage.getItem(RECOVERY_BANNER_DISMISSED_KEY) === "true",
  );

  function dismissRecoveryBanner() {
    localStorage.setItem(RECOVERY_BANNER_DISMISSED_KEY, "true");
    setRecoveryBannerDismissed(true);
  }

  function goToFailedHistory() {
    requestFailedFilter();
    navigate("/history");
  }

  return (
    <div className="space-y-5 p-5">
      {/* Recoverable failed records banner */}
      {failedRecoverableCount > 0 && !recoveryBannerDismissed && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-4 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <RotateCw className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {t("dashboard.recoveryBanner.title", { count: failedRecoverableCount })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboard.recoveryBanner.description")}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => open(RELEASES_URL)}
            >
              {t("dashboard.recoveryBanner.whatsNew")}
            </Button>
            <Button size="sm" variant="outline" onClick={goToFailedHistory}>
              {t("dashboard.recoveryBanner.action")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={dismissRecoveryBanner}
              aria-label={t("dashboard.recoveryBanner.dismiss")}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* API Key setup prompt */}
      {apiKeyMissing && (
        <Card className="border-primary/30 bg-primary/5">
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

      {/* Hero: Speed metric with circular ring */}
      <HeroMetricCard
        speedMultiplier={speedMultiplier}
        timeSavedMs={dashboardStats.estimatedTimeSavedMs}
        speakingTimeMs={dashboardStats.totalRecordingDurationMs}
        typingTimeMs={estimatedTypingTimeMs}
        hasData={hasData}
      />

      {/* Stats cards row */}
      <StatCardRow
        totalCharacters={dashboardStats.totalCharacters}
        totalTranscriptions={dashboardStats.totalTranscriptions}
        charsPerMinute={charsPerMinute}
        avgCharacters={avgCharacters}
        quotaPercent={Math.round(quotaInfo.percent)}
        quotaColorClass={quotaInfo.colorClass}
        quotaDimensionList={quotaInfo.dimensions}
        vocabularyAnalysisRequestCount={dashboardStats.dailyQuotaUsage.vocabularyAnalysisRequestCount}
        vocabularyAnalysisTotalTokens={dashboardStats.dailyQuotaUsage.vocabularyAnalysisTotalTokens}
      />

      {/* Feature tips */}
      <FeatureTipCards />

      {/* Daily usage trend */}
      <Card>
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
                      {/* Hover tooltip */}
                      <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md group-hover:flex">
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

      {/* Community card */}
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
  );
}
