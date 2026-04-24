/**
 * Floating stack of transcription cards rendered below the NotchHud when the
 * user chains recordings (CleanShot X–style). Each card represents an
 * in-flight transcription that was demoted from the notch when a newer
 * recording took over.
 *
 * Stage 1 MVP: minimal styling, no retry/copy actions, no window resize.
 */

import { useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useVoiceFlowStore } from "@/stores/voiceFlowStore";
import type { QueuedRecording } from "@/types/transcription";

function statusLabel(status: QueuedRecording["status"]): string {
  switch (status) {
    case "transcribing":
      return "Transcribing…";
    case "enhancing":
      return "Enhancing…";
    case "success":
      return "Pasted";
    case "error":
      return "Error";
  }
}

function statusIcon(status: QueuedRecording["status"]) {
  if (status === "transcribing" || status === "enhancing") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-sky-300" aria-hidden />;
  }
  if (status === "success") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-hidden />;
  }
  return <AlertCircle className="size-4 shrink-0 text-red-400" aria-hidden />;
}

function previewText(item: QueuedRecording): string {
  const raw = item.processedText ?? item.rawText ?? item.errorMessage ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.length > 42 ? trimmed.slice(0, 42) + "…" : trimmed;
}

export function TranscriptionQueueList() {
  const queue = useVoiceFlowStore((s) => s.queue);
  const dismissQueueItem = useVoiceFlowStore((s) => s.dismissQueueItem);

  useEffect(() => {
    if (queue.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "[queue]",
        queue.map((item) => `${item.id.slice(0, 8)}=${item.status}`).join(", "),
      );
    }
  }, [queue]);

  if (queue.length === 0) return null;

  // Newest at top of stack (just below the notch).
  const items = [...queue].reverse();

  return (
    <div
      className="pointer-events-auto fixed left-1/2 top-[54px] flex w-[360px] -translate-x-1/2 flex-col gap-2"
      role="list"
      aria-label="Transcription queue"
    >
      {items.map((item) => {
        const preview = previewText(item);
        return (
          <div
            key={item.id}
            role="listitem"
            className="flex items-center gap-3 rounded-2xl border border-white/15 bg-[rgba(20,20,25,0.92)] px-4 py-3 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          >
            {statusIcon(item.status)}
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-wide text-white/60">
                {statusLabel(item.status)}
              </span>
              <span className="truncate" title={preview}>
                {preview || "\u00a0"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => dismissQueueItem(item.id)}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
