import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const OnboardingView = lazy(() => import("@/views/OnboardingView"));
import { BookOpen, Cloud, CloudOff, Download, History, LayoutDashboard, Loader2, Megaphone, Settings, Smartphone, Sparkles, type LucideIcon } from "lucide-react";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
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

import logoTypeLate from "@/assets/logo-typelate.png";

import { APP_VERSION } from "@/lib/version";

// ── Navigation items ──

interface NavItem {
  path: RoutePath;
  labelKey: string;
  icon: LucideIcon;
}

const NAV_GROUPS: NavItem[][] = [
  // Overview
  [
    { path: "/dashboard", labelKey: "mainApp.nav.dashboard", icon: LayoutDashboard },
    { path: "/history", labelKey: "mainApp.nav.history", icon: History },
    { path: "/dictionary", labelKey: "mainApp.nav.dictionary", icon: BookOpen },
  ],
  // Tuning
  [
    { path: "/ai", labelKey: "mainApp.nav.ai", icon: Sparkles },
  ],
  // System — Settings parent navigates to /settings/general
  [
    { path: "/settings/general", labelKey: "mainApp.nav.settings", icon: Settings },
  ],
];

const ALL_NAV_ITEMS = NAV_GROUPS.flat();

// Settings sub-navigation items shown under "Settings" in sidebar
const SETTINGS_SUB_ITEMS: { path: RoutePath; labelKey: string }[] = [
  { path: "/settings/general", labelKey: "settings.group.general" },
  { path: "/settings/voice", labelKey: "settings.group.voice" },
  { path: "/settings/permissions", labelKey: "settings.group.permissions" },
  { path: "/settings/about", labelKey: "settings.group.about" },
];

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

      {/* macOS custom title bar: fixed overlay for window dragging */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center gap-1.5 border-b border-border bg-background"
      >
        <img src={logoTypeLate} alt="" className="h-4 w-4 rounded pointer-events-none select-none" data-tauri-drag-region />
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
              {NAV_GROUPS.map((group, groupIndex) => (
                <SidebarGroup key={groupIndex}>
                  <SidebarGroupContent>
                    <SidebarMenu role="navigation" aria-label="Main navigation">
                      {group.map((item) => {
                        const globalIndex = ALL_NAV_ITEMS.indexOf(item);
                        const isSettingsParent = item.path === "/settings/general";
                        const isActive = isSettingsParent
                          ? currentPath.startsWith("/settings")
                          : currentPath === item.path;
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              isActive={isActive}
                              onClick={() => navigate(item.path)}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                  e.preventDefault();
                                  const next =
                                    e.key === "ArrowDown"
                                      ? (globalIndex + 1) % ALL_NAV_ITEMS.length
                                      : (globalIndex - 1 + ALL_NAV_ITEMS.length) %
                                        ALL_NAV_ITEMS.length;
                                  const allButtons = document.querySelectorAll(
                                    "[role=navigation] button",
                                  );
                                  (allButtons?.[next] as HTMLElement | undefined)?.focus();
                                }
                              }}
                            >
                              <item.icon />
                              <span>{t(item.labelKey)}</span>
                            </SidebarMenuButton>
                            {isSettingsParent && currentPath.startsWith("/settings") && (
                              <SidebarMenuSub>
                                {SETTINGS_SUB_ITEMS.map((sub) => (
                                  <SidebarMenuSubItem key={sub.path}>
                                    <SidebarMenuSubButton
                                      isActive={currentPath === sub.path}
                                      onClick={() => navigate(sub.path)}
                                    >
                                      <span>{t(sub.labelKey)}</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border px-4 py-2">
              {easterEggSlogan && (
                <div className="mb-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-center">
                  <p className="text-xs italic text-primary">&ldquo;{easterEggSlogan}&rdquo;</p>
                </div>
              )}
              <div className="flex items-center gap-3 mb-1">
                <button
                  onClick={() => {
                    void import("@tauri-apps/plugin-shell").then((m) =>
                      m.open("https://github.com/bobo52310/TypeLate/releases"),
                    );
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Megaphone className="h-3 w-3" />
                  <span>{t("mainApp.footer.whatsNew")}</span>
                </button>
                <button
                  onClick={() => setShowMobileAppDialog(true)}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Smartphone className="h-3 w-3" />
                  <span>{t("mainApp.footer.mobileApp")}</span>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleVersionClick}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
                    disabled={isCheckingUpdate}
                  >
                    v{APP_VERSION}
                    {isCheckingUpdate && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                  </button>
                  {todayCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/70">
                      {t("home.statsBar.todayCount")} {todayCount}
                    </span>
                  )}
                  {syncIsConnected && (
                    syncIsSyncing ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : syncError ? (
                      <CloudOff className="h-3 w-3 text-destructive" />
                    ) : (
                      <Cloud className="h-3 w-3 text-primary" />
                    )
                  )}
                </div>
                {(updateState === "update-available" || updateState === "ready-to-install") && (
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
                    updateFeedback.type === "success" ? "text-primary" : "text-destructive"
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
