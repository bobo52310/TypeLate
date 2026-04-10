import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "@/lib/platform";

export type PermissionStatus = "granted" | "denied" | "notDetermined" | "restricted" | "unknown";

export interface PermissionsSnapshot {
  accessibility: PermissionStatus;
  microphone: PermissionStatus;
}

const POLL_INTERVAL_MS = 2000;

async function readAccessibilityStatus(): Promise<PermissionStatus> {
  if (!IS_MAC) return "granted";
  try {
    const granted = await invoke<boolean>("check_accessibility_permission_command");
    return granted ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

async function readMicrophoneStatus(): Promise<PermissionStatus> {
  if (!IS_MAC) return "granted";
  try {
    const status = await invoke<string>("check_microphone_permission");
    return (status as PermissionStatus) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function readAllPermissions(): Promise<PermissionsSnapshot> {
  const [accessibility, microphone] = await Promise.all([
    readAccessibilityStatus(),
    readMicrophoneStatus(),
  ]);
  return { accessibility, microphone };
}

/**
 * Polls all OS-level permissions at a steady interval. Stops polling when
 * `enabled` becomes false. Safe to mount multiple times; each instance keeps
 * its own interval.
 */
export function usePermissions(enabled: boolean = true) {
  const [snapshot, setSnapshot] = useState<PermissionsSnapshot>({
    accessibility: "unknown",
    microphone: "unknown",
  });
  const [isReady, setIsReady] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    const next = await readAllPermissions();
    if (!cancelledRef.current) {
      setSnapshot(next);
      setIsReady(true);
    }
    return next;
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [enabled, refresh]);

  return { snapshot, isReady, refresh };
}

export async function requestMicrophone(): Promise<PermissionStatus> {
  if (!IS_MAC) return "granted";
  try {
    const status = await invoke<string>("request_microphone_permission");
    return (status as PermissionStatus) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function openMicrophoneSettings(): Promise<void> {
  if (!IS_MAC) return;
  try {
    await invoke("open_microphone_settings");
  } catch {
    // ignore — user can open System Settings manually
  }
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!IS_MAC) return;
  try {
    await invoke("open_accessibility_settings");
  } catch {
    // ignore
  }
}
