import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
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
const PRESSED_GLOW_MS = 900;

// Card-based mode picker — matches wireframe
interface ModeOption {
  value: TriggerMode;
  labelKey: string;
  descKey: string;
  taglineKey: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "toggle",
    labelKey: "settings.v1.hotkey.mode.toggleLabel",
    descKey: "settings.v1.hotkey.mode.toggleDesc",
    taglineKey: "settings.v1.hotkey.mode.toggleTagline",
  },
  {
    value: "hold",
    labelKey: "settings.v1.hotkey.mode.holdLabel",
    descKey: "settings.v1.hotkey.mode.holdDesc",
    taglineKey: "settings.v1.hotkey.mode.holdTagline",
  },
  {
    value: "doubleTap",
    labelKey: "settings.v1.hotkey.mode.doubleTapLabel",
    descKey: "settings.v1.hotkey.mode.doubleTapDesc",
    taglineKey: "settings.v1.hotkey.mode.doubleTapTagline",
  },
];

export default function HotkeySection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);
  const triggerMode = useSettingsStore((s) => s.triggerMode());
  const customTriggerKey = useSettingsStore((s) => s.customTriggerKey);
  const customTriggerKeyDomCode = useSettingsStore((s) => s.customTriggerKeyDomCode);
  const saveHotkeyConfig = useSettingsStore((s) => s.saveHotkeyConfig);
  const saveCustomTriggerKey = useSettingsStore((s) => s.saveCustomTriggerKey);
  const getKeyDisplayName = useSettingsStore((s) => s.getKeyDisplayName);
  const getPlatformKeycode = useSettingsStore((s) => s.getPlatformKeycode);
  const getEscapeReservedMessage = useSettingsStore((s) => s.getEscapeReservedMessage);
  const getHotkeyUnsupportedKeyMessage = useSettingsStore(
    (s) => s.getHotkeyUnsupportedKeyMessage,
  );
  const getHotkeyRecordingTimeoutMessage = useSettingsStore(
    (s) => s.getHotkeyRecordingTimeoutMessage,
  );

  const isMac = IS_MAC;

  // ── Preset key picker ──
  const presetKeys: { value: PresetTriggerKey; label: string }[] = useMemo(
    () =>
      isMac
        ? [
            { value: "fn", label: t("settings.hotkey.keys.fn") },
            { value: "option", label: "⌥ " + t("settings.hotkey.keys.leftOption") },
            { value: "control", label: "⌃ " + t("settings.hotkey.keys.leftControl") },
            { value: "command", label: "⌘ " + t("settings.hotkey.keys.command") },
            { value: "shift", label: "⇧ " + t("settings.hotkey.keys.shift") },
          ]
        : [
            { value: "rightAlt", label: t("settings.hotkey.keys.rightAlt") },
            { value: "leftAlt", label: t("settings.hotkey.keys.leftAlt") },
            { value: "control", label: t("settings.hotkey.keys.control") },
            { value: "shift", label: t("settings.hotkey.keys.shift") },
          ],
    [isMac, t],
  );

  const currentPresetKey = useMemo<PresetTriggerKey>(() => {
    const key = hotkeyConfig?.triggerKey;
    if (!key || typeof key === "object") return isMac ? "fn" : "rightAlt";
    return key as PresetTriggerKey;
  }, [hotkeyConfig, isMac]);

  const isCustomMode = typeof hotkeyConfig?.triggerKey === "object";
  const hasCustomKey = customTriggerKey !== null;
  const customKeyDisplay = useMemo(
    () =>
      customTriggerKeyDomCode ? getKeyDisplayName(customTriggerKeyDomCode) : "",
    [customTriggerKeyDomCode, getKeyDisplayName],
  );

  // ── Custom key recording ──
  const [isRecording, setIsRecording] = useState(false);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

      const currentMode = triggerMode;
      stopKeyRecording();

      try {
        await saveCustomTriggerKey(keycode, domCode, currentMode);
        feedback.show(
          "success",
          t("settings.hotkey.keySet", { key: getKeyDisplayName(domCode) }),
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
      triggerMode,
      stopKeyRecording,
      saveCustomTriggerKey,
      getKeyDisplayName,
      t,
    ],
  );

  function startRecording() {
    setIsRecording(true);
    document.addEventListener(
      "keydown",
      handleKeydownForRecording as unknown as EventListener,
      { capture: true, once: true },
    );
    recordingTimeoutRef.current = setTimeout(() => {
      feedback.show("error", getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }, RECORDING_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => clearTimeout(recordingTimeoutRef.current);
  }, []);

  // ── Handlers ──

  async function handleModeChange(newMode: TriggerMode) {
    const currentKey = hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
    try {
      await saveHotkeyConfig(currentKey, newMode);
      feedback.show("success", t("settings.hotkey.modeUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePresetKeyChange(newKey: PresetTriggerKey) {
    try {
      await saveHotkeyConfig(newKey, triggerMode);
      feedback.show("success", t("settings.hotkey.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  // ── Live preview: pulse the "偵測到" chip on global hotkey events ──
  const [livePulse, setLivePulse] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    listen("hotkey:pressed", () => {
      setLivePulse(true);
      clearTimeout(timer);
      timer = setTimeout(() => setLivePulse(false), PRESSED_GLOW_MS);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  // ── Render ──

  const activeKeyLabel = isCustomMode
    ? hasCustomKey
      ? customKeyDisplay
      : t("settings.hotkey.notSet")
    : presetKeys.find((k) => k.value === currentPresetKey)?.label ?? "";

  return (
    <div className="flex flex-col gap-3.5">
      {/* Mode picker card */}
      <div
        className="v1-rough-2"
        style={{ padding: 16, background: "#fff" }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          {t("settings.v1.hotkey.modeTitle")}
        </div>
        <div
          style={{ fontSize: 11, color: "var(--v1-ink-3)", marginBottom: 12 }}
        >
          {t("settings.v1.hotkey.modeDesc")}
        </div>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
        >
          {MODE_OPTIONS.map((m) => {
            const isActive = triggerMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                className="v1-rough flex flex-col gap-1 text-left"
                style={{
                  padding: 12,
                  background: isActive ? "var(--v1-ink)" : "var(--v1-paper-2)",
                  color: isActive ? "var(--v1-paper)" : "var(--v1-ink)",
                  cursor: "pointer",
                }}
                onClick={() => void handleModeChange(m.value)}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      border: `1.5px solid ${
                        isActive ? "var(--v1-accent)" : "var(--v1-ink-3)"
                      }`,
                      background: isActive ? "var(--v1-accent)" : "transparent",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {t(m.labelKey)}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.8 }}>
                  {t(m.descKey)}
                </div>
                <div
                  className="font-hand"
                  style={{
                    fontSize: 11,
                    color: isActive ? "var(--v1-accent)" : "var(--v1-ink-3)",
                    marginTop: 2,
                  }}
                >
                  {t(m.taglineKey)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Key picker */}
      <div className="v1-rough-2" style={{ padding: 16, background: "#fff" }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          {t("settings.v1.hotkey.keyTitle")}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {presetKeys.map((k) => {
            const isActive = !isCustomMode && k.value === currentPresetKey;
            return (
              <button
                key={k.value}
                type="button"
                className="v1-rough"
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: isActive ? "var(--v1-accent)" : "transparent",
                  fontFamily: isActive ? "'JetBrains Mono', monospace" : "inherit",
                  fontWeight: isActive ? 600 : 500,
                  cursor: "pointer",
                  color: "var(--v1-ink)",
                }}
                onClick={() => void handlePresetKeyChange(k.value)}
              >
                {k.label}
              </button>
            );
          })}
          <button
            type="button"
            className="v1-rough-dash"
            style={{
              padding: "6px 12px",
              fontSize: 12,
              color: isCustomMode ? "var(--v1-ink)" : "var(--v1-ink-3)",
              background: isCustomMode && hasCustomKey ? "var(--v1-accent)" : "transparent",
              cursor: "pointer",
              fontWeight: isCustomMode && hasCustomKey ? 600 : 400,
            }}
            onClick={() => (isRecording ? stopKeyRecording() : startRecording())}
          >
            {isRecording
              ? t("settings.v1.hotkey.pressAnyKey")
              : isCustomMode && hasCustomKey
                ? customKeyDisplay + " · " + t("settings.v1.hotkey.customEdit")
                : "+ " + t("settings.v1.hotkey.customAdd")}
          </button>
        </div>
        <div
          className="font-hand mt-2.5"
          style={{ fontSize: 12, color: "var(--v1-ink-3)" }}
        >
          {t("settings.v1.hotkey.currentPrefix")}{" "}
          <span style={{ fontFamily: "inherit" }}>
            {triggerMode === "hold"
              ? t("settings.v1.hotkey.currentHold")
              : triggerMode === "doubleTap"
                ? t("settings.v1.hotkey.currentDoubleTap")
                : t("settings.v1.hotkey.currentToggle")}
          </span>{" "}
          <span className="v1-kbd" style={{ marginLeft: 2 }}>
            {activeKeyLabel}
          </span>{" "}
          {t("settings.v1.hotkey.currentSuffix")}
        </div>
      </div>

      {/* Live preview */}
      <div
        className="v1-rough-2 flex items-center gap-3"
        style={{
          padding: 14,
          background: livePulse
            ? "rgba(245,179,1,0.22)"
            : "rgba(245,179,1,0.08)",
          transition: "background 220ms",
        }}
      >
        <div style={{ fontSize: 22 }} aria-hidden>
          🧪
        </div>
        <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}>
          <b>{t("settings.v1.hotkey.liveTestTitle")}</b>{" "}
          — {t("settings.v1.hotkey.liveTestPrefix")}{" "}
          <span className="v1-kbd">{activeKeyLabel}</span>
          {t("settings.v1.hotkey.liveTestSuffix")}
          <div
            className="font-hand mt-0.5"
            style={{ fontSize: 12, color: "var(--v1-ink-3)" }}
          >
            {t("settings.v1.hotkey.liveTestHint")}
          </div>
        </div>
        <span
          className="inline-flex items-center"
          style={{
            padding: "3px 9px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            border: "1.5px solid var(--v1-line)",
            background: livePulse ? "var(--v1-accent)" : "transparent",
            color: "var(--v1-ink)",
            transition: "background 220ms",
          }}
        >
          {livePulse
            ? t("settings.v1.hotkey.liveTestDetected")
            : t("settings.v1.hotkey.liveTestWaiting")}
        </span>
      </div>

      {/* Feedback message */}
      {feedback.message && (
        <div
          style={{
            fontSize: 12,
            color:
              feedback.type === "success"
                ? "var(--v1-accent-4)"
                : "var(--v1-accent-2)",
          }}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
