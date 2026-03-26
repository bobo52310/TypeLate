import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FolderOpen, HardDrive, Trash2 } from "lucide-react";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import {
  useSettingsStore,
  type RecordingRetentionPolicy,
  type RecordingsStorageInfo,
} from "@/stores/settingsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const RETENTION_OPTIONS: RecordingRetentionPolicy[] = ["forever", "30", "14", "7", "none"];

export default function RecordingSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const recordingRetentionPolicy = useSettingsStore((s) => s.recordingRetentionPolicy);
  const saveRecordingRetentionPolicy = useSettingsStore((s) => s.saveRecordingRetentionPolicy);
  const getRecordingsStorageInfo = useSettingsStore((s) => s.getRecordingsStorageInfo);
  const openRecordingsFolder = useSettingsStore((s) => s.openRecordingsFolder);
  const deleteAllRecordingFiles = useHistoryStore((s) => s.deleteAllRecordingFiles);

  const [storageInfo, setStorageInfo] = useState<RecordingsStorageInfo | null>(null);
  const [isDeletingRecordings, setIsDeletingRecordings] = useState(false);

  const refreshStorageInfo = useCallback(async () => {
    try {
      const info = await getRecordingsStorageInfo();
      setStorageInfo(info);
    } catch {
      // Silently fail — storage info is informational only
    }
  }, [getRecordingsStorageInfo]);

  useEffect(() => {
    void refreshStorageInfo();
  }, [refreshStorageInfo]);

  async function handleRetentionChange(value: string) {
    const policy = value as RecordingRetentionPolicy;
    try {
      await saveRecordingRetentionPolicy(policy);
      feedback.show("success", t("settings.recording.retentionSaved"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenFolder() {
    try {
      await openRecordingsFolder();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteAllRecordings() {
    try {
      setIsDeletingRecordings(true);
      const deletedCount = await deleteAllRecordingFiles();
      feedback.show("success", t("settings.recording.deleteSuccess", { count: deletedCount }));
      await refreshStorageInfo();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingRecordings(false);
    }
  }

  function getRetentionLabel(policy: RecordingRetentionPolicy): string {
    const labels: Record<RecordingRetentionPolicy, string> = {
      forever: t("settings.recording.retentionForever"),
      "30": t("settings.recording.retention30"),
      "14": t("settings.recording.retention14"),
      "7": t("settings.recording.retention7"),
      none: t("settings.recording.retentionNone"),
    };
    return labels[policy];
  }

  return (
    <SettingsGroup
      title={t("settings.recording.title")}
      description={t("settings.recording.description")}
    >
      {/* Storage statistics */}
      <SettingsRow label={t("settings.recording.storageUsed")}>
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {storageInfo
              ? storageInfo.fileCount > 0
                ? t("settings.recording.storageInfo", {
                    size: formatFileSize(storageInfo.totalSizeBytes),
                    count: storageInfo.fileCount,
                  })
                : t("settings.recording.storageEmpty")
              : "—"}
          </span>
        </div>
      </SettingsRow>

      {/* Retention policy */}
      <SettingsRow
        label={t("settings.recording.retentionPolicy")}
        description={t("settings.recording.retentionPolicyDescription")}
        htmlFor="retention-policy"
      >
        <Select
          value={recordingRetentionPolicy}
          onValueChange={(val) => void handleRetentionChange(val)}
        >
          <SelectTrigger id="retention-policy" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {getRetentionLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {recordingRetentionPolicy === "none" && (
        <div className="px-4 py-2">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("settings.recording.retentionNoneDescription")}
          </p>
        </div>
      )}

      {/* Storage path + Open folder */}
      <SettingsRow label={t("settings.recording.storagePath")}>
        <div className="flex items-center gap-2">
          {storageInfo && (
            <span className="max-w-40 truncate text-xs text-muted-foreground" title={storageInfo.path}>
              {storageInfo.path}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleOpenFolder()}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            {t("settings.recording.openFolder")}
          </Button>
        </div>
      </SettingsRow>

      {/* Delete all */}
      <div className="px-4 py-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isDeletingRecordings}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("settings.recording.deleteAll")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings.recording.deleteConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.recording.deleteConfirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleDeleteAllRecordings()}>
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
