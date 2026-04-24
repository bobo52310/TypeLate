import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const OnboardingView = lazy(() => import("@/views/OnboardingView"));
import { Cloud, CloudOff, Download, Loader2, Megaphone, Mic, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MobileAppDialog } from "@/components/MobileAppDialog";
import { UpdateAvailableDialog } from "@/components/UpdateAvailableDialog";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { useDebouncedTauriEvent, useTauriEvent, VOCABULARY_CHANGED, MENU_NAVIGATE, MENU_CHECK_UPDATE } from "@/hooks/useTauriEvent";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { logError } from "@/lib/logger";
import { captureError, initSentryForDashboard } from "@/lib/sentry";
import { IS_MAC } from "@/lib/platform";
import { initializeDatabase, getDatabaseInitError } from "@/lib/database";
import { AccessibilityGuide } from "@/components/AccessibilityGuide";
import { PermissionsOnboarding } from "@/components/PermissionsOnboarding";
import { useHistoryStore } from "@/stores/historyStore";
import { useSyncStore } from "@/stores/syncStore";
import { useHashRouter, RouterOutlet, type RoutePath } from "./router";
import { getRandomSlogan } from "@/lib/slogans";

import { APP_VERSION } from "@/lib/version";

// ── Navigation items (V1 Classic+) ──
// Wireframe uses sketchy glyph icons. We keep them as single characters
// to stay pixel-faithful to the design.

interface V1NavItem {
  path: RoutePath;
  labelKey: string;
  glyph: string;
  badgeKey?: "today" | "history";
}

const NAV_GROUP_PRIMARY: V1NavItem[] = [
  { path: "/dashboard", labelKey: "mainApp.nav.dashboard", glyph: "◱" },
  { path: "/history", labelKey: "mainApp.nav.history", glyph: "≡", badgeKey: "history" },
  { path: "/ai", labelKey: "mainApp.nav.ai", glyph: "✦" },
  { path: "/dictionary", labelKey: "mainApp.nav.dictionary", glyph: "⊞" },
];

const NAV_GROUP_SYSTEM: V1NavItem[] = [
  { path: "/settings/general", labelKey: "mainApp.nav.settings", glyph: "✲" },
];

const ALL_NAV_ITEMS = [...NAV_GROUP_PRIMARY, ...NAV_GROUP_SYSTEM];

// ── Update UI types ──

type UpdateUiState = "idle" | "checking" | "update-available" | "downloading" | "ready-to-install" | "installing";

const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
const AUTO_CHECK_INTERVAL_MS = 15 * 60_000; // 15 minutes

// ── Component ──

export function DashboardApp() {
  const { t } = useTranslation();
  const { currentPath, navigate } = useHashRouter();

  // Keyboard shortcuts: Cmd+1/2/3 for tab switching, Cmd+, for settings
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      switch (e.key) {
        case "1":
          e.preventDefault();
          navigate("/dashboard");
          break;
        case "2":
          e.preventDefault();
          navigate("/history");
          break;
        case "3":
          e.preventDefault();
          navigate("/dictionary");
          break;
        case "4":
          e.preventDefault();
          navigate("/ai");
          break;
        case "5":
        case ",":
          e.preventDefault();
          navigate("/settings/general");
          break;
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [navigate]);

  // Sidebar logo hover slogan (stable per mount)
  const [sidebarSlogan] = useState(() => getRandomSlogan());

  // Easter egg: click version 7 times
  const [easterEggSlogan, setEasterEggSlogan] = useState<string | null>(null);
  const versionClickRef = useRef(0);
  const easterEggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingCheckedRef = useRef(false);

  // Database error state
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  // Accessibility guide (placeholder)
  const [showAccessibilityGuide, setShowAccessibilityGuide] = useState(false);

  // First-launch permissions onboarding (macOS only)
  const [showPermissionsOnboarding, setShowPermissionsOnboarding] = useState(false);

  // Today's usage count for sidebar
  const dailyUsageTrendList = useHistoryStore((s) => s.dailyUsageTrendList);
  const todayCount = useMemo(() => {
    if (dailyUsageTrendList.length === 0) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return dailyUsageTrendList.find((d) => d.date === today)?.count ?? 0;
  }, [dailyUsageTrendList]);

  // Update state
  const [updateState, setUpdateState] = useState<UpdateUiState>("idle");
  const [availableVersion, setAvailableVersion] = useState("");
  const updateFeedback = useFeedbackMessage();

  // Update dialog state
  const [releaseBody, setReleaseBody] = useState("");
  const [showUpdateAvailableDialog, setShowUpdateAvailableDialog] = useState(false);
  const [isUpdateDownloading, setIsUpdateDownloading] = useState(false);

  // Mobile app dialog
  const [showMobileAppDialog, setShowMobileAppDialog] = useState(false);

  // AlertDialog visibility
  const [showManualUpdateDialog, setShowManualUpdateDialog] = useState(false);
  const [showUpgradeNoticeDialog, setShowUpgradeNoticeDialog] = useState(false);

  // Refs for cleanup
  const autoCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initGuardRef = useRef(false);

  // Store subscriptions
  const showPromptUpgradeNotice = useSettingsStore((s) => s.showPromptUpgradeNotice);
  const recordingRetentionPolicy = useSettingsStore((s) => s.recordingRetentionPolicy);

  // Sync state for sidebar indicator
  const syncIsConnected = useSyncStore((s) => s.isConnected);
  const syncIsSyncing = useSyncStore((s) => s.isSyncing);
  const syncError = useSyncStore((s) => s.syncError);

  // ── Listen for VOCABULARY_CHANGED from HUD window (debounced) ──
  useDebouncedTauriEvent(VOCABULARY_CHANGED, () => {
    void useVocabularyStore.getState().fetchTermList();
  });

  // ── macOS App Menu events ──
  useTauriEvent<string>(MENU_NAVIGATE, (path) => {
    navigate(path as RoutePath);
  });

  useTauriEvent(MENU_CHECK_UPDATE, () => {
    // Navigate to about section and trigger update check
    navigate("/settings/about");
  });

  // ── Watch for upgrade notice ──
  useEffect(() => {
    if (showPromptUpgradeNotice) {
      setShowUpgradeNoticeDialog(true);
      useSettingsStore.setState({ showPromptUpgradeNotice: false });
    }
  }, [showPromptUpgradeNotice]);

  // ── Auto-update flow ──

  const autoCheckForUpdate = useCallback(async () => {
    // Only proceed when idle to avoid concurrent checks
    const currentState = updateStateRef.current;
    if (currentState !== "idle") return;

    try {
      const { checkForAppUpdate } = await import("@/lib/autoUpdater");
      const result = await checkForAppUpdate();

      if (result.status !== "update-available" || !result.version) return;

      // Skip if user chose to skip this version
      const skipped = useSettingsStore.getState().skippedUpdateVersion;
      if (result.version === skipped) return;

      setAvailableVersion(result.version);
      setReleaseBody(result.body ?? "");
      setUpdateState("update-available");

      // Show Dashboard window and prompt user
      const currentWindow = getCurrentWindow();
      await currentWindow.show();
      await currentWindow.setFocus();

      setShowUpdateAvailableDialog(true);
    } catch (err) {
      logError("dashboard", "Auto update check failed", err);
      captureError(err, { source: "updater", step: "auto-check" });
      setUpdateState("idle");
    }
  }, []);

  // Ref to track updateState for the async callback
  const updateStateRef = useRef<UpdateUiState>("idle");
  useEffect(() => {
    updateStateRef.current = updateState;
  }, [updateState]);

  const handleVersionClick = useCallback(() => {
    // Easter egg: 7 clicks
    versionClickRef.current += 1;
    if (versionClickRef.current >= 7) {
      versionClickRef.current = 0;
      setEasterEggSlogan(getRandomSlogan());
      if (easterEggTimerRef.current) clearTimeout(easterEggTimerRef.current);
      easterEggTimerRef.current = setTimeout(() => setEasterEggSlogan(null), 4000);
      return;
    }

    // Trigger update check on single click
    if (isCheckingUpdate || updateStateRef.current !== "idle") return;
    setIsCheckingUpdate(true);
    void (async () => {
      try {
        const { checkForAppUpdate } = await import("@/lib/autoUpdater");
        const result = await checkForAppUpdate();

        if (result.status === "update-available" && result.version) {
          const skipped = useSettingsStore.getState().skippedUpdateVersion;
          if (result.version !== skipped) {
            setAvailableVersion(result.version);
            setReleaseBody(result.body ?? "");
            setUpdateState("update-available");
            setShowUpdateAvailableDialog(true);
            return;
          }
        }
        updateFeedback.show("success", t("mainApp.update.upToDate"));
      } catch {
        updateFeedback.show("error", t("mainApp.update.checkFailed"));
      } finally {
        setIsCheckingUpdate(false);
      }
    })();
  }, [isCheckingUpdate, t, updateFeedback]);

  const handleInstallUpdate = useCallback(async () => {
    setIsUpdateDownloading(true);
    try {
      const { downloadInstallAndRelaunch } = await import("@/lib/autoUpdater");
      await downloadInstallAndRelaunch();
    } catch (err) {
      logError("dashboard", "Update install failed", err);
      updateFeedback.show("error", t("mainApp.update.updateFailed"));
      setIsUpdateDownloading(false);
      setShowUpdateAvailableDialog(false);
      setUpdateState("idle");
    }
  }, [t, updateFeedback]);

  const handleSkipVersion = useCallback(() => {
    setShowUpdateAvailableDialog(false);
    setUpdateState("idle");
    void useSettingsStore.getState().saveSkippedUpdateVersion(availableVersion);
    setAvailableVersion("");
  }, [availableVersion]);

  const handleRemindLater = useCallback(() => {
    setShowUpdateAvailableDialog(false);
    setUpdateState("idle");
  }, []);

  const handleSidebarInstall = useCallback(() => {
    setShowUpdateAvailableDialog(true);
  }, []);

  // ── Manual update flow ──

  const handleManualUpdate = useCallback(async () => {
    setShowManualUpdateDialog(false);
    setUpdateState("downloading");
    try {
      const { downloadInstallAndRelaunch } = await import("@/lib/autoUpdater");
      await downloadInstallAndRelaunch();
    } catch (err) {
      logError("dashboard", "Manual update failed", err);
      updateFeedback.show("error", t("mainApp.update.updateFailed"));
      setUpdateState("idle");
      setAvailableVersion("");
    }
  }, [t, updateFeedback]);

  // ── Initialization (runs once) ──
  useEffect(() => {
    if (initGuardRef.current) return;
    initGuardRef.current = true;

    async function bootstrap() {
      // Sentry
      initSentryForDashboard();

      // Database
      try {
        await initializeDatabase();
      } catch {
        setDatabaseError(getDatabaseInitError());
      }

      // Settings
      const settingsActions = useSettingsStore.getState();
      await settingsActions.loadSettings();
      await settingsActions.consumeUpgradeNotice();
      await settingsActions.loadAutoStartStatus();

      // Onboarding check
      if (!onboardingCheckedRef.current) {
        onboardingCheckedRef.current = true;
        try {
          const { load } = await import("@tauri-apps/plugin-store");
          const store = await load("settings.json");
          const completed = await store.get<boolean>("onboardingCompleted");
          if (!completed && !settingsActions.hasTranscriptionApiKey()) {
            setShowOnboarding(true);
          }
          // Permissions onboarding: first-time review of OS permissions.
          // Shown on macOS for existing users once after upgrade, and for new
          // users right after they finish the product onboarding.
          if (IS_MAC) {
            const permissionsSeen = await store.get<boolean>(
              "permissionsOnboardingCompleted",
            );
            if (!permissionsSeen) setShowPermissionsOnboarding(true);
          }
        } catch {
          // If check fails, skip onboarding
        }
      }

      // macOS accessibility check
      const isMacOS = IS_MAC;
      if (isMacOS) {
        try {
          const hasPermission = await invoke<boolean>("check_accessibility_permission_command");
          setShowAccessibilityGuide(!hasPermission);
        } catch (error) {
          logError("dashboard", "Failed to check accessibility permission", error);
          captureError(error, {
            source: "accessibility",
            step: "check-permission",
          });
        }
      }

      // Auto-update schedule: 5s delay, then every 15 min
      autoCheckTimeoutRef.current = setTimeout(() => {
        void autoCheckForUpdate();
        autoCheckIntervalRef.current = setInterval(
          () => void autoCheckForUpdate(),
          AUTO_CHECK_INTERVAL_MS,
        );
      }, AUTO_CHECK_INITIAL_DELAY_MS);

      // Cloud sync: load status, sync on launch, start auto-sync
      const syncActions = useSyncStore.getState();
      await syncActions.loadSyncStatus();
      if (useSyncStore.getState().isConnected) {
        void syncActions.syncNow().catch(() => {});
      }
    }

    void bootstrap();

    const cleanupAutoSync = useSyncStore.getState().initAutoSync();

    return () => {
      if (autoCheckTimeoutRef.current) clearTimeout(autoCheckTimeoutRef.current);
      if (autoCheckIntervalRef.current) clearInterval(autoCheckIntervalRef.current);
      cleanupAutoSync();
    };
  }, [autoCheckForUpdate]);

  // ── Recording auto-cleanup (runs when retention policy changes) ──
  useEffect(() => {
    if (recordingRetentionPolicy === "forever" || recordingRetentionPolicy === "none") return;

    const days = Number(recordingRetentionPolicy);
    if (days <= 0) return;

    invoke("cleanup_old_recordings", { days }).catch((err) => {
      logError("dashboard", "Recording cleanup failed", err);
      captureError(err, { source: "recording-cleanup" });
    });
  }, [recordingRetentionPolicy]);

  // ── Render ──

  return (
    <>
      {/* Skip to content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-10 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground focus:shadow-md"
      >
        Skip to content
      </a>

      {/* macOS custom title bar: fixed overlay for window dragging — V1 paper style */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center select-none"
        style={{
          background: "var(--v1-paper-2)",
          borderBottom: "1.5px solid var(--v1-line)",
        }}
      >
        <span
          data-tauri-drag-region
          className="text-xs font-medium select-none"
          style={{ color: "var(--v1-ink-2)" }}
        >
          TypeLate
        </span>
      </div>

      {showOnboarding ? (
        <OnboardingView onComplete={() => setShowOnboarding(false)} />
      ) : (
        <div className="flex h-screen min-h-0 pt-9">
          {/* ── V1 Sidebar ── */}
          <aside
            className="flex shrink-0 flex-col"
            style={{
              width: 210,
              background: "var(--v1-paper-2)",
              borderRight: "1.5px solid var(--v1-line)",
            }}
          >
            {/* Logo + tagline */}
            <div
              className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5 cursor-default"
              title={sidebarSlogan}
            >
              <div
                className="grid place-items-center font-bold leading-none shrink-0"
                style={{
                  width: 26,
                  height: 26,
                  background: "var(--v1-ink)",
                  borderRadius: 7,
                  color: "var(--v1-accent)",
                  fontFamily: "'Kalam', sans-serif",
                  fontSize: 14.3,
                  boxShadow: "2px 2px 0 rgba(0,0,0,0.08)",
                }}
                aria-hidden
              >
                T
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>TypeLate</div>
                <div className="font-hand" style={{ fontSize: 11, color: "var(--v1-ink-3)" }}>
                  Too late to type.
                </div>
              </div>
            </div>

            {/* Quick capture — always visible */}
            <div className="px-2.5 pt-1 pb-2.5">
              <div
                className="v1-rough flex items-center gap-2"
                style={{
                  background: "var(--v1-ink)",
                  color: "var(--v1-paper)",
                  padding: "10px 12px",
                }}
                role="note"
              >
                <div
                  className="grid place-items-center shrink-0"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    background: "var(--v1-accent)",
                    color: "var(--v1-ink)",
                  }}
                >
                  <Mic className="h-3.5 w-3.5" strokeWidth={2.5} />
                </div>
                <div style={{ flex: 1, fontSize: 11, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t("mainApp.sidebar.quickCaptureTitle")}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>
                    {t("mainApp.sidebar.quickCaptureHint")}
                  </div>
                </div>
              </div>
            </div>

            {/* Primary nav */}
            <div
              className="font-hand"
              style={{
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "var(--v1-ink-3)",
                padding: "12px 12px 4px",
              }}
            >
              {t("mainApp.sidebar.groupPrimary")}
            </div>
            <nav className="px-2" aria-label="Main navigation">
              {NAV_GROUP_PRIMARY.map((item, idx) => {
                const globalIndex = ALL_NAV_ITEMS.indexOf(item);
                const isActive = currentPath === item.path;
                const badge =
                  item.badgeKey === "history" && todayCount > 0 ? String(todayCount) : undefined;
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={"v1-nav-item" + (isActive ? " active" : "")}
                    onClick={() => navigate(item.path)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const next =
                          e.key === "ArrowDown"
                            ? (globalIndex + 1) % ALL_NAV_ITEMS.length
                            : (globalIndex - 1 + ALL_NAV_ITEMS.length) % ALL_NAV_ITEMS.length;
                        const allButtons = document.querySelectorAll("nav button.v1-nav-item");
                        (allButtons?.[next] as HTMLElement | undefined)?.focus();
                      }
                    }}
                  >
                    <span style={{ width: 14, textAlign: "center", fontSize: 13 }} aria-hidden>
                      {item.glyph}
                    </span>
                    <span
                      style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}
                    >
                      {t(item.labelKey)}
                    </span>
                    {badge && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 999,
                          background: isActive ? "var(--v1-accent)" : "var(--v1-ink)",
                          color: isActive ? "var(--v1-ink)" : "var(--v1-paper)",
                          fontWeight: 600,
                        }}
                      >
                        {badge}
                      </span>
                    )}
                    {idx === 0 && !isActive && <span className="v1-nav-dot" aria-hidden />}
                  </button>
                );
              })}
            </nav>

            {/* System nav */}
            <div
              className="font-hand"
              style={{
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "var(--v1-ink-3)",
                padding: "12px 12px 4px",
              }}
            >
              {t("mainApp.sidebar.groupSystem")}
            </div>
            <nav className="px-2" aria-label="System navigation">
              {NAV_GROUP_SYSTEM.map((item) => {
                const isActive = currentPath.startsWith("/settings");
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={"v1-nav-item" + (isActive ? " active" : "")}
                    onClick={() => navigate(item.path)}
                  >
                    <span style={{ width: 14, textAlign: "center", fontSize: 13 }} aria-hidden>
                      {item.glyph}
                    </span>
                    <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>
                      {t(item.labelKey)}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div style={{ flex: 1 }} />

            {/* Easter egg slogan (overlay above footer) */}
            {easterEggSlogan && (
              <div
                className="mx-3 mb-2 px-2.5 py-1.5 text-center"
                style={{
                  border: "1.5px solid var(--v1-accent)",
                  borderRadius: 6,
                  background: "rgba(245,179,1,0.12)",
                }}
              >
                <p
                  className="font-hand text-xs italic"
                  style={{ color: "var(--v1-ink-2)" }}
                >
                  &ldquo;{easterEggSlogan}&rdquo;
                </p>
              </div>
            )}

            {/* Footer */}
            <div
              className="flex flex-col gap-1.5"
              style={{
                borderTop: "1.5px dashed var(--v1-ink-4)",
                padding: "10px 14px",
                fontSize: 11,
                color: "var(--v1-ink-3)",
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    void import("@tauri-apps/plugin-shell").then((m) =>
                      m.open("https://github.com/bobo52310/TypeLate/releases"),
                    );
                  }}
                  className="inline-flex items-center gap-1 transition-colors hover:opacity-80"
                  style={{ color: "var(--v1-ink-3)", fontSize: 11 }}
                >
                  <Megaphone className="h-3 w-3" />
                  <span>{t("mainApp.footer.whatsNew")}</span>
                </button>
                <button
                  onClick={() => setShowMobileAppDialog(true)}
                  className="inline-flex items-center gap-1 transition-colors hover:opacity-80"
                  style={{ color: "var(--v1-ink-3)", fontSize: 11 }}
                >
                  <Smartphone className="h-3 w-3" />
                  <span>{t("mainApp.footer.mobileApp")}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: syncError
                      ? "var(--v1-accent-2)"
                      : "var(--v1-accent-4)",
                    flexShrink: 0,
                  }}
                />
                <span>
                  {t("mainApp.sidebar.connected")} · Groq
                </span>
                {syncIsConnected &&
                  (syncIsSyncing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : syncError ? (
                    <CloudOff className="h-3 w-3" style={{ color: "var(--v1-accent-2)" }} />
                  ) : (
                    <Cloud className="h-3 w-3" style={{ color: "var(--v1-accent-3)" }} />
                  ))}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={handleVersionClick}
                  className="inline-flex items-center gap-1 transition-colors hover:opacity-80 select-none"
                  style={{ color: "var(--v1-ink-3)", fontSize: 11 }}
                  disabled={isCheckingUpdate}
                >
                  v{APP_VERSION}
                  {isCheckingUpdate && <Loader2 className="h-3 w-3 animate-spin" />}
                </button>
                <span className="font-hand" style={{ color: "var(--v1-ink-2)", fontSize: 11 }}>
                  {t("mainApp.sidebar.todayCount", { count: todayCount })}
                </span>
              </div>

              {(updateState === "update-available" || updateState === "ready-to-install") && (
                <Button
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  style={{
                    background: "var(--v1-accent)",
                    color: "var(--v1-ink)",
                    border: "1.5px solid var(--v1-line)",
                    borderRadius: 6,
                  }}
                  onClick={handleSidebarInstall}
                >
                  <Download className="h-3 w-3" />
                  {t("mainApp.update.installNow")}
                </Button>
              )}

              {updateFeedback.message && (
                <p
                  className="text-xs"
                  style={{
                    color:
                      updateFeedback.type === "success"
                        ? "var(--v1-accent-4)"
                        : "var(--v1-accent-2)",
                  }}
                >
                  {updateFeedback.message}
                </p>
              )}
            </div>
          </aside>

          {/* ── Main content ── */}
          <main className="v1-paper flex flex-1 flex-col overflow-hidden">
            {databaseError && (
              <div
                className="px-4 py-3 text-sm"
                style={{
                  borderBottom: "1.5px solid var(--v1-accent-2)",
                  background: "rgba(233,78,27,0.08)",
                  color: "var(--v1-accent-2)",
                }}
              >
                <p className="font-medium">{t("errors.databaseInitFailed")}</p>
                <p className="mt-1 text-xs opacity-80">{databaseError}</p>
              </div>
            )}

            <div id="main-content" className="flex-1 overflow-y-auto">
              <RouterOutlet />
            </div>
          </main>
        </div>
      )}

      {/* macOS Accessibility permission guide */}
      <AccessibilityGuide
        visible={showAccessibilityGuide}
        onClose={() => setShowAccessibilityGuide(false)}
      />

      {/* First-launch permissions review (macOS). Waits for the product
          onboarding to finish so we don't stack two modals. */}
      <PermissionsOnboarding
        visible={showPermissionsOnboarding && !showOnboarding}
        onComplete={() => {
          setShowPermissionsOnboarding(false);
          void (async () => {
            try {
              const { load } = await import("@tauri-apps/plugin-store");
              const store = await load("settings.json");
              await store.set("permissionsOnboardingCompleted", true);
              await store.save();
            } catch (err) {
              logError("dashboard", "Failed to persist permissions onboarding flag", err);
            }
          })();
        }}
      />

      {/* Mobile app QR code dialog */}
      <MobileAppDialog open={showMobileAppDialog} onOpenChange={setShowMobileAppDialog} />

      {/* Update available dialog: rich changelog + skip/remind/install */}
      <UpdateAvailableDialog
        open={showUpdateAvailableDialog}
        newVersion={availableVersion}
        currentVersion={APP_VERSION}
        releaseBody={releaseBody}
        isDownloading={isUpdateDownloading}
        onSkipVersion={handleSkipVersion}
        onRemindLater={handleRemindLater}
        onInstallUpdate={handleInstallUpdate}
      />

      {/* Upgrade notice AlertDialog */}
      <AlertDialog open={showUpgradeNoticeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mainApp.upgradeNotice.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  <li>{t("mainApp.upgradeNotice.item1")}</li>
                  <li>{t("mainApp.upgradeNotice.item2")}</li>
                  <li>{t("mainApp.upgradeNotice.item3")}</li>
                  <li>{t("mainApp.upgradeNotice.item4")}</li>
                  <li>{t("mainApp.upgradeNotice.item5")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowUpgradeNoticeDialog(false)}>
              {t("mainApp.upgradeNotice.dismiss")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual update AlertDialog: new version found, ask to start */}
      <AlertDialog open={showManualUpdateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mainApp.update.newVersionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("mainApp.update.newVersionDescription", {
                version: availableVersion,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowManualUpdateDialog(false)}>
              {t("mainApp.update.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleManualUpdate}>
              {t("mainApp.update.startUpdate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
