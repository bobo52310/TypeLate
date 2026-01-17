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

// Rust → Frontend events
export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;
export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;
export const CORRECTION_MONITOR_RESULT = "correction-monitor:result" as const;
export const AUDIO_WAVEFORM = "audio:waveform" as const;
export const ESCAPE_PRESSED = "escape:pressed" as const;

// Frontend-only events (cross-window)
export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const SETTINGS_UPDATED = "settings:updated" as const;
export const VOCABULARY_CHANGED = "vocabulary:changed" as const;
export const VOCABULARY_LEARNED = "vocabulary:learned" as const;
