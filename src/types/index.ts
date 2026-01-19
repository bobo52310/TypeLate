export type HudStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "enhancing"
  | "success"
  | "error"
  | "cancelled";

export interface HudState {
  status: HudStatus;
  message: string;
}

export type TriggerMode = "hold" | "toggle" | "doubleTap";

export interface HudTargetPosition {
  x: number;
  y: number;
  monitorKey: string;
}
