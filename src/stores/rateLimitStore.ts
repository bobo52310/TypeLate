import { create } from "zustand";
import type { RateLimitInfo } from "@/types/transcription";
import { emitToWindow, RATE_LIMIT_UPDATED } from "@/hooks/useTauriEvent";

export interface RateLimitPayload {
  whisper: RateLimitInfo | null;
  chat: RateLimitInfo | null;
}

interface RateLimitState {
  whisper: RateLimitInfo | null;
  chat: RateLimitInfo | null;
  updateWhisper: (info: RateLimitInfo) => void;
  updateChat: (info: RateLimitInfo) => void;
  /** Called from Dashboard when receiving cross-window event */
  applyRemoteUpdate: (payload: RateLimitPayload) => void;
}

export const useRateLimitStore = create<RateLimitState>()((set, get) => ({
  whisper: null,
  chat: null,

  updateWhisper: (info) => {
    set({ whisper: info });
    // Notify Dashboard window
    const { chat } = get();
    void emitToWindow("main-window", RATE_LIMIT_UPDATED, {
      whisper: info,
      chat,
    }).catch(() => {});
  },

  updateChat: (info) => {
    set({ chat: info });
    // Notify Dashboard window
    const { whisper } = get();
    void emitToWindow("main-window", RATE_LIMIT_UPDATED, {
      whisper,
      chat: info,
    }).catch(() => {});
  },

  applyRemoteUpdate: (payload) => {
    set({
      whisper: payload.whisper,
      chat: payload.chat,
    });
  },
}));
