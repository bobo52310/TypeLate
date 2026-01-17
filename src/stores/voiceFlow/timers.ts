/**
 * Timer management for the VoiceFlow state machine.
 *
 * All timer refs are module-level variables (closures), NOT stored in Zustand state.
 * This avoids unnecessary React re-renders for timer bookkeeping.
 *
 * The store reference is injected via setStoreRef() during initialization
 * to break the circular dependency between timers.ts and voiceFlowStore.ts.
 */

// ── Store ref injection (breaks circular dependency) ──

interface StoreApi {
  getState: () => { recordingElapsedSeconds: number };
  setState: (partial: { recordingElapsedSeconds: number }) => void;
}

let storeRef: StoreApi | null = null;

export function setStoreRef(store: StoreApi): void {
  storeRef = store;
}

// ── Module-level timer refs ──

let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
let delayedMuteTimer: ReturnType<typeof setTimeout> | null = null;
let learnedHideTimer: ReturnType<typeof setTimeout> | null = null;

// ── Constants ──

export const COLLAPSE_HIDE_DELAY_MS = 400;
export const LEARNED_NOTIFICATION_TOTAL_DURATION_MS = 2800; // 2000 display + 400 collapse + 400 buffer

// ── Auto-hide timer ──

export function clearAutoHideTimer(): void {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

export function setAutoHideTimer(callback: () => void, delayMs: number): void {
  clearAutoHideTimer();
  autoHideTimer = setTimeout(callback, delayMs);
}

// ── Collapse-hide timer ──

export function clearCollapseHideTimer(): void {
  if (collapseHideTimer) {
    clearTimeout(collapseHideTimer);
    collapseHideTimer = null;
  }
}

export function setCollapseHideTimer(callback: () => void): void {
  clearCollapseHideTimer();
  collapseHideTimer = setTimeout(callback, COLLAPSE_HIDE_DELAY_MS);
}

// ── Elapsed recording timer ──

export function startElapsedTimer(): void {
  if (!storeRef) return;
  storeRef.setState({ recordingElapsedSeconds: 0 });
  elapsedTimer = setInterval(() => {
    if (!storeRef) return;
    const current = storeRef.getState().recordingElapsedSeconds;
    storeRef.setState({ recordingElapsedSeconds: current + 1 });
  }, 1000);
}

export function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (storeRef) {
    storeRef.setState({ recordingElapsedSeconds: 0 });
  }
}

// ── Delayed mute timer ──

export function clearDelayedMuteTimer(): void {
  if (delayedMuteTimer) {
    clearTimeout(delayedMuteTimer);
    delayedMuteTimer = null;
  }
}

export function setDelayedMuteTimer(callback: () => void, delayMs: number): void {
  clearDelayedMuteTimer();
  delayedMuteTimer = setTimeout(callback, delayMs);
}

// ── Learned notification hide timer ──

export function clearLearnedHideTimer(): void {
  if (learnedHideTimer) {
    clearTimeout(learnedHideTimer);
    learnedHideTimer = null;
  }
}

export function setLearnedHideTimer(callback: () => void): void {
  clearLearnedHideTimer();
  learnedHideTimer = setTimeout(callback, LEARNED_NOTIFICATION_TOTAL_DURATION_MS);
}

// ── Cleanup all timers ──

export function cleanupAllTimers(): void {
  clearAutoHideTimer();
  clearCollapseHideTimer();
  clearDelayedMuteTimer();
  clearLearnedHideTimer();
  stopElapsedTimer();
}
