/**
 * HUD window management -- show/hide, repositioning, monitor polling.
 *
 * Uses Tauri window API to control the HUD overlay window.
 * All functions operate on the current (HUD) window via getCurrentWindow().
 */

import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HudTargetPosition } from "@/types";
import { clearLearnedHideTimer } from "./timers";

// ── Module-level state ──

let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
let lastMonitorKey = "";
let isRepositioning = false;

const MONITOR_POLL_INTERVAL_MS = 250;

// ── Helpers ──

export function getAppWindow(): ReturnType<typeof getCurrentWindow> {
  if (!cachedAppWindow) cachedAppWindow = getCurrentWindow();
  return cachedAppWindow;
}

// ── Repositioning ──

export async function repositionHudToCurrentMonitor(): Promise<void> {
  if (isRepositioning) return;
  isRepositioning = true;
  try {
    const position = await invoke<HudTargetPosition>("get_hud_target_position");
    if (position.monitorKey !== lastMonitorKey) {
      lastMonitorKey = position.monitorKey;
      await getAppWindow().setPosition(new LogicalPosition(position.x, position.y));
    }
  } catch {
    // Monitor repositioning failure is low priority -- silent
  } finally {
    isRepositioning = false;
  }
}

// ── Polling ──

export function startMonitorPolling(): void {
  stopMonitorPolling();
  monitorPollTimer = setInterval(() => {
    void repositionHudToCurrentMonitor();
  }, MONITOR_POLL_INTERVAL_MS);
}

export function stopMonitorPolling(): void {
  if (monitorPollTimer) {
    clearInterval(monitorPollTimer);
    monitorPollTimer = null;
  }
  lastMonitorKey = "";
  isRepositioning = false;
}

// ── Show / Hide ──

export async function showHud(): Promise<void> {
  clearLearnedHideTimer();
  const window = getAppWindow();
  lastMonitorKey = "";
  await repositionHudToCurrentMonitor();
  await window.show();
  await window.setIgnoreCursorEvents(true);
  startMonitorPolling();
}

export async function hideHud(): Promise<void> {
  await getAppWindow().hide();
}

// ── Cursor events ──

export async function enableCursorEvents(): Promise<void> {
  await getAppWindow().setIgnoreCursorEvents(false);
}

// ── Cleanup (for testing / reset) ──

export function resetHudWindowState(): void {
  stopMonitorPolling();
  cachedAppWindow = null;
  lastMonitorKey = "";
  isRepositioning = false;
}
