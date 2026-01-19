import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { IS_MAC } from "@/lib/platform";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

type PresetTriggerKey =
  | "fn"
  | "option"
  | "rightOption"
  | "control"
  | "rightControl"
  | "command"
  | "shift"
  | "rightAlt"
  | "leftAlt";

type TriggerMode = "hold" | "toggle" | "doubleTap";

const RECORDING_TIMEOUT_MS = 10_000;

export default function HotkeySection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);
  const triggerMode = useSettingsStore((s) => s.triggerMode());
  const customTriggerKey = useSettingsStore((s) => s.customTriggerKey);
  const customTriggerKeyDomCode = useSettingsStore((s) => s.customTriggerKeyDomCode);
  const saveHotkeyConfig = useSettingsStore((s) => s.saveHotkeyConfig);
  const saveCustomTriggerKey = useSettingsStore((s) => s.saveCustomTriggerKey);
  const switchToCustomMode = useSettingsStore((s) => s.switchToCustomMode);
  const switchToPresetMode = useSettingsStore((s) => s.switchToPresetMode);
  const getKeyDisplayName = useSettingsStore((s) => s.getKeyDisplayName);
  const getPlatformKeycode = useSettingsStore((s) => s.getPlatformKeycode);
  const isPresetEquivalentKey = useSettingsStore((s) => s.isPresetEquivalentKey);
  const getDangerousKeyWarning = useSettingsStore((s) => s.getDangerousKeyWarning);
  const getEscapeReservedMessage = useSettingsStore((s) => s.getEscapeReservedMessage);
  const getHotkeyUnsupportedKeyMessage = useSettingsStore((s) => s.getHotkeyUnsupportedKeyMessage);
  const getHotkeyPresetHint = useSettingsStore((s) => s.getHotkeyPresetHint);
  const getHotkeyRecordingTimeoutMessage = useSettingsStore(
    (s) => s.getHotkeyRecordingTimeoutMessage,
  );

  const isMac = IS_MAC;

  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingWarning, setRecordingWarning] = useState("");
  const [recordingHint, setRecordingHint] = useState("");
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const triggerKeyOptions = useMemo<{ value: PresetTriggerKey; label: string }[]>(
    () =>
      isMac
        ? [
            { value: "fn", label: t("settings.hotkey.keys.fn") },
            {
              value: "option",
              label: t("settings.hotkey.keys.leftOption"),
            },
            {
              value: "rightOption",
              label: t("settings.hotkey.keys.rightOption"),
            },
            {
              value: "control",
              label: t("settings.hotkey.keys.leftControl"),
            },
            {
              value: "rightControl",
              label: t("settings.hotkey.keys.rightControl"),
            },
            {
              value: "command",
              label: t("settings.hotkey.keys.command"),
            },
            { value: "shift", label: t("settings.hotkey.keys.shift") },
          ]
        : [
            {
              value: "rightAlt",
              label: t("settings.hotkey.keys.rightAlt"),
            },
            {
              value: "leftAlt",
              label: t("settings.hotkey.keys.leftAlt"),
            },
            {
              value: "control",
              label: t("settings.hotkey.keys.control"),
            },
            { value: "shift", label: t("settings.hotkey.keys.shift") },
          ],
    [isMac, t],
  );

  const currentPresetKey = useMemo(() => {
    const key = hotkeyConfig?.triggerKey;
    if (!key || typeof key === "object") return isMac ? "fn" : "rightAlt";
    return key as PresetTriggerKey;
  }, [hotkeyConfig, isMac]);

  const hasCustomKey = customTriggerKey !== null;

  const currentCustomKeyDisplay = useMemo(() => {
    if (!customTriggerKeyDomCode) return "";
    return getKeyDisplayName(customTriggerKeyDomCode);
  }, [customTriggerKeyDomCode, getKeyDisplayName]);

  const stopKeyRecording = useCallback(() => {
    setIsRecording(false);
    clearTimeout(recordingTimeoutRef.current);
  }, []);

  const handleKeydownForRecording = useCallback(
    async (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        feedback.show("error", getEscapeReservedMessage());
        stopKeyRecording();
        return;
      }

      const domCode = event.code;
      const keycode = getPlatformKeycode(domCode);

      if (keycode === null) {
        feedback.show("error", getHotkeyUnsupportedKeyMessage());
        stopKeyRecording();
        return;
      }

      setRecordingWarning("");
      setRecordingHint("");

      const isPresetEquiv = isPresetEquivalentKey(domCode);

      if (!isPresetEquiv) {
        const dangerWarning = getDangerousKeyWarning(domCode);
        if (dangerWarning) {
          setRecordingWarning(dangerWarning);
        }
      }

      if (isPresetEquiv) {
        setRecordingHint(getHotkeyPresetHint());
      }

      const currentMode = triggerMode;
      stopKeyRecording();

      try {
        await saveCustomTriggerKey(keycode, domCode, currentMode);
        feedback.show(
          "success",
          t("settings.hotkey.keySet", {
            key: getKeyDisplayName(domCode),
          }),
        );
      } catch (err) {
        feedback.show("error", err instanceof Error ? err.message : String(err));
      }
    },
    [
      feedback,
      getEscapeReservedMessage,
      getPlatformKeycode,
      getHotkeyUnsupportedKeyMessage,
      isPresetEquivalentKey,
      getDangerousKeyWarning,
      getHotkeyPresetHint,
      triggerMode,
      stopKeyRecording,
      saveCustomTriggerKey,
      getKeyDisplayName,
      t,
    ],
  );

  function startRecording() {
    setIsRecording(true);
    setRecordingWarning("");
    setRecordingHint("");

    document.addEventListener("keydown", handleKeydownForRecording as unknown as EventListener, {
      capture: true,
      once: true,
    });

    recordingTimeoutRef.current = setTimeout(() => {
      feedback.show("error", getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }, RECORDING_TIMEOUT_MS);
  }

  function switchToCustom() {
    setIsCustomMode(true);
    if (hasCustomKey) {
      switchToCustomMode(triggerMode).catch((err: unknown) => {
        feedback.show("error", err instanceof Error ? err.message : String(err));
      });
    }
  }

  function switchToPreset() {
    setIsCustomMode(false);
    stopKeyRecording();
    setRecordingWarning("");
    setRecordingHint("");
    switchToPresetMode(currentPresetKey, triggerMode).catch((err: unknown) => {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    });
  }

  async function handleTriggerKeyChange(newKey: string) {
    try {
      await saveHotkeyConfig(newKey as PresetTriggerKey, triggerMode);
      feedback.show("success", t("settings.hotkey.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTriggerModeChange(newMode: TriggerMode) {
    const currentKey = hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
    try {
      await saveHotkeyConfig(currentKey, newMode);
      feedback.show("success", t("settings.hotkey.modeUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  // Detect if current key is custom on mount
  useEffect(() => {
    const currentKey = hotkeyConfig?.triggerKey;
    if (currentKey && typeof currentKey === "object") {
      setIsCustomMode(true);
    }
  }, [hotkeyConfig]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(recordingTimeoutRef.current);
    };
  }, []);

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">{t("settings.hotkey.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preset / Custom mode toggle */}
        <div className="flex items-center justify-between">
          <Label>{t("settings.hotkey.triggerKeyMode")}</Label>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                !isCustomMode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={switchToPreset}
            >
              {t("settings.hotkey.preset")}
            </button>
            <button
              type="button"
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                isCustomMode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={switchToCustom}
            >
              {t("settings.hotkey.custom")}
            </button>
          </div>
        </div>

        {/* Preset mode: Select dropdown */}
        {!isCustomMode && (
          <div className="flex items-center justify-between">
            <Label htmlFor="trigger-key">{t("settings.hotkey.triggerKey")}</Label>
            <Select
              value={currentPresetKey}
              onValueChange={(val) => void handleTriggerKeyChange(val)}
            >
              <SelectTrigger id="trigger-key" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggerKeyOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Custom mode: Key recording */}
        {isCustomMode && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t("settings.hotkey.customTriggerKey")}</Label>
              <div className="flex items-center gap-3">
                {hasCustomKey ? (
                  <span className="text-sm font-medium text-foreground">
                    {currentCustomKeyDisplay}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("settings.hotkey.notSet")}
                  </span>
                )}
                <Button
                  variant={isRecording ? "destructive" : "outline"}
                  size="sm"
                  className={cn(isRecording && "animate-pulse")}
                  onClick={() => (isRecording ? stopKeyRecording() : startRecording())}
                >
                  {isRecording ? t("settings.hotkey.pressKey") : t("settings.hotkey.record")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.hotkey.systemKeyHint")}</p>

            {recordingWarning && <p className="text-sm text-destructive">{recordingWarning}</p>}

            {recordingHint && <p className="text-sm text-muted-foreground">{recordingHint}</p>}
          </div>
        )}

        {/* Trigger mode */}
        <div className="flex items-center justify-between">
          <Label htmlFor="trigger-mode">{t("settings.hotkey.triggerMode")}</Label>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                triggerMode === "hold"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={() => void handleTriggerModeChange("hold")}
            >
              Hold
            </button>
            <button
              type="button"
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                triggerMode === "toggle"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={() => void handleTriggerModeChange("toggle")}
            >
              Toggle
            </button>
            <button
              type="button"
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                triggerMode === "doubleTap"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
              onClick={() => void handleTriggerModeChange("doubleTap")}
            >
              {t("settings.hotkey.doubleTap")}
            </button>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {triggerMode === "hold"
            ? t("settings.hotkey.holdDescription")
            : triggerMode === "toggle"
              ? t("settings.hotkey.toggleDescription")
              : t("settings.hotkey.doubleTapDescription")}
        </p>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success" ? "text-primary" : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
