import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

export default function RecordingSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isRecordingAutoCleanupEnabled = useSettingsStore(
    (s) => s.isRecordingAutoCleanupEnabled,
  );
  const recordingAutoCleanupDays = useSettingsStore(
    (s) => s.recordingAutoCleanupDays,
  );
  const saveRecordingAutoCleanup = useSettingsStore(
    (s) => s.saveRecordingAutoCleanup,
  );
  const deleteAllRecordingFiles = useHistoryStore(
    (s) => s.deleteAllRecordingFiles,
  );

  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [isDeletingRecordings, setIsDeletingRecordings] = useState(false);

  useEffect(() => {
    setAutoCleanupEnabled(isRecordingAutoCleanupEnabled);
    setCleanupDays(recordingAutoCleanupDays);
  }, [isRecordingAutoCleanupEnabled, recordingAutoCleanupDays]);

  async function handleToggleAutoCleanup() {
    const newValue = !autoCleanupEnabled;
    setAutoCleanupEnabled(newValue);
    try {
      await saveRecordingAutoCleanup(newValue, cleanupDays);
      feedback.show(
        "success",
        newValue
          ? t("settings.recording.autoCleanupEnabled")
          : t("settings.recording.autoCleanupDisabled"),
      );
    } catch (err) {
      setAutoCleanupEnabled(!newValue);
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleSaveCleanupDays() {
    try {
      await saveRecordingAutoCleanup(autoCleanupEnabled, cleanupDays);
      feedback.show("success", t("settings.recording.daysSaved"));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleDeleteAllRecordings() {
    try {
      setIsDeletingRecordings(true);
      const deletedCount = await deleteAllRecordingFiles();
      feedback.show(
        "success",
        t("settings.recording.deleteSuccess", { count: deletedCount }),
      );
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsDeletingRecordings(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.recording.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.recording.description")}
        </p>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="recording-auto-cleanup">
              {t("settings.recording.autoCleanup")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.recording.autoCleanupDescription")}
            </p>
          </div>
          <Switch
            id="recording-auto-cleanup"
            checked={autoCleanupEnabled}
            onCheckedChange={() => void handleToggleAutoCleanup()}
          />
        </div>

        {autoCleanupEnabled && (
          <div className="flex items-center gap-3">
            <Label htmlFor="cleanup-days">
              {t("settings.recording.retentionDays")}
            </Label>
            <Input
              id="cleanup-days"
              type="number"
              min={1}
              value={cleanupDays}
              onChange={(e) => setCleanupDays(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              {t("settings.recording.daysUnit")}
            </span>
            <Button
              size="sm"
              onClick={() => void handleSaveCleanupDays()}
            >
              {t("common.save")}
            </Button>
          </div>
        )}

        <div className="border-t border-border" />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isDeletingRecordings}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("settings.recording.deleteAll")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.recording.deleteConfirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.recording.deleteConfirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteAllRecordings()}
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
