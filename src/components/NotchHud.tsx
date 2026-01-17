import type { HudStatus } from "@/types";

interface NotchHudProps {
  status: HudStatus;
  recordingElapsedSeconds: number;
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}

// Placeholder — will be replaced by full implementation
export function NotchHud(_props: NotchHudProps) {
  return <div>NotchHud placeholder</div>;
}
