import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Accessibility, Keyboard, Mic } from "lucide-react";
import { SettingsGroup } from "@/components/settings-layout";
import { PermissionRow } from "@/components/PermissionRow";
import {
  openAccessibilitySettings,
  openMicrophoneSettings,
  requestMicrophone,
  usePermissions,
  type PermissionStatus,
} from "@/hooks/usePermissions";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHashRouter } from "@/app/router";
import { captureError } from "@/lib/sentry";
import { logError } from "@/lib/logger";
import { IS_MAC } from "@/lib/platform";

export default function PermissionsSection() {
  const { t } = useTranslation();
  const { navigate } = useHashRouter();
  const { snapshot, refresh } = usePermissions(true);
  const [isWorking, setIsWorking] = useState<"mic" | "accessibility" | null>(null);

  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);
  const getTriggerKeyDisplayName = useSettingsStore((s) => s.getTriggerKeyDisplayName);

  const hotkeyLabel = useMemo(() => {
    if (!hotkeyConfig?.triggerKey) return "";
    return getTriggerKeyDisplayName(hotkeyConfig.triggerKey);
  }, [hotkeyConfig, getTriggerKeyDisplayName]);

  // On macOS "keyboard shortcut" setup is always "granted" as long as a key is
  // configured (the default is Fn). We still surface the row so users can jump
  // to the hotkey configuration screen from the permissions overview.
  const keyboardStatus: PermissionStatus = hotkeyConfig?.triggerKey ? "granted" : "notDetermined";

  const handleMicAction = useCallback(async () => {
    if (!IS_MAC) return;
    setIsWorking("mic");
    try {
      if (snapshot.microphone === "denied" || snapshot.microphone === "restricted") {
        await openMicrophoneSettings();
      } else {
        await requestMicrophone();
      }
      await refresh();
    } catch (error) {
      logError("permissions", "Microphone action failed", error);
      captureError(error, { source: "permissions", step: "microphone-action" });
    } finally {
      setIsWorking(null);
    }
  }, [snapshot.microphone, refresh]);

  const handleAccessibilityAction = useCallback(async () => {
    if (!IS_MAC) return;
    setIsWorking("accessibility");
    try {
      await openAccessibilitySettings();
      // Re-check after a short delay; user needs to toggle the setting in
      // System Settings and come back. The polling in usePermissions will
      // also pick it up automatically.
      const result = await refresh();
      if (result.accessibility === "granted") {
        try {
          await invoke("reinitialize_hotkey_listener");
        } catch (err) {
          captureError(err, { source: "permissions", step: "reinitialize" });
        }
      }
    } finally {
      setIsWorking(null);
    }
  }, [refresh]);

  const handleConfigureHotkey = useCallback(() => {
    navigate("/settings/general");
  }, [navigate]);

  return (
    <div className="space-y-6">
      <div className="space-y-1 px-1">
        <h2 className="text-lg font-semibold text-foreground">
          {t("settings.permissions.title")}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.permissions.subtitle")}
        </p>
      </div>

      <SettingsGroup>
        <PermissionRow
          icon={Keyboard}
          iconTint="bg-emerald-500/12"
          title={t("settings.permissions.keyboard.title")}
          description={t("settings.permissions.keyboard.description")}
          status={keyboardStatus}
          trailingText={hotkeyLabel || undefined}
          actionLabel={t("settings.permissions.keyboard.configure")}
          onAction={handleConfigureHotkey}
        />

        <div className="border-t border-border" />

        <PermissionRow
          icon={Mic}
          iconTint="bg-sky-500/12"
          title={t("settings.permissions.microphone.title")}
          description={t("settings.permissions.microphone.description")}
          status={snapshot.microphone}
          actionLabel={
            snapshot.microphone === "denied" || snapshot.microphone === "restricted"
              ? t("settings.permissions.openSettings")
              : t("settings.permissions.grant")
          }
          onAction={() => void handleMicAction()}
          onRefresh={() => void refresh()}
          isLoading={isWorking === "mic"}
        />

        <div className="border-t border-border" />

        <PermissionRow
          icon={Accessibility}
          iconTint="bg-violet-500/12"
          title={t("settings.permissions.accessibility.title")}
          description={t("settings.permissions.accessibility.description")}
          status={snapshot.accessibility}
          actionLabel={t("settings.permissions.openSettings")}
          onAction={() => void handleAccessibilityAction()}
          onRefresh={() => void refresh()}
          isLoading={isWorking === "accessibility"}
        />
      </SettingsGroup>

      {!IS_MAC && (
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.permissions.nonMacNote")}
        </p>
      )}
    </div>
  );
}
