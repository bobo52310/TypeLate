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
  Play,
  Square,
  Mic,
  Download,
  AlertTriangle,
  RotateCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { captureError } from "@/lib/sentry";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { TranscriptionRecord } from "@/types/transcription";
import { truncateText, getDisplayText, formatDuration } from "@/lib/formatUtils";
import { retryAllFailedRecords, type BulkRetrySummary } from "@/lib/retryFailedRecord";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import ExpandedRecordDetail from "@/components/history/ExpandedRecordDetail";

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
  const exportAllTranscriptions = useHistoryStore((s) => s.exportAllTranscriptions);
  const statusFilter = useHistoryStore((s) => s.statusFilter);
  const setStatusFilter = useHistoryStore((s) => s.setStatusFilter);
  const consumePendingFailedFilter = useHistoryStore((s) => s.consumePendingFailedFilter);
  const failedRecoverableCount = useHistoryStore((s) => s.dashboardStats.failedRecoverableCount);
  const refreshDashboard = useHistoryStore((s) => s.refreshDashboard);
  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);
  const bulkFeedback = useFeedbackMessage();

  const [searchInput, setSearchInput] = useState("");
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);
  const [playbackErrorId, setPlaybackErrorId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">("idle");
  const [bulkRetryState, setBulkRetryState] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Random slogan for empty state (stable per mount)
  const [slogan] = useState(() => getRandomSlogan());

  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const toggleFailedFilter = useCallback(() => {
    const next = statusFilter === "failed" ? "all" : "failed";
    setStatusFilter(next);
    void resetAndFetch();
  }, [statusFilter, setStatusFilter, resetAndFetch]);

  async function handleBulkRetry() {
    if (bulkRetryState) return;
    const targets = transcriptionList.filter(
      (r) => r.status === "failed" && !!r.audioFilePath,
    );
    if (targets.length === 0) return;

    setBulkRetryState({ current: 0, total: targets.length });
    let summary: BulkRetrySummary | null = null;
    try {
      summary = await retryAllFailedRecords(targets, (progress) => {
        setBulkRetryState({ current: progress.current, total: progress.total });
      });
    } catch (err) {
      captureError(err, { source: "history", action: "bulk-retry" });
    } finally {
      setBulkRetryState(null);
    }

    await resetAndFetch();
    await refreshDashboard();

    if (!summary) {
      bulkFeedback.show("error", t("history.retry.bulkUnknownError"));
      return;
    }
    if (summary.stoppedOnApiKeyMissing) {
      bulkFeedback.show("error", t("history.retry.bulkStoppedApiKey"));
      return;
    }
    if (summary.failed === 0) {
      bulkFeedback.show(
        "success",
        t("history.retry.bulkAllSucceeded", { count: summary.succeeded }),
      );
    } else {
      bulkFeedback.show(
        "error",
        t("history.retry.bulkSummary", {
          succeeded: summary.succeeded,
          failed: summary.failed,
        }),
      );
    }
  }

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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteIdRef = useRef<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function requestDeleteRecord(record: TranscriptionRecord) {
    if (confirmDeleteIdRef.current === record.id) {
      // Second click — confirmed
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteIdRef.current = null;
      setConfirmDeleteId(null);
      void executeDeleteRecord(record);
    } else {
      // First click — enter confirm state, auto-revert after 3s
      confirmDeleteIdRef.current = record.id;
      setConfirmDeleteId(record.id);
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = setTimeout(() => {
        confirmDeleteIdRef.current = null;
        setConfirmDeleteId(null);
      }, 3000);
    }
  }

  async function executeDeleteRecord(record: TranscriptionRecord) {
    try {
      await deleteTranscription(record.id);
      if (expandedRecordId === record.id) setExpandedRecordId(null);
      void refreshDashboard();
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
    if (!record.audioFilePath) {
      setPlaybackErrorId(record.id);
      setTimeout(() => setPlaybackErrorId(null), 3000);
      return;
    }
    setPlayingRecordId(record.id);
    setPlaybackErrorId(null);
    try {
      const raw = await invoke<number[]>("read_recording_file", { id: record.id });
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
    } catch (err) {
      captureError(err, { source: "history", action: "play-recording" });
      cleanupAudio();
      setPlayingRecordId(null);
      setPlaybackErrorId(record.id);
      setTimeout(() => setPlaybackErrorId(null), 3000);
    }
  }

  async function handleExport() {
    setExportStatus("exporting");
    try {
      const allRecords = await exportAllTranscriptions();
      const exportData = allRecords.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        date: new Date(r.timestamp).toISOString(),
        rawText: r.rawText,
        processedText: r.processedText,
        charCount: r.charCount,
        recordingDurationMs: r.recordingDurationMs,
        wasEnhanced: r.wasEnhanced,
        whisperModelId: r.whisperModelId,
        llmModelId: r.llmModelId,
      }));
      const json = JSON.stringify(exportData, null, 2);
      await invoke("copy_to_clipboard", { text: json });
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 2500);
    } catch (err) {
      captureError(err, { source: "history", action: "export" });
      setExportStatus("idle");
    }
  }

  useEffect(() => {
    if (consumePendingFailedFilter()) {
      setStatusFilter("failed");
    }
    void resetAndFetch();
    let unlisten: (() => void) | undefined;
    listen(TRANSCRIPTION_COMPLETED, () => {
      void resetAndFetch();
      void refreshDashboard();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      cleanupAudio();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    };
  }, [resetAndFetch, refreshDashboard, consumePendingFailedFilter, setStatusFilter]);

  // Scroll to a record after retry success + list refresh
  useEffect(() => {
    if (!pendingScrollId) return;
    // Check if the record is now in the list
    const exists = transcriptionList.some((r) => r.id === pendingScrollId);
    if (!exists) return;
    // Use requestAnimationFrame to wait for DOM update
    const rafId = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-record-id="${pendingScrollId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setExpandedRecordId(pendingScrollId);
      }
      setPendingScrollId(null);
    });
    return () => cancelAnimationFrame(rafId);
  }, [pendingScrollId, transcriptionList]);

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

  const failedFilterActive = statusFilter === "failed";
  const failedChipCount =
    failedFilterActive && transcriptionList.length > 0
      ? transcriptionList.length
      : failedRecoverableCount;
  const bulkRetryTargetCount = transcriptionList.filter(
    (r) => r.status === "failed" && !!r.audioFilePath,
  ).length;

  return (
    <div className="flex h-full flex-col">
      {/* Search + Export */}
      <div className="shrink-0 px-5 pt-4 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("history.searchPlaceholder")}
              className="w-full pl-9 h-8 text-sm"
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
            />
          </div>
          {(failedFilterActive || failedRecoverableCount > 0) && (
            <Button
              variant={failedFilterActive ? "destructive" : "outline"}
              size="sm"
              className={cn(
                "h-8 gap-1 px-2 text-xs",
                !failedFilterActive && "text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={toggleFailedFilter}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("history.failedFilter.label", { count: failedChipCount })}
            </Button>
          )}
          {transcriptionList.length > 0 && !failedFilterActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground"
              disabled={exportStatus === "exporting"}
              onClick={() => void handleExport()}
            >
              {exportStatus === "done" ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportStatus === "done" ? t("history.copied") : "JSON"}
            </Button>
          )}
        </div>

        {/* Bulk retry row — only when failed filter is active */}
        {failedFilterActive && bulkRetryTargetCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {bulkRetryState
                ? t("history.retry.bulkProgress", {
                    current: bulkRetryState.current,
                    total: bulkRetryState.total,
                  })
                : t("history.retry.bulkHint", { count: bulkRetryTargetCount })}
            </span>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1 px-2.5 text-xs"
              disabled={!!bulkRetryState}
              onClick={() => void handleBulkRetry()}
            >
              {bulkRetryState ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
              {bulkRetryState
                ? t("history.retry.bulkRunning")
                : t("history.retry.bulkAction", { count: bulkRetryTargetCount })}
            </Button>
          </div>
        )}

        {/* Bulk retry feedback */}
        {bulkFeedback.message && (
          <div
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs",
              bulkFeedback.type === "success"
                ? "border-primary/30 bg-primary/5 text-primary"
                : "border-destructive/30 bg-destructive/5 text-destructive",
            )}
          >
            {bulkFeedback.message}
          </div>
        )}
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
                    data-record-id={record.id}
                    className={cn(
                      "rounded-lg border transition-colors",
                      expanded ? "border-border bg-card" : "border-transparent hover:bg-accent/40",
                    )}
                  >
                    {/* Row */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-3 py-2"
                      onClick={() => toggleExpand(record.id)}
                    >
                      {/* Play button / waveform */}
                      <div className="relative shrink-0">
                        <button
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                            playing ? "bg-primary/15" : "bg-muted hover:bg-muted/80",
                            !record.audioFilePath && "opacity-30",
                          )}
                          disabled={!record.audioFilePath}
                          aria-label={t("history.playRecording")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePlayRecording(record);
                          }}
                        >
                          {playing ? (
                            <PlaybackWaveform />
                          ) : (
                            <Play className="h-3 w-3 text-foreground ml-0.5" />
                          )}
                        </button>
                        {playbackErrorId === record.id && (
                          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-destructive">
                            {t("history.noRecordingFile")}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm text-foreground">
                            {truncateText(getDisplayText(record), 60)}
                          </span>
                          {record.wasEnhanced && (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                              title={t("dashboard.aiEnhanced")}
                            />
                          )}
                          {record.status === "failed" && (
                            <Badge
                              variant="destructive"
                              className="text-[9px] px-1 py-0 leading-tight"
                            >
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
                              <span>
                                {record.charCount} {t("dashboard.characterUnit")}
                              </span>
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
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePlayRecording(record);
                            }}
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyText(record);
                          }}
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
                      <ExpandedRecordDetail
                        record={record}
                        confirmDeleteId={confirmDeleteId}
                        onRequestDelete={requestDeleteRecord}
                        onRetrySuccess={setPendingScrollId}
                      />
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
