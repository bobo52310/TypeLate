import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Badge } from "@/components/ui/badge";
import { getRandomSlogan } from "@/lib/slogans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  ChevronDown,
  Copy,
  Check,
  Trash2,
  Play,
  Square,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { captureError } from "@/lib/sentry";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { TranscriptionRecord } from "@/types/transcription";
import {
  truncateText,
  getDisplayText,
  formatDuration,
  formatDurationMs,
} from "@/lib/formatUtils";

const TRANSCRIPTION_COMPLETED = "transcription:completed";
const SEARCH_DEBOUNCE_MS = 300;

// ── Waveform animation component ──

function PlaybackWaveform() {
  return (
    <div className="flex items-center gap-[2px] h-3.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block w-[2px] rounded-full bg-primary"
          style={{
            animation: `waveform 1s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes waveform {
          0%, 100% { height: 3px; }
          50% { height: 14px; }
        }
      `}</style>
    </div>
  );
}

// ── Date grouping ──

function formatTimeOnly(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupByDate(
  records: TranscriptionRecord[],
  todayLabel: string,
  yesterdayLabel: string,
  locale: string,
): { label: string; records: TranscriptionRecord[] }[] {
  const groups = new Map<string, TranscriptionRecord[]>();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  for (const record of records) {
    const dateStr = new Date(record.timestamp).toISOString().slice(0, 10);
    let label: string;
    if (dateStr === todayStr) {
      label = todayLabel;
    } else if (dateStr === yesterdayStr) {
      label = yesterdayLabel;
    } else {
      label = new Date(record.timestamp).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
      });
    }

    const existing = groups.get(label);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(label, [record]);
    }
  }

  return Array.from(groups.entries()).map(([label, recs]) => ({
    label,
    records: recs,
  }));
}

// ── Main component ──

export default function HistoryView() {
  const { t, i18n } = useTranslation();

  const transcriptionList = useHistoryStore((s) => s.transcriptionList);
  const hasMore = useHistoryStore((s) => s.hasMore);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const resetAndFetch = useHistoryStore((s) => s.resetAndFetch);
  const loadMore = useHistoryStore((s) => s.loadMore);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const deleteTranscription = useHistoryStore((s) => s.deleteTranscription);
  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);

  const [searchInput, setSearchInput] = useState("");
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [copiedRawRecordId, setCopiedRawRecordId] = useState<string | null>(null);
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);

  // Random slogan for empty state (stable per mount)
  const [slogan] = useState(() => getRandomSlogan());

  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedRawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  const hotkeyDisplayName = useMemo(() => {
    if (!hotkeyConfig) return "Fn";
    const key = hotkeyConfig.triggerKey;
    if (typeof key === "string") {
      return t(`settings.hotkey.keys.${key}`, { defaultValue: key });
    }
    return t("settings.hotkey.customKeyDisplay", { keycode: key.custom.keycode });
  }, [hotkeyConfig, t]);

  const dateGroups = useMemo(
    () =>
      groupByDate(
        transcriptionList,
        t("home.dateGroup.today"),
        t("home.dateGroup.yesterday"),
        i18n.language,
      ),
    [transcriptionList, t, i18n.language],
  );

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
      copiedTimerRef.current = setTimeout(() => setCopiedRecordId(null), 2500);
    } catch (err) {
      captureError(err, { source: "history", action: "copy-text" });
    }
  }

  async function handleCopyRawText(record: TranscriptionRecord) {
    try {
      await invoke("copy_to_clipboard", { text: record.rawText });
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
      setCopiedRawRecordId(record.id);
      copiedRawTimerRef.current = setTimeout(() => setCopiedRawRecordId(null), 2500);
    } catch (err) {
      captureError(err, { source: "history", action: "copy-raw-text" });
    }
  }

  async function handleDeleteRecord(record: TranscriptionRecord) {
    try {
      await deleteTranscription(record.id);
      if (expandedRecordId === record.id) setExpandedRecordId(null);
    } catch (err) {
      captureError(err, { source: "history", action: "delete-record" });
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
      const raw = await invoke<number[]>("read_recording_file", { id: record.id });
      const blob = new Blob([new Uint8Array(raw)], { type: "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      currentAudioRef.current = audio;
      audio.addEventListener("ended", () => { cleanupAudio(); setPlayingRecordId(null); });
      audio.addEventListener("error", () => { cleanupAudio(); setPlayingRecordId(null); });
      await audio.play();
    } catch (err) {
      captureError(err, { source: "history", action: "play-recording" });
      cleanupAudio();
      setPlayingRecordId(null);
    }
  }

  useEffect(() => {
    void resetAndFetch();
    let unlisten: (() => void) | undefined;
    listen(TRANSCRIPTION_COMPLETED, () => {
      void resetAndFetch();
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      cleanupAudio();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
    };
  }, [resetAndFetch]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoading) void loadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  const isPlaying = (id: string) => playingRecordId === id;

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="shrink-0 px-5 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t("history.searchPlaceholder")}
            className="w-full pl-9 h-8 text-sm"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Loading */}
        {isLoading && transcriptionList.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {t("history.loading")}
          </div>
        )}

        {/* Empty */}
        {!isLoading && transcriptionList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50">
              <Mic className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <h3 className="mt-3 text-sm font-medium text-foreground">
              {searchInput.trim()
                ? t("history.noResults", { query: searchInput.trim() })
                : t("home.emptyState.title")}
            </h3>
            {!searchInput.trim() && (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("home.emptyState.description", { hotkey: hotkeyDisplayName })}
                </p>
                {slogan && (
                  <p className="mt-4 text-xs italic text-muted-foreground/60">
                    &ldquo;{slogan}&rdquo;
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Date groups */}
        {dateGroups.map((group) => (
          <div key={group.label} className="mt-3 first:mt-1">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h3>

            <div className="space-y-1">
              {group.records.map((record) => {
                const expanded = expandedRecordId === record.id;
                const playing = isPlaying(record.id);

                return (
                  <div
                    key={record.id}
                    className={cn(
                      "rounded-lg border transition-colors",
                      expanded
                        ? "border-border bg-card"
                        : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    {/* Row */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-3 py-2"
                      onClick={() => toggleExpand(record.id)}
                    >
                      {/* Play button / waveform */}
                      <button
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                          playing
                            ? "bg-primary/15"
                            : "bg-muted hover:bg-muted/80",
                          !record.audioFilePath && "opacity-30",
                        )}
                        disabled={!record.audioFilePath}
                        onClick={(e) => { e.stopPropagation(); void handlePlayRecording(record); }}
                      >
                        {playing ? (
                          <PlaybackWaveform />
                        ) : (
                          <Play className="h-3 w-3 text-foreground ml-0.5" />
                        )}
                      </button>

                      {/* Content */}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm text-foreground">
                            {truncateText(getDisplayText(record), 60)}
                          </span>
                          {record.wasEnhanced && (
                            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title={t("dashboard.aiEnhanced")} />
                          )}
                          {record.status === "failed" && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0 leading-tight">
                              {t("history.failedBadge")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{formatTimeOnly(record.timestamp)}</span>
                          <span>·</span>
                          <span>{formatDuration(record.recordingDurationMs)}</span>
                          {record.charCount > 0 && (
                            <>
                              <span>·</span>
                              <span>{record.charCount} {t("dashboard.characterUnit")}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-0.5">
                        {playing && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); void handlePlayRecording(record); }}
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); void handleCopyText(record); }}
                        >
                          {copiedRecordId === record.id ? (
                            <Check className="h-3 w-3 text-primary" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 text-muted-foreground transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </div>
                    </div>

                    {/* Expanded */}
                    {expanded && (
                      <div className="border-t border-border px-3 py-3 space-y-3">
                        {/* Enhanced text */}
                        {record.wasEnhanced && record.processedText && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-primary">
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
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {t("history.rawText")}
                            </p>
                            <button
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); void handleCopyRawText(record); }}
                            >
                              {copiedRawRecordId === record.id ? (
                                <Check className="h-2.5 w-2.5 text-primary" />
                              ) : (
                                <Copy className="h-2.5 w-2.5" />
                              )}
                              <span>
                                {copiedRawRecordId === record.id ? t("history.copied") : t("history.copy")}
                              </span>
                            </button>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {record.rawText}
                          </p>
                        </div>

                        {/* Metadata */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                          <span>{t("history.recordingLabel")} {formatDurationMs(record.recordingDurationMs)}</span>
                          <span>{t("history.transcriptionLabel")} {formatDurationMs(record.transcriptionDurationMs)}</span>
                          {record.enhancementDurationMs !== null && (
                            <span>{t("history.aiLabel")} {formatDurationMs(record.enhancementDurationMs)}</span>
                          )}
                          <span>
                            {t("history.modeLabel")}
                            {record.triggerMode === "hold" ? t("history.holdMode") : t("history.toggleMode")}
                          </span>
                          {record.whisperModelId && (
                            <span>{t("history.whisperModel", { model: record.whisperModelId })}</span>
                          )}
                          {record.llmModelId && (
                            <span>{t("history.llmModel", { model: record.llmModelId })}</span>
                          )}
                          <div className="ml-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); void handleDeleteRecord(record); }}
                            >
                              <Trash2 className="h-3 w-3" />
                              {t("history.delete")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Loading more */}
        {isLoading && transcriptionList.length > 0 && (
          <div className="py-3 text-center text-xs text-muted-foreground">
            {t("history.loadingMore")}
          </div>
        )}

        <div ref={sentinelRef} className="h-4" />
      </div>
    </div>
  );
}
