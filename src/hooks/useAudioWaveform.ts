import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AUDIO_WAVEFORM } from "./useTauriEvent";
import type { WaveformPayload } from "@/types/audio";

const WAVEFORM_BAR_COUNT = 6;
const LERP_SPEED = 0.25;

function lerp(current: number, target: number, speed: number): number {
  return current + (target - current) * speed;
}

export function useAudioWaveform() {
  const [waveformLevelList, setWaveformLevelList] = useState<number[]>(
    () => new Array(WAVEFORM_BAR_COUNT).fill(0) as number[],
  );

  const targetLevelListRef = useRef<number[]>(new Array(WAVEFORM_BAR_COUNT).fill(0) as number[]);
  const currentLevelListRef = useRef<number[]>(new Array(WAVEFORM_BAR_COUNT).fill(0) as number[]);
  const isActiveRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const animate = useCallback(() => {
    if (!isActiveRef.current) return;

    const current = currentLevelListRef.current;
    const target = targetLevelListRef.current;
    const next = current.map((v, i) => lerp(v, target[i] ?? 0, LERP_SPEED));
    currentLevelListRef.current = next;
    setWaveformLevelList(next);

    rafIdRef.current = requestAnimationFrame(animate);
  }, []);

  const startWaveformAnimation = useCallback(async () => {
    isActiveRef.current = true;

    if (!unlistenRef.current) {
      unlistenRef.current = await listen<WaveformPayload>(AUDIO_WAVEFORM, (event) => {
        if (!isActiveRef.current) return;
        targetLevelListRef.current = [...event.payload.levels];
      });
    }

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(animate);
    }
  }, [animate]);

  const stopWaveformAnimation = useCallback(() => {
    isActiveRef.current = false;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    const zeros = new Array(WAVEFORM_BAR_COUNT).fill(0) as number[];
    targetLevelListRef.current = zeros;
    currentLevelListRef.current = zeros;
    setWaveformLevelList(zeros);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWaveformAnimation();
    };
  }, [stopWaveformAnimation]);

  return {
    waveformLevelList,
    startWaveformAnimation,
    stopWaveformAnimation,
  };
}
