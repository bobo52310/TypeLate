import { useEffect, useRef } from "react";
import { listen, emit, emitTo, type UnlistenFn } from "@tauri-apps/api/event";

// Re-export Tauri event utilities
export { emit as emitEvent, emitTo as emitToWindow };

/**
 * React hook for listening to Tauri events with proper cleanup.
 * Uses a ref for the handler to avoid re-subscribing on every render.
 */
export function useTauriEvent<T>(eventName: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<T>(eventName, (event) => {
      if (!cancelled) handlerRef.current(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName]);
}

/**
 * Debounced variant of useTauriEvent — coalesces rapid-fire events
 * into a single handler call after the debounce window.
 * Useful for cross-window sync events (settings, vocabulary).
 */
export function useDebouncedTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
  delayMs = 150,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    listen<T>(eventName, (event) => {
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) handlerRef.current(event.payload);
      }, delayMs);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [eventName, delayMs]);
}

// Rust → Frontend events
export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;
export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;
export const CORRECTION_MONITOR_RESULT = "correction-monitor:result" as const;
export const AUDIO_WAVEFORM = "audio:waveform" as const;
export const ESCAPE_PRESSED = "escape:pressed" as const;

// macOS App Menu events (Rust → Frontend)
export const MENU_NAVIGATE = "menu:navigate" as const;
export const MENU_CHECK_UPDATE = "menu:check-update" as const;

// Frontend-only events (cross-window)
export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const SETTINGS_UPDATED = "settings:updated" as const;
export const VOCABULARY_CHANGED = "vocabulary:changed" as const;
export const VOCABULARY_LEARNED = "vocabulary:learned" as const;
export const CORRECTION_PROMPT = "correction:prompt" as const;
export const RATE_LIMIT_UPDATED = "rate-limit:updated" as const;
export const TRAY_CYCLE_PROMPT_MODE = "tray:cycle-prompt-mode" as const;
