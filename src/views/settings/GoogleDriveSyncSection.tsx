import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, CloudOff, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useGoogleDriveStore } from "@/stores/googleDriveStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

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

export default function GoogleDriveSyncSection() {
  const { t, i18n } = useTranslation();
  const feedback = useFeedbackMessage();

  const isConnected = useGoogleDriveStore((s) => s.isConnected);
  const userEmail = useGoogleDriveStore((s) => s.userEmail);
  const lastSyncAt = useGoogleDriveStore((s) => s.lastSyncAt);
  const isSyncing = useGoogleDriveStore((s) => s.isSyncing);
  const syncError = useGoogleDriveStore((s) => s.syncError);
  const storedClientId = useGoogleDriveStore((s) => s.clientId);
  const loadConnectionStatus = useGoogleDriveStore((s) => s.loadConnectionStatus);
  const saveClientId = useGoogleDriveStore((s) => s.saveClientId);
  const startOAuth = useGoogleDriveStore((s) => s.startOAuthFlow);
  const disconnect = useGoogleDriveStore((s) => s.disconnect);
  const syncNow = useGoogleDriveStore((s) => s.syncNow);

  const [clientIdInput, setClientIdInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSavingClientId, setIsSavingClientId] = useState(false);

  useEffect(() => {
    void loadConnectionStatus();
  }, [loadConnectionStatus]);

  useEffect(() => {
    setClientIdInput(storedClientId);
  }, [storedClientId]);

  async function handleSaveClientId() {
    if (!clientIdInput.trim()) return;
    try {
      setIsSavingClientId(true);
      await saveClientId(clientIdInput);
      feedback.show("success", t("common.save") + " ✓");
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingClientId(false);
    }
  }

  async function handleConnect() {
    try {
      setIsConnecting(true);
      await startOAuth();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSync() {
    try {
      const result = await syncNow();
      feedback.show(
        "success",
        t("dictionary.googleDrive.syncSuccess", { added: result.added, updated: result.updated }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "AUTH_EXPIRED") {
        feedback.show("error", t("dictionary.googleDrive.authExpired"));
      } else {
        feedback.show("error", message);
      }
    }
  }

  async function handleDisconnect() {
    await disconnect();
    feedback.show("success", t("dictionary.googleDrive.disconnect"));
  }

  const locale = i18n.language;
  const hasClientId = storedClientId.trim().length > 0;
  const clientIdChanged = clientIdInput.trim() !== storedClientId;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          <Cloud className="mr-2 inline h-4 w-4" />
          {t("dictionary.googleDrive.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">
          {t("dictionary.googleDrive.description")}
        </p>

        {/* OAuth Client ID */}
        <div className="space-y-2">
          <Label htmlFor="google-client-id">
            {t("dictionary.googleDrive.clientIdLabel")}
          </Label>
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

        {/* Connection status */}
        {hasClientId && !isConnected && (
          <Button
            onClick={() => void handleConnect()}
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

        {isConnected && (
          <div className="space-y-3">
            {/* Connected info */}
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="h-4 w-4 text-primary" />
              <span>{t("dictionary.googleDrive.connectedAs", { email: userEmail })}</span>
            </div>

            {lastSyncAt && (
              <p className="text-xs text-muted-foreground">
                {t("dictionary.googleDrive.lastSync", { time: formatSyncTime(lastSyncAt, locale) })}
              </p>
            )}

            {/* Sync + Disconnect buttons */}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void handleSync()}
                disabled={isSyncing}
              >
                {isSyncing ? (
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
                      {t("dictionary.googleDrive.description")}
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

        {/* Error display */}
        {syncError && (
          <p className="text-sm text-destructive">{syncError}</p>
        )}

        {/* Feedback */}
        {feedback.message && (
          <p
            className={`text-sm ${feedback.type === "success" ? "text-primary" : "text-destructive"}`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
