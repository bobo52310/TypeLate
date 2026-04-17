import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Monitor,
  Download,
  Merge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useSyncStore } from "@/stores/syncStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { captureError } from "@/lib/sentry";
import type { SyncStrategy, SyncConflictInfo } from "@/lib/googleDriveSync";

function formatSyncTime(isoString: string, locale: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export default function CloudSyncSection({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const feedback = useFeedbackMessage();

  const providerType = useSyncStore((s) => s.providerType);
  const isConnected = useSyncStore((s) => s.isConnected);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const syncError = useSyncStore((s) => s.syncError);
  const syncFolderPath = useSyncStore((s) => s.syncFolderPath);
  const userEmail = useSyncStore((s) => s.userEmail);
  const storedClientId = useSyncStore((s) => s.clientId);
  const loadSyncStatus = useSyncStore((s) => s.loadSyncStatus);
  const setupFileSync = useSyncStore((s) => s.setupFileSync);
  const changeSyncFolder = useSyncStore((s) => s.changeSyncFolder);
  const saveClientId = useSyncStore((s) => s.saveClientId);
  const setupGoogleDrive = useSyncStore((s) => s.setupGoogleDrive);
  const disconnect = useSyncStore((s) => s.disconnect);
  const syncNow = useSyncStore((s) => s.syncNow);

  const checkConflict = useSyncStore((s) => s.checkConflict);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clientIdInput, setClientIdInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSavingClientId, setIsSavingClientId] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<SyncConflictInfo | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus]);

  useEffect(() => {
    setClientIdInput(storedClientId);
  }, [storedClientId]);

  // Show advanced panel if already connected via Google Drive
  useEffect(() => {
    if (providerType === "google-drive") {
      setShowAdvanced(true);
    }
  }, [providerType]);

  async function handleSetupFileSync() {
    try {
      await setupFileSync();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleChangeSyncFolder() {
    try {
      await changeSyncFolder();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSync() {
    // Check for conflict before syncing
    try {
      setIsCheckingConflict(true);
      const conflict = await checkConflict();
      if (conflict) {
        setConflictInfo(conflict);
        setShowConflictDialog(true);
        return;
      }
    } catch (err) {
      captureError(err, { source: "sync", step: "check-conflict" });
      // If conflict check fails, proceed with default merge
    } finally {
      setIsCheckingConflict(false);
    }

    await executeSyncWithStrategy("merge");
  }

  async function executeSyncWithStrategy(strategy: SyncStrategy) {
    try {
      const result = await syncNow(strategy);
      if (result.added === 0 && result.updated === 0) {
        feedback.show("success", t("dictionary.cloudSync.syncUpToDate"));
      } else {
        feedback.show(
          "success",
          t("dictionary.cloudSync.syncSuccess", { added: result.added, updated: result.updated }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "AUTH_EXPIRED") {
        feedback.show("error", t("dictionary.googleDrive.authExpired"));
      } else {
        feedback.show("error", message);
      }
    }
  }

  function handleConflictChoice(strategy: SyncStrategy) {
    setShowConflictDialog(false);
    setConflictInfo(null);
    void executeSyncWithStrategy(strategy);
  }

  async function handleDisconnect() {
    await disconnect();
    feedback.show("success", t("dictionary.cloudSync.disconnected"));
  }

  async function handleSaveClientId() {
    if (!clientIdInput.trim()) return;
    try {
      setIsSavingClientId(true);
      await saveClientId(clientIdInput);
      feedback.show("success", t("common.save") + " \u2713");
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingClientId(false);
    }
  }

  async function handleConnectGoogleDrive() {
    try {
      setIsConnecting(true);
      await setupGoogleDrive();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }

  const locale = i18n.language;
  const hasClientId = storedClientId.trim().length > 0;
  const clientIdChanged = clientIdInput.trim() !== storedClientId;

  const content = (
    <>
      <div className={embedded ? "space-y-3 py-3" : "space-y-3 px-4 py-3"}>
        <p className="text-sm text-muted-foreground">
          {t("dictionary.cloudSync.description")}
        </p>

        {/* ── Connected: File Sync ── */}
        {isConnected && providerType === "file" && syncFolderPath && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="h-4 w-4 text-primary" />
              <span>
                {t("dictionary.cloudSync.syncingTo", { path: shortenPath(syncFolderPath) })}
              </span>
            </div>

            {lastSyncAt && (
              <p className="text-xs text-muted-foreground">
                {t("dictionary.cloudSync.lastSync", {
                  time: formatSyncTime(lastSyncAt, locale),
                })}
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleSync()} disabled={isSyncing || isCheckingConflict}>
                {isSyncing || isCheckingConflict ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {isSyncing
                  ? t("dictionary.cloudSync.syncing")
                  : t("dictionary.cloudSync.syncNow")}
              </Button>

              <Button size="sm" variant="outline" onClick={() => void handleChangeSyncFolder()}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("dictionary.cloudSync.changeFolder")}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <CloudOff className="mr-2 h-4 w-4" />
                    {t("dictionary.cloudSync.disconnect")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("dictionary.cloudSync.disconnectConfirm")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("dictionary.cloudSync.disconnectDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDisconnect()}>
                      {t("dictionary.cloudSync.disconnect")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* ── Connected: Google Drive ── */}
        {isConnected && providerType === "google-drive" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="h-4 w-4 text-primary" />
              <span>{t("dictionary.googleDrive.connectedAs", { email: userEmail })}</span>
            </div>

            {lastSyncAt && (
              <p className="text-xs text-muted-foreground">
                {t("dictionary.googleDrive.lastSync", {
                  time: formatSyncTime(lastSyncAt, locale),
                })}
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleSync()} disabled={isSyncing || isCheckingConflict}>
                {isSyncing || isCheckingConflict ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {isSyncing
                  ? t("dictionary.googleDrive.syncing")
                  : t("dictionary.googleDrive.syncNow")}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <CloudOff className="mr-2 h-4 w-4" />
                    {t("dictionary.googleDrive.disconnect")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("dictionary.googleDrive.disconnectConfirm")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("dictionary.cloudSync.disconnectDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDisconnect()}>
                      {t("dictionary.googleDrive.disconnect")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* ── Not Connected ── */}
        {!isConnected && (
          <div className="space-y-4">
            {/* Primary: File-based sync */}
            <div className="space-y-2">
              <Button onClick={() => void handleSetupFileSync()}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("dictionary.cloudSync.chooseFolder")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("dictionary.cloudSync.folderHint")}
              </p>
            </div>

            {/* Advanced: Google Drive API */}
            <div className="border-t pt-3">
              <button
                type="button"
                className="flex w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {t("dictionary.cloudSync.advancedGoogleDrive")}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 pl-5">
                  <p className="text-xs text-muted-foreground">
                    {t("dictionary.cloudSync.advancedHint")}
                  </p>

                  {/* OAuth Client ID */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t("dictionary.googleDrive.clientIdLabel")}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="google-client-id"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value)}
                        placeholder="xxxx.apps.googleusercontent.com"
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!clientIdInput.trim() || !clientIdChanged || isSavingClientId}
                        onClick={() => void handleSaveClientId()}
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("dictionary.googleDrive.clientIdHint")}{" "}
                      <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          void import("@tauri-apps/plugin-shell").then((m) =>
                            m.open("https://console.cloud.google.com/apis/credentials"),
                          );
                        }}
                      >
                        console.cloud.google.com
                        <ExternalLink className="ml-0.5 inline h-3 w-3" />
                      </a>
                    </p>
                  </div>

                  {hasClientId && (
                    <Button
                      size="sm"
                      onClick={() => void handleConnectGoogleDrive()}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Cloud className="mr-2 h-4 w-4" />
                      )}
                      {t("dictionary.googleDrive.connect")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {syncError && <p className="text-sm text-destructive">{syncError}</p>}
      </div>

      {/* Sync conflict dialog */}
      <AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dictionary.cloudSync.conflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dictionary.cloudSync.conflict.description", {
                remoteCount: conflictInfo?.remoteCount ?? 0,
                localCount: conflictInfo?.localCount ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 py-2">
            <Button
              variant="outline"
              className="justify-start gap-3 h-auto py-3"
              onClick={() => handleConflictChoice("keep-local")}
            >
              <Monitor className="h-4 w-4 shrink-0" />
              <div className="text-left">
                <div className="font-medium">{t("dictionary.cloudSync.conflict.keepLocal")}</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {t("dictionary.cloudSync.conflict.keepLocalHint")}
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-3 h-auto py-3"
              onClick={() => handleConflictChoice("keep-remote")}
            >
              <Download className="h-4 w-4 shrink-0" />
              <div className="text-left">
                <div className="font-medium">{t("dictionary.cloudSync.conflict.keepRemote")}</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {t("dictionary.cloudSync.conflict.keepRemoteHint")}
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-3 h-auto py-3"
              onClick={() => handleConflictChoice("merge")}
            >
              <Merge className="h-4 w-4 shrink-0" />
              <div className="text-left">
                <div className="font-medium">{t("dictionary.cloudSync.conflict.merge")}</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {t("dictionary.cloudSync.conflict.mergeHint")}
                </div>
              </div>
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </>
  );

  if (embedded) return content;

  return (
    <SettingsGroup title={t("dictionary.cloudSync.title")}>
      {content}
    </SettingsGroup>
  );
}
