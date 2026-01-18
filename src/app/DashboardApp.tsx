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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { useDebouncedTauriEvent, VOCABULARY_CHANGED } from "@/hooks/useTauriEvent";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { captureError, initSentryForDashboard } from "@/lib/sentry";
import { IS_MAC } from "@/lib/platform";
import { initializeDatabase, getDatabaseInitError } from "@/lib/database";
import { AccessibilityGuide } from "@/components/AccessibilityGuide";
import { useHashRouter, RouterOutlet, type RoutePath } from "./router";
import { getRandomSlogan } from "@/lib/slogans";

import logoTypeLate from "@/assets/logo-typelate.png";

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

  // Sidebar logo hover slogan (stable per mount)
  const [sidebarSlogan] = useState(() => getRandomSlogan());

  // Easter egg: click version 7 times
  const [easterEggSlogan, setEasterEggSlogan] = useState<string | null>(null);
  const versionClickRef = useRef(0);
  const easterEggTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVersionClick = useCallback(() => {
    versionClickRef.current += 1;
    if (versionClickRef.current >= 7) {
      versionClickRef.current = 0;
      setEasterEggSlogan(getRandomSlogan());
      if (easterEggTimerRef.current) clearTimeout(easterEggTimerRef.current);
      easterEggTimerRef.current = setTimeout(() => setEasterEggSlogan(null), 4000);
    }
  }, []);

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

  // ── Listen for VOCABULARY_CHANGED from HUD window (debounced) ──
  useDebouncedTauriEvent(VOCABULARY_CHANGED, () => {
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
          if (!completed && !settingsActions.hasApiKey()) {
            setShowOnboarding(true);
          }
        } catch {
          // If check fails, skip onboarding
        }
      }

      // macOS accessibility check
      const isMacOS = IS_MAC;
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
      {/* Skip to content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-10 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground focus:shadow-md"
      >
        Skip to content
      </a>

      {/* macOS custom title bar: fixed overlay for window dragging */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
      >
        <span
          data-tauri-drag-region
          className="text-xs font-medium text-muted-foreground select-none"
        >
          TypeLate
        </span>
      </div>

      {showOnboarding ? (
        <OnboardingView onComplete={() => setShowOnboarding(false)} />
      ) : (
      <SidebarProvider className="h-screen !min-h-0 pt-9">
        <Sidebar collapsible="offcanvas">
          <SidebarHeader
            className="flex-row h-12 items-center gap-3 border-b border-sidebar-border px-4 cursor-default"
            title={sidebarSlogan}
          >
            <img src={logoTypeLate} alt="TypeLate" className="h-7 w-7 rounded" />
            <span
              className="text-base font-semibold text-sidebar-foreground tracking-wide"
              style={{ fontFamily: "'SF Pro Display', 'Inter', system-ui, sans-serif" }}
            >
              TypeLate
            </span>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu role="navigation" aria-label="Main navigation">
                  {NAV_ITEMS.map((item, index) => (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={currentPath.startsWith(item.path)}
                        onClick={() => navigate(item.path)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const next = e.key === "ArrowDown"
                              ? (index + 1) % NAV_ITEMS.length
                              : (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
                            const buttons = e.currentTarget.closest("[role=navigation]")?.querySelectorAll("button");
                            (buttons?.[next] as HTMLElement | undefined)?.focus();
                          }
                        }}
                      >
                        <item.icon />
                        <span>{t(item.labelKey)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border px-4 py-2">
            {easterEggSlogan && (
              <div className="mb-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-center">
                <p className="text-xs italic text-primary">&ldquo;{easterEggSlogan}&rdquo;</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <button
                onClick={handleVersionClick}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
              >
                v{APP_VERSION}
              </button>
              {updateState === "ready-to-install" && (
                <Button
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={handleSidebarInstall}
                >
                  <Download className="h-3 w-3" />
                  {t("mainApp.update.installNow")}
                </Button>
              )}
            </div>

            {updateFeedback.message && (
              <p
                className={`mt-1 text-xs ${
                  updateFeedback.type === "success"
                    ? "text-primary"
                    : "text-destructive"
                }`}
              >
                {updateFeedback.message}
              </p>
            )}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="overflow-hidden">
          {databaseError && (
            <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">{t("errors.databaseInitFailed")}</p>
              <p className="mt-1 text-xs text-destructive/80">{databaseError}</p>
            </div>
          )}

          <div id="main-content" className="flex-1 overflow-y-auto">
            <RouterOutlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
      )}

      {/* macOS Accessibility permission guide */}
      <AccessibilityGuide
        visible={showAccessibilityGuide}
        onClose={() => setShowAccessibilityGuide(false)}
      />

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
