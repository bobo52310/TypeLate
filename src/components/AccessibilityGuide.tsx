import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/sentry";
import { ShieldCheck, ExternalLink } from "lucide-react";

const PERMISSION_CHECK_INTERVAL_MS = 2000;

interface AccessibilityGuideProps {
  visible: boolean;
  onClose: () => void;
}

const STEP_KEYS = ["accessibility.step1", "accessibility.step2", "accessibility.step3"] as const;

export function AccessibilityGuide({ visible, onClose }: AccessibilityGuideProps) {
  const { t } = useTranslation();
  const [isReinitializing, setIsReinitializing] = useState(false);
  const [reinitializeError, setReinitializeError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPermissionPolling = useCallback(() => {
    if (pollingTimerRef.current !== null) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const handlePermissionGranted = useCallback(async () => {
    setIsReinitializing(true);
    setReinitializeError(null);
    try {
      await invoke("reinitialize_hotkey_listener");
      onClose();
    } catch (error) {
      captureError(error, { source: "accessibility", step: "reinitialize" });
      setReinitializeError(t("accessibility.reinitializeError"));
    } finally {
      setIsReinitializing(false);
    }
  }, [onClose, t]);

  const startPermissionPolling = useCallback(() => {
    stopPermissionPolling();
    pollingTimerRef.current = setInterval(async () => {
      try {
        const hasPermission = await invoke<boolean>("check_accessibility_permission_command");
        if (hasPermission) {
          stopPermissionPolling();
          await handlePermissionGranted();
        }
      } catch (error) {
        captureError(error, { source: "accessibility", step: "check-permission" });
      }
    }, PERMISSION_CHECK_INTERVAL_MS);
  }, [stopPermissionPolling, handlePermissionGranted]);

  useEffect(() => {
    if (visible) {
      setReinitializeError(null);
      primaryButtonRef.current?.focus();
      startPermissionPolling();
    } else {
      stopPermissionPolling();
    }
    return () => stopPermissionPolling();
  }, [visible, startPermissionPolling, stopPermissionPolling]);

  const handleKeydown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusableList = dialogRef.current.querySelectorAll<HTMLElement>("button");
        if (focusableList.length === 0) return;
        const firstElement = focusableList[0]!;
        const lastElement = focusableList[focusableList.length - 1]!;
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    },
    [onClose],
  );

  const handleOpenAccessibilitySettings = useCallback(async () => {
    try {
      await invoke("open_accessibility_settings");
    } catch (error) {
      captureError(error, { source: "accessibility", step: "open-settings" });
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="accessibility-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeydown}
    >
      <div className="mx-4 flex w-[420px] flex-col gap-5 rounded-2xl bg-card p-6 shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/12">
          <ShieldCheck className="h-6 w-6 text-warning" />
        </div>

        <h2 id="accessibility-guide-title" className="text-xl font-bold text-foreground">
          {t("accessibility.title")}
        </h2>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("accessibility.description")}
        </p>

        <div className="flex flex-col gap-3 pl-1">
          {STEP_KEYS.map((stepKey, index) => (
            <div key={stepKey} className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {index + 1}
              </div>
              <span className="text-sm leading-normal text-foreground">{t(stepKey)}</span>
            </div>
          ))}
        </div>

        {isReinitializing && (
          <p className="text-sm text-primary">{t("accessibility.reinitializing")}</p>
        )}
        {reinitializeError && <p className="text-sm text-destructive">{reinitializeError}</p>}

        <div className="flex flex-col gap-2">
          <Button
            ref={primaryButtonRef}
            className="h-11 w-full rounded-[10px]"
            disabled={isReinitializing}
            onClick={() => void handleOpenAccessibilitySettings()}
          >
            <ExternalLink className="h-4 w-4" />
            {t("accessibility.openSettings")}
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full rounded-[10px] text-muted-foreground"
            disabled={isReinitializing}
            onClick={onClose}
          >
            {t("accessibility.later")}
          </Button>
        </div>
      </div>
    </div>
  );
}
