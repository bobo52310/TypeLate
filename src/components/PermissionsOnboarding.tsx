import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Accessibility, ArrowRight, Keyboard, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionRow } from "@/components/PermissionRow";
import {
  openAccessibilitySettings,
  openMicrophoneSettings,
  requestMicrophone,
  usePermissions,
  type PermissionsSnapshot,
  type PermissionStatus,
} from "@/hooks/usePermissions";
import { useSettingsStore } from "@/stores/settingsStore";
import { captureError } from "@/lib/sentry";
import { logError } from "@/lib/logger";
import { IS_MAC } from "@/lib/platform";

interface PermissionsOnboardingProps {
  visible: boolean;
  onComplete: () => void;
}

function countMissing(snapshot: PermissionsSnapshot): number {
  let n = 0;
  if (snapshot.microphone !== "granted") n += 1;
  if (snapshot.accessibility !== "granted") n += 1;
  return n;
}

export function PermissionsOnboarding({ visible, onComplete }: PermissionsOnboardingProps) {
  const { t } = useTranslation();
  const { snapshot, refresh } = usePermissions(visible);
  const [isWorking, setIsWorking] = useState(false);
  const completedRef = useRef(false);

  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);
  const getTriggerKeyDisplayName = useSettingsStore((s) => s.getTriggerKeyDisplayName);

  const hotkeyLabel = useMemo(() => {
    if (!hotkeyConfig?.triggerKey) return "";
    return getTriggerKeyDisplayName(hotkeyConfig.triggerKey);
  }, [hotkeyConfig, getTriggerKeyDisplayName]);

  const keyboardStatus: PermissionStatus = hotkeyConfig?.triggerKey ? "granted" : "notDetermined";

  const missingCount = countMissing(snapshot);
  const allGranted = missingCount === 0;

  // Auto-dismiss once all permissions are granted (fires once).
  useEffect(() => {
    if (!visible) return;
    if (allGranted && !completedRef.current) {
      completedRef.current = true;
      // Reinitialize hotkey in case accessibility was just granted
      if (IS_MAC) {
        invoke("reinitialize_hotkey_listener").catch((err) => {
          captureError(err, { source: "permissions-onboarding", step: "reinitialize" });
        });
      }
      onComplete();
    }
  }, [visible, allGranted, onComplete]);

  const handleRequestAll = useCallback(async () => {
    if (!IS_MAC) {
      onComplete();
      return;
    }
    setIsWorking(true);
    try {
      // Request mic first (shows the system dialog in-place if notDetermined)
      if (snapshot.microphone !== "granted") {
        if (snapshot.microphone === "denied" || snapshot.microphone === "restricted") {
          await openMicrophoneSettings();
        } else {
          await requestMicrophone();
        }
      }
      // Then accessibility (always requires a trip to System Settings)
      if (snapshot.accessibility !== "granted") {
        await openAccessibilitySettings();
      }
      await refresh();
    } catch (error) {
      logError("permissions-onboarding", "Request permissions failed", error);
      captureError(error, { source: "permissions-onboarding", step: "request-all" });
    } finally {
      setIsWorking(false);
    }
  }, [snapshot, refresh, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="permissions-onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm pt-9"
    >
      <div className="mx-4 flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <h2
            id="permissions-onboarding-title"
            className="text-2xl font-bold text-foreground"
          >
            {t("settings.permissions.title")}
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("settings.permissions.subtitle")}
          </p>
        </div>

        <div className="divide-y divide-border rounded-xl border border-border bg-background">
          <PermissionRow
            icon={Keyboard}
            iconTint="bg-emerald-500/12"
            title={t("settings.permissions.keyboard.title")}
            description={t("settings.permissions.keyboard.description")}
            status={keyboardStatus}
            trailingText={hotkeyLabel || undefined}
          />
          <PermissionRow
            icon={Mic}
            iconTint="bg-sky-500/12"
            title={t("settings.permissions.microphone.title")}
            description={t("settings.permissions.microphone.description")}
            status={snapshot.microphone}
            onRefresh={() => void refresh()}
          />
          <PermissionRow
            icon={Accessibility}
            iconTint="bg-violet-500/12"
            title={t("settings.permissions.accessibility.title")}
            description={t("settings.permissions.accessibility.description")}
            status={snapshot.accessibility}
            onRefresh={() => void refresh()}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            className="h-12 w-full rounded-xl text-sm font-semibold"
            disabled={isWorking || allGranted}
            onClick={() => void handleRequestAll()}
          >
            {allGranted
              ? t("settings.permissions.allGranted")
              : t("settings.permissions.requestAll")}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-10 w-full text-xs text-muted-foreground"
            onClick={handleSkip}
          >
            {t("settings.permissions.skipForNow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
