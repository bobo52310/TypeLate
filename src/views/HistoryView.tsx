import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  ChevronDown,
  Copy,
  Check,
  Trash2,
  Play,
  Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHistoryStore } from "@/stores/historyStore";
import type { TranscriptionRecord } from "@/types/transcription";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDuration,
  formatDurationMs,
} from "@/lib/formatUtils";

const TRANSCRIPTION_COMPLETED = "transcription:completed";
const SEARCH_DEBOUNCE_MS = 300;

export default function HistoryView() {
  const { t } = useTranslation();

  const transcriptionList = useHistoryStore((s) => s.transcriptionList);
  const hasMore = useHistoryStore((s) => s.hasMore);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const resetAndFetch = useHistoryStore((s) => s.resetAndFetch);
  const loadMore = useHistoryStore((s) => s.loadMore);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const deleteTranscription = useHistoryStore((s) => s.deleteTranscription);

  const [searchInput, setSearchInput] = useState("");
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(
    null,
  );
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [copiedRawRecordId, setCopiedRawRecordId] = useState<string | null>(
    null,
  );
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedRawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  function toggleExpand(recordId: string) {
    setExpandedRecordId((prev) => (prev === recordId ? null : recordId));
  }

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        setSearchQuery(value);
        void resetAndFetch();
      }, SEARCH_DEBOUNCE_MS);
    },
    [setSearchQuery, resetAndFetch],
  );

  function cleanupAudio() {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
  }

  async function handleCopyText(record: TranscriptionRecord) {
    const textToCopy = getDisplayText(record);
    try {
      await invoke("copy_to_clipboard", { text: textToCopy });
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopiedRecordId(record.id);
      copiedTimerRef.current = setTimeout(() => {
        setCopiedRecordId(null);
      }, 2500);
    } catch {
      // clipboard write may fail in some contexts
    }
  }

  async function handleCopyRawText(record: TranscriptionRecord) {
    try {
      await invoke("copy_to_clipboard", { text: record.rawText });
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
      setCopiedRawRecordId(record.id);
      copiedRawTimerRef.current = setTimeout(() => {
        setCopiedRawRecordId(null);
      }, 2500);
    } catch {
      // clipboard write may fail
    }
  }

  async function handleDeleteRecord(record: TranscriptionRecord) {
    try {
      await deleteTranscription(record.id);
      if (expandedRecordId === record.id) {
        setExpandedRecordId(null);
      }
    } catch {
      // DB delete failure handled at store layer
    }
  }

  async function handlePlayRecording(record: TranscriptionRecord) {
    cleanupAudio();

    if (playingRecordId === record.id) {
      setPlayingRecordId(null);
      return;
    }

    if (!record.audioFilePath) return;

    setPlayingRecordId(record.id);

    try {
      const raw = await invoke<number[]>("read_recording_file", {
        id: record.id,
      });

      const blob = new Blob([new Uint8Array(raw)], { type: "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      currentAudioRef.current = audio;

      audio.addEventListener("ended", () => {
        cleanupAudio();
        setPlayingRecordId(null);
      });

      audio.addEventListener("error", () => {
        cleanupAudio();
        setPlayingRecordId(null);
      });

      await audio.play();
    } catch {
      cleanupAudio();
      setPlayingRecordId(null);
    }
  }

  // Mount: fetch data & listen for transcription events
  useEffect(() => {
    void resetAndFetch();

    let unlisten: (() => void) | undefined;
    listen(TRANSCRIPTION_COMPLETED, () => {
      void resetAndFetch();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      cleanupAudio();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
    };
  }, [resetAndFetch]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          void loadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  return (
    <div className="p-6">
      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t("history.searchPlaceholder")}
          className="w-full pl-9"
          value={searchInput}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
      </div>

      {/* History card */}
      <Card>
        <CardContent className="p-0">
          {/* Initial loading */}
          {isLoading && transcriptionList.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              {t("history.loading")}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && transcriptionList.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              {searchInput.trim()
                ? t("history.noResults", { query: searchInput.trim() })
                : t("history.emptyState")}
            </div>
          )}

          {/* Record list */}
          {transcriptionList.length > 0 &&
            transcriptionList.map((record, index) => (
              <div key={record.id}>
                {/* Summary row */}
                <div
                  className={cn(
                    "cursor-pointer px-5 py-4 transition hover:bg-accent/50",
                    (index < transcriptionList.length - 1 ||
                      expandedRecordId === record.id) &&
                      "border-b border-border",
                  )}
                  onClick={() => toggleExpand(record.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(record.timestamp)}
                      </span>
                      {record.wasEnhanced && (
                        <Badge className="border-0 bg-emerald-500/20 text-[11px] text-emerald-400">
                          {t("dashboard.aiEnhanced")}
                        </Badge>
                      )}
                      {record.status === "failed" && (
                        <Badge variant="destructive" className="text-[11px]">
                          {t("history.failedBadge")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(record.recordingDurationMs)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={!record.audioFilePath}
                        title={
                          record.audioFilePath
                            ? t("history.playRecording")
                            : t("history.noRecordingFile")
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePlayRecording(record);
                        }}
                      >
                        {playingRecordId === record.id ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCopyText(record);
                        }}
                      >
                        {copiedRecordId === record.id ? (
                          <Check className="h-3.5 w-3.5 text-green-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 text-muted-foreground transition-transform",
                          expandedRecordId === record.id && "rotate-180",
                        )}
                      />
                    </div>
                  </div>
                  <p className="mt-1.5 truncate text-sm text-muted-foreground">
                    {truncateText(getDisplayText(record))}
                  </p>
                </div>

                {/* Expanded detail */}
                {expandedRecordId === record.id && (
                  <div
                    className={cn(
                      "space-y-3 bg-card px-5 py-4",
                      index < transcriptionList.length - 1 &&
                        "border-b border-border",
                    )}
                  >
                    {/* Enhanced text */}
                    {record.wasEnhanced && record.processedText && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-emerald-400">
                          {t("history.enhancedText")}
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {record.processedText}
                        </p>
                      </div>
                    )}

                    {/* Raw text */}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("history.rawText")}
                        </p>
                        <button
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyRawText(record);
                          }}
                        >
                          {copiedRawRecordId === record.id ? (
                            <Check className="h-3 w-3 text-green-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>
                            {copiedRawRecordId === record.id
                              ? t("history.copied")
                              : t("history.copy")}
                          </span>
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {record.rawText}
                      </p>
                    </div>

                    {/* Detail info */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>
                        {t("history.recordingLabel")}
                        {formatDurationMs(record.recordingDurationMs)}
                      </span>
                      <span>
                        {t("history.transcriptionLabel")}
                        {formatDurationMs(record.transcriptionDurationMs)}
                      </span>
                      {record.enhancementDurationMs !== null && (
                        <span>
                          {t("history.aiLabel")}
                          {formatDurationMs(record.enhancementDurationMs)}
                        </span>
                      )}
                      <span>
                        {t("history.charCountLabel")}
                        {record.charCount}
                      </span>
                      <span>
                        {t("history.modeLabel")}
                        {record.triggerMode === "hold"
                          ? t("history.holdMode")
                          : t("history.toggleMode")}
                      </span>
                    </div>

                    {/* Action buttons */}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCopyText(record);
                        }}
                      >
                        {copiedRecordId === record.id ? (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {copiedRecordId === record.id
                          ? t("history.copied")
                          : t("history.copy")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteRecord(record);
                        }}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("history.delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

          {/* Loading more indicator */}
          {isLoading && transcriptionList.length > 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("history.loadingMore")}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
        </CardContent>
      </Card>
    </div>
  );
}
