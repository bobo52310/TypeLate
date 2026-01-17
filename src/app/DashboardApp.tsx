import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const OnboardingView = lazy(() => import("@/views/OnboardingView"));
import {
  Download,
  FileText,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { useTauriEvent, VOCABULARY_CHANGED } from "@/hooks/useTauriEvent";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { captureError } from "@/lib/sentry";
import { initSentryForDashboard } from "@/lib/sentry";
import { initializeDatabase, getDatabaseInitError } from "@/lib/database";
import { useHashRouter, RouterOutlet, type RoutePath } from "./router";

import logoYan from "@/assets/logo-yan.png";

import { APP_VERSION } from "@/lib/version";

// ── Navigation items ──

interface NavItem {
  path: RoutePath;
  labelKey: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", labelKey: "mainApp.nav.dashboard", icon: LayoutDashboard },
  { path: "/history", labelKey: "mainApp.nav.history", icon: FileText },
  { path: "/settings", labelKey: "mainApp.nav.settings", icon: Settings },
];

// ── Update UI types ──

type UpdateUiState = "idle" | "checking" | "downloading" | "ready-to-install" | "installing";

const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
const AUTO_CHECK_INTERVAL_MS = 15 * 60_000; // 15 minutes

// ── Component ──

export function DashboardApp() {
  const { t } = useTranslation();
  const { currentPath, navigate } = useHashRouter();

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingCheckedRef = useRef(false);

  // Database error state
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  // Accessibility guide (placeholder)
  const [showAccessibilityGuide, setShowAccessibilityGuide] = useState(false);

  // Update state
  const [updateState, setUpdateState] = useState<UpdateUiState>("idle");
  const [availableVersion, setAvailableVersion] = useState("");
  const updateFeedback = useFeedbackMessage();

  // AlertDialog visibility
  const [showAutoInstallDialog, setShowAutoInstallDialog] = useState(false);
  const [showManualUpdateDialog, setShowManualUpdateDialog] = useState(false);
  const [showUpgradeNoticeDialog, setShowUpgradeNoticeDialog] = useState(false);

  // Refs for cleanup
  const autoCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initGuardRef = useRef(false);

  // Store subscriptions
  const showPromptUpgradeNotice = useSettingsStore((s) => s.showPromptUpgradeNotice);
  const isRecordingAutoCleanupEnabled = useSettingsStore((s) => s.isRecordingAutoCleanupEnabled);
  const recordingAutoCleanupDays = useSettingsStore((s) => s.recordingAutoCleanupDays);

  // ── Listen for VOCABULARY_CHANGED from HUD window ──
  useTauriEvent(VOCABULARY_CHANGED, () => {
    console.log("[main-window] VOCABULARY_CHANGED received, refreshing termList");
    void useVocabularyStore.getState().fetchTermList();
  });

  // ── Watch for upgrade notice ──
  useEffect(() => {
    if (showPromptUpgradeNotice) {
      setShowUpgradeNoticeDialog(true);
      useSettingsStore.setState({ showPromptUpgradeNotice: false });
    }
  }, [showPromptUpgradeNotice]);

  // ── Auto-update flow ──

  const autoCheckAndDownload = useCallback(async () => {
    // Only proceed when idle to avoid concurrent checks
    const currentState = updateStateRef.current;
    if (currentState !== "idle") return;

    try {
      const { checkForAppUpdate, downloadUpdate } = await import("@/lib/autoUpdater");
      const result = await checkForAppUpdate();

      if (result.status !== "update-available" || !result.version) return;

      setAvailableVersion(result.version);
      setUpdateState("downloading");

      await downloadUpdate();

      setUpdateState("ready-to-install");

      // Show Dashboard window and prompt for install
      const currentWindow = getCurrentWindow();
      await currentWindow.show();
      await currentWindow.setFocus();

      setShowAutoInstallDialog(true);
    } catch (err) {
      console.error("[main-window] Auto update check/download failed:", err);
      captureError(err, { source: "updater", step: "auto-check" });
      setUpdateState("idle");
    }
  }, []);

  // Ref to track updateState for the async callback
  const updateStateRef = useRef<UpdateUiState>("idle");
  useEffect(() => {
    updateStateRef.current = updateState;
  }, [updateState]);

  const handleAutoInstall = useCallback(async () => {
    setShowAutoInstallDialog(false);
    setUpdateState("installing");
    try {
      const { installAndRelaunch } = await import("@/lib/autoUpdater");
      await installAndRelaunch();
    } catch (err) {
      console.error("[main-window] Auto install failed:", err);
      updateFeedback.show("error", t("mainApp.update.installFailed"));
      setUpdateState("idle");
      setAvailableVersion("");
    }
  }, [t, updateFeedback]);

  const handleAutoInstallLater = useCallback(() => {
    setShowAutoInstallDialog(false);
    // Keep ready-to-install state — icon rail still shows indicator
  }, []);

  const handleSidebarInstall = useCallback(() => {
    setShowAutoInstallDialog(true);
  }, []);

  // ── Manual update flow ──

  const handleManualUpdate = useCallback(async () => {
    setShowManualUpdateDialog(false);
    setUpdateState("downloading");
    try {
      const { downloadInstallAndRelaunch } = await import("@/lib/autoUpdater");
      await downloadInstallAndRelaunch();
    } catch (err) {
      console.error("[main-window] Manual update failed:", err);
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
          if (!completed && !settingsActions.hasApiKey) {
            setShowOnboarding(true);
          }
        } catch {
          // If check fails, skip onboarding
        }
      }

      // macOS accessibility check
      const isMacOS = navigator.userAgent.includes("Macintosh");
      if (isMacOS) {
        try {
          const hasPermission = await invoke<boolean>(
            "check_accessibility_permission_command",
          );
          setShowAccessibilityGuide(!hasPermission);
        } catch (error) {
          console.error(
            "[main-window] Failed to check accessibility permission:",
            error,
          );
          captureError(error, {
            source: "accessibility",
            step: "check-permission",
          });
        }
      }

      // Auto-update schedule: 5s delay, then every 15 min
      autoCheckTimeoutRef.current = setTimeout(() => {
        void autoCheckAndDownload();
        autoCheckIntervalRef.current = setInterval(
          () => void autoCheckAndDownload(),
          AUTO_CHECK_INTERVAL_MS,
        );
      }, AUTO_CHECK_INITIAL_DELAY_MS);
    }

    void bootstrap();

    return () => {
      if (autoCheckTimeoutRef.current) clearTimeout(autoCheckTimeoutRef.current);
      if (autoCheckIntervalRef.current) clearInterval(autoCheckIntervalRef.current);
    };
  }, [autoCheckAndDownload]);

  // ── Recording auto-cleanup (runs when settings change) ──
  useEffect(() => {
    if (!isRecordingAutoCleanupEnabled || recordingAutoCleanupDays <= 0) return;

    invoke("cleanup_old_recordings", { days: recordingAutoCleanupDays }).catch(
      (err) => {
        console.error("[main-window] Recording cleanup failed:", err);
        captureError(err, { source: "recording-cleanup" });
      },
    );
  }, [isRecordingAutoCleanupEnabled, recordingAutoCleanupDays]);

  // ── Render ──

  return (
    <>
      {/* macOS custom title bar: fixed overlay for window dragging */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
      >
        <span
          data-tauri-drag-region
          className="text-xs font-medium text-muted-foreground select-none"
        >
          SayIt - 言
        </span>
      </div>

      {showOnboarding ? (
        <OnboardingView onComplete={() => setShowOnboarding(false)} />
      ) : (
        <div className="flex h-screen pt-9">
          {/* Icon rail */}
          <TooltipProvider>
            <nav className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-background py-3">
              <img src={logoYan} alt="言" className="mb-4 h-6 w-6" />

              {NAV_ITEMS.map((item) => (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(item.path)}
                      className={cn(
                        "mb-1 flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                        currentPath.startsWith(item.path)
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4.5 w-4.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
                </Tooltip>
              ))}

              <div className="mt-auto flex flex-col items-center gap-2">
                {updateState === "ready-to-install" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleSidebarInstall}
                        className="relative flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-accent/50"
                      >
                        <Download className="h-4 w-4" />
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t("mainApp.update.installNow")}
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="text-[10px] text-muted-foreground">v{APP_VERSION}</span>
              </div>
            </nav>
          </TooltipProvider>

          {/* Content */}
          <main className="flex flex-1 flex-col overflow-hidden">
            {databaseError && (
              <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <p className="font-medium">{t("errors.databaseInitFailed")}</p>
                <p className="mt-1 text-xs text-destructive/80">{databaseError}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <RouterOutlet />
            </div>
          </main>
        </div>
      )}

      {/* Accessibility guide placeholder */}
      {showAccessibilityGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-background p-6 shadow-lg">
            <p className="text-foreground">Accessibility Guide (placeholder)</p>
            <Button
              className="mt-4"
              onClick={() => setShowAccessibilityGuide(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Auto-install AlertDialog: update downloaded, ask to install & restart */}
      <AlertDialog open={showAutoInstallDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("mainApp.update.autoInstallTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("mainApp.update.autoInstallDescription", {
                version: availableVersion,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleAutoInstallLater}>
              {t("mainApp.update.later")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleAutoInstall}>
              {t("mainApp.update.installRestart")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upgrade notice AlertDialog */}
      <AlertDialog open={showUpgradeNoticeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("mainApp.upgradeNotice.title")}
            </AlertDialogTitle>
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
            <AlertDialogTitle>
              {t("mainApp.update.newVersionTitle")}
            </AlertDialogTitle>
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
