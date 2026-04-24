import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { Copy, KeyRound, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHashRouter } from "@/app/router";
import { useQuotaInfo } from "@/hooks/useQuotaInfo";
import { useRateLimitStore, type RateLimitPayload } from "@/stores/rateLimitStore";
import { formatDurationFromMs, formatNumber } from "@/lib/formatUtils";

const TRANSCRIPTION_COMPLETED = "transcription:completed";
const RATE_LIMIT_UPDATED = "rate-limit:updated";
const RELEASES_URL = "https://github.com/bobo52310/releases/latest";

// ── Small V1 primitives (inline to keep scope tight) ──

function V1Chip({
  tone = "ghost",
  children,
}: {
  tone?: "ink" | "accent" | "outline" | "ghost";
  children: React.ReactNode;
}) {
  const stylesByTone: Record<string, React.CSSProperties> = {
    ink: { background: "var(--v1-ink)", color: "var(--v1-paper)" },
    accent: { background: "var(--v1-accent)", color: "var(--v1-ink)" },
    outline: {
      background: "transparent",
      color: "var(--v1-ink)",
      border: "1.5px solid var(--v1-line)",
    },
    ghost: { background: "rgba(27,27,28,0.06)", color: "var(--v1-ink-2)" },
  };
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        ...stylesByTone[tone],
      }}
    >
      {children}
    </span>
  );
}

function V1Stat({
  value,
  label,
  sub,
  accent = false,
}: {
  value: string;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="v1-rough flex flex-col gap-1"
      style={{
        padding: "14px 14px",
        background: accent ? "var(--v1-ink)" : "transparent",
        color: accent ? "var(--v1-paper)" : "var(--v1-ink)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: accent ? "var(--v1-paper-2)" : "var(--v1-ink-3)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </div>
      <div
        className="font-hand"
        style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: accent ? "var(--v1-paper-2)" : "var(--v1-ink-3)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Utility: compute current streak of consecutive days with activity ──
function computeCurrentStreak(list: { date: string; count: number }[]): number {
  let streak = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const day = list[i];
    if (day && day.count > 0) streak += 1;
    else break;
  }
  return streak;
}

function greetingKeyForHour(hour: number): string {
  if (hour < 11) return "dashboard.v1.greetingMorning";
  if (hour < 18) return "dashboard.v1.greetingAfternoon";
  return "dashboard.v1.greetingEvening";
}

function getSourceHint(record: { processedText: string | null; rawText: string }) {
  const text = record.processedText ?? record.rawText;
  return text.length > 120 ? text.slice(0, 117) + "…" : text;
}

export default function DashboardView() {
  const { t } = useTranslation();
  const refreshDashboard = useHistoryStore((s) => s.refreshDashboard);
  const dashboardStats = useHistoryStore((s) => s.dashboardStats);
  const dailyUsageTrendList = useHistoryStore((s) => s.dailyUsageTrendList);
  const recentTranscriptionList = useHistoryStore((s) => s.recentTranscriptionList);
  const requestFailedFilter = useHistoryStore((s) => s.requestFailedFilter);
  const { navigate } = useHashRouter();

  const hasTranscriptionApiKey = useSettingsStore((s) => s.hasTranscriptionApiKey());

  const quotaInfo = useQuotaInfo();

  const estimatedTypingTimeMs = useMemo(
    () => dashboardStats.estimatedTimeSavedMs + dashboardStats.totalRecordingDurationMs,
    [dashboardStats.estimatedTimeSavedMs, dashboardStats.totalRecordingDurationMs],
  );

  const speedMultiplier = useMemo(() => {
    if (dashboardStats.totalRecordingDurationMs <= 0) return 0;
    return estimatedTypingTimeMs / dashboardStats.totalRecordingDurationMs;
  }, [estimatedTypingTimeMs, dashboardStats.totalRecordingDurationMs]);

  const charsPerMinute = useMemo(() => {
    if (dashboardStats.totalRecordingDurationMs <= 0) return 0;
    const minutes = dashboardStats.totalRecordingDurationMs / 60000;
    return Math.round(dashboardStats.totalCharacters / minutes);
  }, [dashboardStats.totalCharacters, dashboardStats.totalRecordingDurationMs]);

  const currentStreak = useMemo(
    () => computeCurrentStreak(dailyUsageTrendList),
    [dailyUsageTrendList],
  );

  const todayCount = useMemo(() => {
    if (dailyUsageTrendList.length === 0) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return dailyUsageTrendList.find((d) => d.date === today)?.count ?? 0;
  }, [dailyUsageTrendList]);

  const monthCount = useMemo(() => {
    const now = new Date();
    const yyyymm = now.toISOString().slice(0, 7);
    return dailyUsageTrendList
      .filter((d) => d.date.startsWith(yyyymm))
      .reduce((sum, d) => sum + d.count, 0);
  }, [dailyUsageTrendList]);

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

  const apiKeyMissing = !hasTranscriptionApiKey;

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

  // ── Greeting & saved-time copy ──
  const greetingKey = greetingKeyForHour(new Date().getHours());

  // ── Latest transcript ──
  const latest = recentTranscriptionList[0];
  const latestSecondsAgo = latest
    ? Math.max(1, Math.round((Date.now() - latest.timestamp) / 1000))
    : 0;
  const latestTimeLabel =
    latest &&
    (latestSecondsAgo < 60
      ? t("dashboard.v1.secondsAgo", { count: latestSecondsAgo })
      : latestSecondsAgo < 3600
        ? t("dashboard.v1.minutesAgo", { count: Math.round(latestSecondsAgo / 60) })
        : latestSecondsAgo < 86400
          ? t("dashboard.v1.hoursAgo", { count: Math.round(latestSecondsAgo / 3600) })
          : t("dashboard.v1.daysAgo", { count: Math.round(latestSecondsAgo / 86400) }));
  const [copiedLatest, setCopiedLatest] = useState(false);

  async function copyLatest() {
    if (!latest) return;
    try {
      await invoke("copy_to_clipboard", {
        text: latest.processedText ?? latest.rawText,
      });
      setCopiedLatest(true);
      setTimeout(() => setCopiedLatest(false), 1600);
    } catch {
      // ignore
    }
  }

  // ── Conic-gradient percentage for speed ring (cap at 10x == 100%) ──
  const ringPercent = Math.min(100, Math.round((speedMultiplier / 10) * 100));
  const ringGradient = `conic-gradient(var(--v1-accent) 0 ${ringPercent}%, rgba(255,255,255,0.12) ${ringPercent}% 100%)`;

  // ── Longest streak (rough estimate: current streak, can be improved with DB) ──
  const longestStreak = currentStreak;

  return (
    <div className="flex h-full flex-col">
      {/* Greeting strip */}
      <div
        className="px-6 pt-5 pb-3"
        style={{ borderBottom: "1.5px dashed var(--v1-ink-4)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <div
            className="font-hand"
            style={{ fontSize: 22, fontWeight: 700, color: "var(--v1-ink)" }}
          >
            {t(greetingKey)} 👋
          </div>
          {dashboardStats.estimatedTimeSavedMs > 0 && (
            <div
              className="font-scribble"
              style={{ fontSize: 16, color: "var(--v1-ink-3)" }}
            >
              {t("dashboard.v1.savedPrefix")}{" "}
              <span className="v1-marker-y">
                {formatDurationFromMs(dashboardStats.estimatedTimeSavedMs)}
              </span>
            </div>
          )}
        </div>
        {currentStreak > 0 && (
          <div className="mt-1" style={{ fontSize: 12, color: "var(--v1-ink-3)" }}>
            {t("dashboard.v1.streakLine", { count: currentStreak })} · 🔥
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="flex flex-col gap-4">
          {/* Recovery banner */}
          {failedRecoverableCount > 0 && !recoveryBannerDismissed && (
            <div
              className="v1-rough-2 flex items-center gap-4"
              style={{
                padding: 14,
                background: "rgba(233,78,27,0.06)",
                borderColor: "var(--v1-accent-2)",
              }}
            >
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                style={{ background: "rgba(233,78,27,0.12)" }}
              >
                <RotateCw
                  className="h-5 w-5"
                  style={{ color: "var(--v1-accent-2)" }}
                />
              </div>
              <div className="flex-1">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--v1-ink)" }}
                >
                  {t("dashboard.recoveryBanner.title", {
                    count: failedRecoverableCount,
                  })}
                </p>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--v1-ink-3)" }}
                >
                  {t("dashboard.recoveryBanner.description")}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                style={{ color: "var(--v1-ink-3)" }}
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
                className="h-7 w-7 shrink-0"
                style={{ color: "var(--v1-ink-3)" }}
                onClick={dismissRecoveryBanner}
                aria-label={t("dashboard.recoveryBanner.dismiss")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* API Key prompt */}
          {apiKeyMissing && (
            <div
              className="v1-rough-2 flex items-center gap-4"
              style={{ padding: 14, background: "rgba(245,179,1,0.1)" }}
            >
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                style={{ background: "rgba(245,179,1,0.2)" }}
              >
                <KeyRound
                  className="h-5 w-5"
                  style={{ color: "var(--v1-ink)" }}
                />
              </div>
              <div className="flex-1">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--v1-ink)" }}
                >
                  {t("dashboard.apiKeyMissing.title")}
                </p>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--v1-ink-3)" }}
                >
                  {t("dashboard.apiKeyMissing.description")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={navigateToSettings}>
                  {t("dashboard.apiKeyMissing.action")}
                </Button>
                <Button
                  size="sm"
                  style={{
                    background: "var(--v1-accent)",
                    color: "var(--v1-ink)",
                    border: "1.5px solid var(--v1-line)",
                  }}
                  onClick={() => void restartOnboarding()}
                >
                  {t("dashboard.apiKeyMissing.guide")}
                </Button>
              </div>
            </div>
          )}

          {/* ── HERO: speed ring + latest transcript ── */}
          <div
            className="grid gap-3.5"
            style={{ gridTemplateColumns: "1.1fr 1fr" }}
          >
            {/* Speed ring */}
            <div
              className="v1-rough-2 flex items-center gap-4"
              style={{
                padding: 18,
                background: "var(--v1-ink)",
                color: "var(--v1-paper)",
              }}
            >
              <div
                className="grid place-items-center shrink-0"
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  background: hasData
                    ? ringGradient
                    : "rgba(255,255,255,0.08)",
                  transition: "background 800ms ease-out",
                }}
              >
                <div
                  className="grid place-items-center"
                  style={{
                    width: 78,
                    height: 78,
                    borderRadius: 39,
                    background: "var(--v1-ink)",
                  }}
                >
                  <div
                    className="font-hand"
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: "var(--v1-accent)",
                    }}
                  >
                    {hasData ? `${speedMultiplier.toFixed(1)}×` : "—"}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  {t("dashboard.v1.ringLabel")}
                </div>
                <div
                  className="font-hand"
                  style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}
                >
                  {dashboardStats.estimatedTimeSavedMs > 0
                    ? t("dashboard.v1.savedCopy", {
                        duration: formatDurationFromMs(
                          dashboardStats.estimatedTimeSavedMs,
                        ),
                      })
                    : t("dashboard.heroEmptyTitle")}
                </div>
                <div
                  className="flex gap-2.5"
                  style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}
                >
                  <span>
                    🎤{" "}
                    {formatDurationFromMs(
                      dashboardStats.totalRecordingDurationMs,
                    )}
                  </span>
                  <span>⌨︎ {formatDurationFromMs(estimatedTypingTimeMs)}</span>
                </div>
              </div>
            </div>

            {/* Latest transcript */}
            <div
              className="v1-rough-2 flex flex-col gap-2"
              style={{ padding: 14, background: "#fff" }}
            >
              <div className="flex items-center gap-2">
                <V1Chip tone="accent">{t("dashboard.v1.latestChip")}</V1Chip>
                {latest && (
                  <span style={{ fontSize: 11, color: "var(--v1-ink-3)" }}>
                    {latestTimeLabel}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {latest && (
                  <button
                    className="v1-rough inline-flex items-center gap-1"
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      background: "var(--v1-paper-2)",
                      color: "var(--v1-ink)",
                    }}
                    onClick={() => void copyLatest()}
                    aria-label={t("dashboard.v1.copy")}
                  >
                    <Copy className="h-3 w-3" />
                    {copiedLatest ? t("dashboard.v1.copied") : t("dashboard.v1.copy")}
                  </button>
                )}
              </div>
              {latest ? (
                <>
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "var(--v1-ink-2)",
                    }}
                  >
                    「{getSourceHint(latest)}」
                  </div>
                  <div
                    className="flex gap-1.5"
                    style={{ marginTop: "auto" }}
                  >
                    <V1Chip tone="ghost">
                      {latest.charCount} {t("dashboard.characterUnit")}
                    </V1Chip>
                    <V1Chip tone="ghost">
                      {formatDurationFromMs(latest.recordingDurationMs)}
                    </V1Chip>
                    {latest.wasEnhanced && (
                      <V1Chip tone="ghost">{t("dashboard.aiEnhanced")}</V1Chip>
                    )}
                  </div>
                </>
              ) : (
                <div
                  className="flex flex-1 items-center justify-center"
                  style={{ fontSize: 12, color: "var(--v1-ink-3)" }}
                >
                  {t("dashboard.noRecords")}
                </div>
              )}
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="grid grid-cols-4 gap-2.5">
            <V1Stat
              value={formatNumber(dashboardStats.totalCharacters)}
              label={t("dashboard.totalCharacters")}
              sub={t("dashboard.v1.todayLabel")}
            />
            <V1Stat
              value={formatNumber(monthCount)}
              label={t("dashboard.totalTranscriptions")}
              sub={t("dashboard.v1.monthLabel")}
            />
            <V1Stat
              value={formatNumber(charsPerMinute)}
              label={t("dashboard.charsPerMinute")}
            />
            <V1Stat
              value={`${Math.round(quotaInfo.percent)}%`}
              label={t("dashboard.dailyQuota")}
              accent
            />
          </div>

          {/* ── 30-day trend ── */}
          <div className="v1-rough-2" style={{ padding: 14, background: "#fff" }}>
            <div className="mb-2.5 flex items-baseline justify-between">
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v1-ink)" }}>
                {t("dashboard.usageTrend")}
              </div>
              <div
                className="font-hand"
                style={{ fontSize: 11, color: "var(--v1-ink-3)" }}
              >
                {t("dashboard.v1.longestStreak", { count: longestStreak })}
              </div>
            </div>
            {dailyUsageTrendList.length === 0 ? (
              <p
                className="py-8 text-center text-sm"
                style={{ color: "var(--v1-ink-3)" }}
              >
                {t("dashboard.emptyState")}
              </p>
            ) : (
              <div
                className="flex items-end"
                style={{ height: 60, gap: 3 }}
              >
                {dailyUsageTrendList.map((day, i) => {
                  const maxCount = Math.max(
                    ...dailyUsageTrendList.map((d) => d.count),
                    1,
                  );
                  const heightPct =
                    day.count === 0 ? 4 : Math.max(6, (day.count / maxCount) * 100);
                  const isToday = i === dailyUsageTrendList.length - 1;
                  return (
                    <div
                      key={i}
                      className="group relative flex-1"
                      style={{ height: "100%" }}
                      title={`${day.date}: ${day.count}`}
                    >
                      <div
                        className="absolute bottom-0 w-full"
                        style={{
                          height: `${heightPct}%`,
                          background: isToday
                            ? "var(--v1-accent)"
                            : "var(--v1-ink)",
                          opacity: isToday
                            ? 1
                            : 0.25 + (i / dailyUsageTrendList.length) * 0.5,
                          borderRadius: "2px 2px 0 0",
                          transition: "opacity 150ms",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {dailyUsageTrendList.length > 0 && (
              <div
                className="mt-1.5 flex justify-between"
                style={{ fontSize: 10, color: "var(--v1-ink-3)" }}
              >
                <span>
                  {dailyUsageTrendList[0]?.date.slice(5).replace("-", "/")}
                </span>
                <span>
                  {dailyUsageTrendList[
                    Math.floor(dailyUsageTrendList.length / 2)
                  ]?.date
                    .slice(5)
                    .replace("-", "/")}
                </span>
                <span>
                  {dailyUsageTrendList[dailyUsageTrendList.length - 1]?.date
                    .slice(5)
                    .replace("-", "/")}
                </span>
              </div>
            )}
          </div>

          {/* Today count helper for empty states */}
          {!hasData && todayCount === 0 && (
            <div
              className="v1-rough-dash p-4 text-center"
              style={{ fontSize: 12, color: "var(--v1-ink-3)" }}
            >
              {t("dashboard.v1.emptyHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
