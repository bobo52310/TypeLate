import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  status: "up-to-date" | "update-available" | "error";
  version?: string;
  error?: string;
}

let pendingUpdate: Update | null = null;

/**
 * 檢查 App 更新（僅檢查，不下載）。
 * 找到更新時暫存 Update 物件供後續操作。
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      console.log("[autoUpdater] No update available");
      pendingUpdate = null;
      return { status: "up-to-date" };
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);
    pendingUpdate = update;
    return { status: "update-available", version: update.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autoUpdater] Update check failed:", message);
    return { status: "error", error: message };
  }
}

/**
 * 靜默下載暫存的更新（不安裝、不重啟）。
 * 用於自動更新流程：背景下載完成後再通知使用者。
 */
export async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  await pendingUpdate.download();
  console.log("[autoUpdater] Download complete");
}

/**
 * 安裝已下載的更新並重啟 App。
 * 必須在 downloadUpdate() 完成後呼叫。
 */
export async function installAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update.");
  }

  console.log("[autoUpdater] Installing update...");
  await pendingUpdate.install();
  await invoke("request_app_restart");
}

/**
 * 一鍵下載、安裝並重啟（手動更新流程用）。
 */
export async function downloadInstallAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  await pendingUpdate.download();
  console.log("[autoUpdater] Download complete, installing...");
  await pendingUpdate.install();
  await invoke("request_app_restart");
}
