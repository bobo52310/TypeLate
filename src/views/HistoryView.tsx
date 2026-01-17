import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
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

/** Group transcriptions by date: Today, Yesterday, or formatted date */
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
        year: "numeric",
        month: "long",
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

  return Array.from(groups.entries()).map(([label, records]) => ({
    label,
    records,
  }));
}

export default function HistoryView() {
  const { t, i18n } = useTranslation();

  // History store
  const transcriptionList = useHistoryStore((s) => s.transcriptionList);
  const hasMore = useHistoryStore((s) => s.hasMore);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const resetAndFetch = useHistoryStore((s) => s.resetAndFetch);
  const loadMore = useHistoryStore((s) => s.loadMore);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const deleteTranscription = useHistoryStore((s) => s.deleteTranscription);
  // Settings store for hotkey display
  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);

  const [searchInput, setSearchInput] = useState("");
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [copiedRawRecordId, setCopiedRawRecordId] = useState<string | null>(null);
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedRawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  // Hotkey display name
  const hotkeyDisplayName = useMemo(() => {
    if (!hotkeyConfig) return "Fn";
    const key = hotkeyConfig.triggerKey;
    if (typeof key === "string") {
      return t(`settings.hotkey.keys.${key}`, { defaultValue: key });
    }
    return t("settings.hotkey.customKeyDisplay", { keycode: key.custom.keycode });
  }, [hotkeyConfig, t]);

  // Date-grouped transcriptions
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
    } catch {
      // clipboard write may fail
    }
  }

  async function handleCopyRawText(record: TranscriptionRecord) {
    try {
      await invoke("copy_to_clipboard", { text: record.rawText });
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
      setCopiedRawRecordId(record.id);
      copiedRawTimerRef.current = setTimeout(() => setCopiedRawRecordId(null), 2500);
    } catch {
      // clipboard write may fail
    }
  }

  async function handleDeleteRecord(record: TranscriptionRecord) {
    try {
      await deleteTranscription(record.id);
      if (expandedRecordId === record.id) setExpandedRecordId(null);
    } catch {
      // handled at store layer
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
    }).then((fn) => { unlisten = fn; });

    return () => {
      unlisten?.();
      cleanupAudio();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
    };
  }, [resetAndFetch]);

  // Infinite scroll
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

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="shrink-0 px-5 pt-4 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t("history.searchPlaceholder")}
            className="w-full pl-9"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>
      </div>

      {/* Transcription list */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Initial loading */}
        {isLoading && transcriptionList.length === 0 && (
          <div className="py-16 text-center text-muted-foreground">
            {t("history.loading")}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && transcriptionList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <Mic className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <h3 className="mt-4 text-base font-medium text-foreground">
              {searchInput.trim()
                ? t("history.noResults", { query: searchInput.trim() })
                : t("home.emptyState.title")}
            </h3>
            {!searchInput.trim() && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("home.emptyState.description", { hotkey: hotkeyDisplayName })}
              </p>
            )}
          </div>
        )}

        {/* Date-grouped records */}
        {dateGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </h3>
            <div className="rounded-lg border border-border bg-card">
              {group.records.map((record, index) => (
                <div key={record.id}>
                  {/* Summary row */}
                  <div
                    className={cn(
                      "group cursor-pointer px-4 py-3 transition hover:bg-accent/50",
                      index < group.records.length - 1 && "border-b border-border",
                      expandedRecordId === record.id && "border-b border-border bg-accent/30",
                    )}
                    onClick={() => toggleExpand(record.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatTimestamp(record.timestamp)}
                        </span>
                        {record.wasEnhanced && (
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title={t("dashboard.aiEnhanced")} />
                        )}
                        {record.status === "failed" && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            {t("history.failedBadge")}
                          </Badge>
                        )}
                        <span className="truncate text-sm text-foreground">
                          {truncateText(getDisplayText(record), 80)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatDuration(record.recordingDurationMs)}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={!record.audioFilePath}
                            onClick={(e) => { e.stopPropagation(); void handlePlayRecording(record); }}
                          >
                            {playingRecordId === record.id ? (
                              <Pause className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); void handleCopyText(record); }}
                          >
                            {copiedRecordId === record.id ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive/70 hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); void handleDeleteRecord(record); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <ChevronDown
                          className={cn(
                            "ml-1 h-3.5 w-3.5 text-muted-foreground transition-transform",
                            expandedRecordId === record.id && "rotate-180",
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expandedRecordId === record.id && (
                    <div
                      className={cn(
                        "space-y-3 bg-muted/20 px-4 py-4",
                        index < group.records.length - 1 && "border-b border-border",
                      )}
                    >
                      {record.wasEnhanced && record.processedText && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-emerald-500">
                            {t("history.enhancedText")}
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {record.processedText}
                          </p>
                        </div>
                      )}
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t("history.rawText")}
                          </p>
                          <button
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); void handleCopyRawText(record); }}
                          >
                            {copiedRawRecordId === record.id ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
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
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                        <span>{t("history.recordingLabel")} {formatDurationMs(record.recordingDurationMs)}</span>
                        <span>{t("history.transcriptionLabel")} {formatDurationMs(record.transcriptionDurationMs)}</span>
                        {record.enhancementDurationMs !== null && (
                          <span>{t("history.aiLabel")} {formatDurationMs(record.enhancementDurationMs)}</span>
                        )}
                        <span>{t("history.charCountLabel")} {record.charCount}</span>
                        <span>
                          {t("history.modeLabel")}
                          {record.triggerMode === "hold" ? t("history.holdMode") : t("history.toggleMode")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Loading more */}
        {isLoading && transcriptionList.length > 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("history.loadingMore")}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-4" />
      </div>
    </div>
  );
}
