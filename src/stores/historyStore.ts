import { create } from "zustand";
import type {
  TranscriptionRecord,
  DashboardStats,
  DailyQuotaUsage,
  ApiUsageRecord,
  DailyUsageTrend,
} from "@/types/transcription";
import type { TriggerMode } from "@/types";
import type { PromptMode } from "@/types/settings";
import { PROMPT_MODE_VALUES } from "@/types/settings";
import type { TranscriptionCompletedPayload } from "@/types/events";
import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "@/lib/database";
import { extractErrorMessage } from "@/lib/errorUtils";
import { logError } from "@/lib/logger";
import { captureError } from "@/lib/sentry";
import { emitToWindow, TRANSCRIPTION_COMPLETED } from "@/hooks/useTauriEvent";

const PAGE_SIZE = 20;

interface RawTranscriptionRow {
  id: string;
  timestamp: number;
  raw_text: string;
  processed_text: string | null;
  recording_duration_ms: number;
  transcription_duration_ms: number;
  enhancement_duration_ms: number | null;
  char_count: number;
  trigger_mode: string;
  prompt_mode: string | null;
  was_enhanced: number;
  was_modified: number | null;
  created_at: string;
  audio_file_path: string | null;
  status: string;
  whisper_model_id: string | null;
  llm_model_id: string | null;
}

function parsePromptMode(value: string | null): PromptMode | null {
  if (value === null) return null;
  return (PROMPT_MODE_VALUES as readonly string[]).includes(value) ? (value as PromptMode) : null;
}

function mapRowToRecord(row: RawTranscriptionRow): TranscriptionRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    rawText: row.raw_text,
    processedText: row.processed_text,
    recordingDurationMs: row.recording_duration_ms,
    transcriptionDurationMs: row.transcription_duration_ms,
    enhancementDurationMs: row.enhancement_duration_ms,
    charCount: row.char_count,
    triggerMode: row.trigger_mode as TriggerMode,
    promptMode: parsePromptMode(row.prompt_mode),
    wasEnhanced: row.was_enhanced === 1,
    wasModified: row.was_modified === null ? null : row.was_modified === 1,
    createdAt: row.created_at,
    audioFilePath: row.audio_file_path,
    status: row.status as TranscriptionRecord["status"],
    whisperModelId: row.whisper_model_id,
    llmModelId: row.llm_model_id,
  };
}

const INSERT_SQL = `
  INSERT INTO transcriptions (
    id, timestamp, raw_text, processed_text,
    recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
    char_count, trigger_mode, prompt_mode, was_enhanced, was_modified,
    audio_file_path, status, whisper_model_id, llm_model_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
`;

const SELECT_ALL_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, prompt_mode, was_enhanced, was_modified, created_at,
         audio_file_path, status, whisper_model_id, llm_model_id
  FROM transcriptions
  ORDER BY timestamp DESC
`;

const SELECT_PAGED_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, prompt_mode, was_enhanced, was_modified, created_at,
         audio_file_path, status, whisper_model_id, llm_model_id
  FROM transcriptions
  ORDER BY timestamp DESC
  LIMIT $1 OFFSET $2
`;

const SEARCH_PAGED_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, prompt_mode, was_enhanced, was_modified, created_at,
         audio_file_path, status, whisper_model_id, llm_model_id
  FROM transcriptions
  WHERE raw_text LIKE $1 ESCAPE '\\' OR processed_text LIKE $1 ESCAPE '\\'
  ORDER BY timestamp DESC
  LIMIT $2 OFFSET $3
`;

const DASHBOARD_STATS_SQL = `
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(char_count), 0) as total_characters,
    COALESCE(SUM(recording_duration_ms), 0) as total_recording_duration_ms
  FROM transcriptions
  WHERE status != 'failed'
`;

const INSERT_API_USAGE_SQL = `
  INSERT INTO api_usage (
    id, transcription_id, api_type, model,
    prompt_tokens, completion_tokens, total_tokens,
    prompt_time_ms, completion_time_ms, total_time_ms,
    audio_duration_ms, estimated_cost_ceiling, created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, datetime('now'))
`;

const DAILY_QUOTA_USAGE_SQL = `
  SELECT
    api_type,
    COUNT(*) as request_count,
    COALESCE(SUM(total_tokens), 0) as total_tokens,
    COALESCE(SUM(MAX(COALESCE(audio_duration_ms, 0), 10000)), 0) as billed_audio_ms
  FROM api_usage
  WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
  GROUP BY api_type
`;

const DAILY_USAGE_TREND_SQL = `
  SELECT
    DATE(datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
    COUNT(*) as count,
    COALESCE(SUM(char_count), 0) as total_chars
  FROM transcriptions
  WHERE timestamp >= $1 AND status != 'failed'
  GROUP BY date
  ORDER BY date DESC
  LIMIT $2
`;

const UPDATE_ON_RETRY_SUCCESS_SQL = `
  UPDATE transcriptions
  SET status = 'success',
      raw_text = $1,
      processed_text = $2,
      transcription_duration_ms = $3,
      enhancement_duration_ms = $4,
      was_enhanced = $5,
      char_count = $6
  WHERE id = $7
`;

const DELETE_API_USAGE_BY_TRANSCRIPTION_SQL = `
  DELETE FROM api_usage WHERE transcription_id = $1
`;

const DELETE_TRANSCRIPTION_SQL = `
  DELETE FROM transcriptions WHERE id = $1
`;

const UPDATE_TEXT_SQL = `
  UPDATE transcriptions
  SET raw_text = $1, processed_text = $2, char_count = $3
  WHERE id = $4
`;

const SELECT_RECENT_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, prompt_mode, was_enhanced, was_modified, created_at,
         audio_file_path, status, whisper_model_id, llm_model_id
  FROM transcriptions
  ORDER BY timestamp DESC
  LIMIT $1
`;

const ASSUMED_TYPING_SPEED_CHARS_PER_MIN = 40;

interface DashboardStatsRow {
  total_count: number;
  total_characters: number;
  total_recording_duration_ms: number;
}

interface DailyQuotaUsageRow {
  api_type: string;
  request_count: number;
  total_tokens: number;
  billed_audio_ms: number;
}

interface DailyUsageTrendRow {
  date: string;
  count: number;
  total_chars: number;
}

interface HistoryState {
  // -- State --
  transcriptionList: TranscriptionRecord[];
  isLoading: boolean;
  searchQuery: string;
  hasMore: boolean;
  currentOffset: number;
  dashboardStats: DashboardStats;
  recentTranscriptionList: TranscriptionRecord[];
  dailyUsageTrendList: DailyUsageTrend[];

  // -- Actions --
  fetchTranscriptionList: () => Promise<void>;
  searchTranscriptionList: (
    query: string,
    limit?: number,
    offset?: number,
  ) => Promise<TranscriptionRecord[]>;
  resetAndFetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  addTranscription: (
    record: TranscriptionRecord,
    options?: { skipEmit?: boolean },
  ) => Promise<void>;
  updateTranscriptionOnRetrySuccess: (
    params: {
      id: string;
      rawText: string;
      processedText: string | null;
      transcriptionDurationMs: number;
      enhancementDurationMs: number | null;
      wasEnhanced: boolean;
      charCount: number;
    },
    options?: { skipEmit?: boolean },
  ) => Promise<void>;
  addApiUsage: (record: ApiUsageRecord) => Promise<void>;
  fetchDashboardStats: () => Promise<DashboardStats>;
  fetchRecentTranscriptionList: (limit?: number) => Promise<TranscriptionRecord[]>;
  refreshDashboard: () => Promise<void>;
  clearAllAudioFilePath: () => Promise<void>;
  clearAudioFilePathByIdList: (idList: string[]) => Promise<void>;
  updateTranscriptionText: (
    id: string,
    rawText: string,
    processedText: string | null,
  ) => Promise<void>;
  deleteTranscription: (id: string) => Promise<void>;
  deleteAllRecordingFiles: () => Promise<number>;
  exportAllTranscriptions: () => Promise<TranscriptionRecord[]>;
}

async function fetchDailyQuotaUsage(): Promise<DailyQuotaUsage> {
  const db = getDatabase();
  const rows = await db.select<DailyQuotaUsageRow[]>(DAILY_QUOTA_USAGE_SQL);

  const result: DailyQuotaUsage = {
    whisperRequestCount: 0,
    whisperBilledAudioMs: 0,
    llmRequestCount: 0,
    llmTotalTokens: 0,
    vocabularyAnalysisRequestCount: 0,
    vocabularyAnalysisTotalTokens: 0,
  };

  for (const row of rows) {
    if (row.api_type === "whisper") {
      result.whisperRequestCount = row.request_count;
      result.whisperBilledAudioMs = row.billed_audio_ms;
    } else if (row.api_type === "chat") {
      result.llmRequestCount = row.request_count;
      result.llmTotalTokens = row.total_tokens;
    } else if (row.api_type === "vocabulary_analysis") {
      result.vocabularyAnalysisRequestCount = row.request_count;
      result.vocabularyAnalysisTotalTokens = row.total_tokens;
    }
  }

  return result;
}

async function fetchDailyUsageTrend(days = 30): Promise<DailyUsageTrend[]> {
  const db = getDatabase();
  const cutoffTimestamp = Date.now() - days * 86_400_000;
  const rows = await db.select<DailyUsageTrendRow[]>(DAILY_USAGE_TREND_SQL, [
    cutoffTimestamp,
    days,
  ]);

  // Build lookup from SQL results
  const countByDate = new Map<string, { count: number; totalChars: number }>();
  for (const row of rows) {
    countByDate.set(row.date, { count: row.count, totalChars: row.total_chars });
  }

  // Pad to full 30-day range so the chart always shows all days
  const result: DailyUsageTrend[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = countByDate.get(dateStr);
    result.push({
      date: dateStr,
      count: entry?.count ?? 0,
      totalChars: entry?.totalChars ?? 0,
    });
  }
  return result;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  // -- State --
  transcriptionList: [],
  isLoading: false,
  searchQuery: "",
  hasMore: true,
  currentOffset: 0,
  dashboardStats: {
    totalTranscriptions: 0,
    totalCharacters: 0,
    totalRecordingDurationMs: 0,
    estimatedTimeSavedMs: 0,
    dailyQuotaUsage: {
      whisperRequestCount: 0,
      whisperBilledAudioMs: 0,
      llmRequestCount: 0,
      llmTotalTokens: 0,
      vocabularyAnalysisRequestCount: 0,
      vocabularyAnalysisTotalTokens: 0,
    },
  },
  recentTranscriptionList: [],
  dailyUsageTrendList: [],

  // -- Actions --

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  fetchTranscriptionList: async () => {
    set({ isLoading: true });
    try {
      const db = getDatabase();
      const rows = await db.select<RawTranscriptionRow[]>(SELECT_ALL_SQL);
      set({ transcriptionList: rows.map(mapRowToRecord) });
    } catch (err) {
      logError("history", `fetchTranscriptionList failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "fetch" });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  searchTranscriptionList: async (query: string, limit = PAGE_SIZE, offset = 0) => {
    const db = getDatabase();
    let rows: RawTranscriptionRow[];

    if (query.trim()) {
      const escaped = query.trim().replace(/[%_\\]/g, "\\$&");
      const pattern = `%${escaped}%`;
      rows = await db.select<RawTranscriptionRow[]>(SEARCH_PAGED_SQL, [pattern, limit, offset]);
    } else {
      rows = await db.select<RawTranscriptionRow[]>(SELECT_PAGED_SQL, [limit, offset]);
    }

    return rows.map(mapRowToRecord);
  },

  resetAndFetch: async () => {
    set({ isLoading: true });
    try {
      set({ currentOffset: 0, hasMore: true });
      const results = await get().searchTranscriptionList(get().searchQuery, PAGE_SIZE, 0);
      set({
        transcriptionList: results,
        currentOffset: results.length,
        hasMore: results.length >= PAGE_SIZE,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    set({ isLoading: true });
    try {
      const { searchQuery, currentOffset, transcriptionList } = get();
      const results = await get().searchTranscriptionList(searchQuery, PAGE_SIZE, currentOffset);
      set({
        transcriptionList: [...transcriptionList, ...results],
        currentOffset: currentOffset + results.length,
        hasMore: results.length >= PAGE_SIZE,
      });
    } finally {
      set({ isLoading: false });
    }
  },

  addTranscription: async (record: TranscriptionRecord, options?: { skipEmit?: boolean }) => {
    const db = getDatabase();
    try {
      await db.execute(INSERT_SQL, [
        record.id,
        record.timestamp,
        record.rawText,
        record.processedText,
        record.recordingDurationMs,
        record.transcriptionDurationMs,
        record.enhancementDurationMs,
        record.charCount,
        record.triggerMode,
        record.promptMode,
        record.wasEnhanced ? 1 : 0,
        record.wasModified === null ? null : record.wasModified ? 1 : 0,
        record.audioFilePath,
        record.status,
        record.whisperModelId,
        record.llmModelId,
      ]);
    } catch (err) {
      logError("history", `addTranscription failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "add" });
      throw err;
    }

    if (!options?.skipEmit) {
      try {
        const payload: TranscriptionCompletedPayload = {
          id: record.id,
          rawText: record.rawText,
          processedText: record.processedText,
          recordingDurationMs: record.recordingDurationMs,
          transcriptionDurationMs: record.transcriptionDurationMs,
          enhancementDurationMs: record.enhancementDurationMs,
          charCount: record.charCount,
          wasEnhanced: record.wasEnhanced,
        };
        await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
      } catch (emitErr) {
        logError("history", "emitToWindow failed (INSERT succeeded)", emitErr);
        captureError(emitErr, { source: "history", step: "add-emit" });
      }
    }
  },

  updateTranscriptionOnRetrySuccess: async (params, options?: { skipEmit?: boolean }) => {
    const db = getDatabase();
    try {
      await db.execute(UPDATE_ON_RETRY_SUCCESS_SQL, [
        params.rawText,
        params.processedText,
        params.transcriptionDurationMs,
        params.enhancementDurationMs,
        params.wasEnhanced ? 1 : 0,
        params.charCount,
        params.id,
      ]);
    } catch (err) {
      logError("history", `updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "update-retry-success" });
      throw err;
    }

    if (!options?.skipEmit) {
      try {
        const payload: TranscriptionCompletedPayload = {
          id: params.id,
          rawText: params.rawText,
          processedText: params.processedText,
          recordingDurationMs: 0,
          transcriptionDurationMs: params.transcriptionDurationMs,
          enhancementDurationMs: params.enhancementDurationMs,
          charCount: params.charCount,
          wasEnhanced: params.wasEnhanced,
        };
        await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
      } catch (emitErr) {
        logError("history", "emitToWindow failed (UPDATE succeeded)", emitErr);
        captureError(emitErr, { source: "history", step: "update-retry-emit" });
      }
    }
  },

  addApiUsage: async (record: ApiUsageRecord) => {
    const db = getDatabase();
    try {
      await db.execute(INSERT_API_USAGE_SQL, [
        record.id,
        record.transcriptionId,
        record.apiType,
        record.model,
        record.promptTokens,
        record.completionTokens,
        record.totalTokens,
        record.promptTimeMs,
        record.completionTimeMs,
        record.totalTimeMs,
        record.audioDurationMs,
        record.estimatedCostCeiling,
      ]);
    } catch (err) {
      logError("history", `addApiUsage failed for ${record.apiType}: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "add-api-usage" });
      throw err;
    }
  },

  fetchDashboardStats: async () => {
    const db = getDatabase();
    const fallbackQuota: DailyQuotaUsage = {
      whisperRequestCount: 0,
      whisperBilledAudioMs: 0,
      llmRequestCount: 0,
      llmTotalTokens: 0,
      vocabularyAnalysisRequestCount: 0,
      vocabularyAnalysisTotalTokens: 0,
    };
    const [statsRows, dailyQuotaUsage] = await Promise.all([
      db.select<DashboardStatsRow[]>(DASHBOARD_STATS_SQL),
      fetchDailyQuotaUsage().catch((err) => {
        logError("history", `fetchDailyQuotaUsage failed: ${extractErrorMessage(err)}`);
        captureError(err, { source: "history", step: "fetch-daily-quota" });
        return fallbackQuota;
      }),
    ]);
    const row = statsRows[0] ?? {
      total_count: 0,
      total_characters: 0,
      total_recording_duration_ms: 0,
    };

    return {
      totalTranscriptions: row.total_count,
      totalCharacters: row.total_characters,
      totalRecordingDurationMs: row.total_recording_duration_ms,
      estimatedTimeSavedMs: Math.max(
        0,
        Math.round((row.total_characters / ASSUMED_TYPING_SPEED_CHARS_PER_MIN) * 60000) -
          row.total_recording_duration_ms,
      ),
      dailyQuotaUsage,
    };
  },

  fetchRecentTranscriptionList: async (limit = 10) => {
    const db = getDatabase();
    const rows = await db.select<RawTranscriptionRow[]>(SELECT_RECENT_SQL, [limit]);
    return rows.map(mapRowToRecord);
  },

  refreshDashboard: async () => {
    const results = await Promise.allSettled([
      get().fetchDashboardStats(),
      get().fetchRecentTranscriptionList(10),
      fetchDailyUsageTrend(),
    ]);
    const updates: Partial<HistoryState> = {};

    if (results[0].status === "fulfilled") {
      updates.dashboardStats = results[0].value;
    } else {
      captureError(results[0].reason, {
        source: "history",
        step: "fetch-stats",
      });
    }
    if (results[1].status === "fulfilled") {
      updates.recentTranscriptionList = results[1].value;
    } else {
      captureError(results[1].reason, {
        source: "history",
        step: "fetch-recent",
      });
    }
    if (results[2].status === "fulfilled") {
      updates.dailyUsageTrendList = results[2].value;
    } else {
      captureError(results[2].reason, {
        source: "history",
        step: "fetch-trend",
      });
    }

    set(updates);
  },

  clearAllAudioFilePath: async () => {
    const db = getDatabase();
    await db.execute(
      "UPDATE transcriptions SET audio_file_path = NULL WHERE audio_file_path IS NOT NULL",
    );
  },

  clearAudioFilePathByIdList: async (idList: string[]) => {
    if (idList.length === 0) return;
    const db = getDatabase();
    const placeholders = idList.map((_, i) => `$${i + 1}`).join(", ");
    await db.execute(
      `UPDATE transcriptions SET audio_file_path = NULL WHERE id IN (${placeholders})`,
      idList,
    );
  },

  updateTranscriptionText: async (
    id: string,
    rawText: string,
    processedText: string | null,
  ) => {
    const charCount = (processedText ?? rawText).length;
    const db = getDatabase();
    try {
      await db.execute(UPDATE_TEXT_SQL, [rawText, processedText, charCount, id]);
      set({
        transcriptionList: get().transcriptionList.map((r) =>
          r.id === id ? { ...r, rawText, processedText, charCount } : r,
        ),
      });
    } catch (err) {
      logError("history", `updateTranscriptionText failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "update-text" });
      throw err;
    }
  },

  deleteTranscription: async (id: string) => {
    const db = getDatabase();
    try {
      await db.execute(DELETE_API_USAGE_BY_TRANSCRIPTION_SQL, [id]);
      await db.execute(DELETE_TRANSCRIPTION_SQL, [id]);
      set({
        transcriptionList: get().transcriptionList.filter((r) => r.id !== id),
      });
    } catch (err) {
      logError("history", `deleteTranscription failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "history", step: "delete" });
      throw err;
    }
  },

  deleteAllRecordingFiles: async () => {
    const deletedCount = await invoke<number>("delete_all_recordings");
    await get().clearAllAudioFilePath();
    return deletedCount;
  },

  exportAllTranscriptions: async () => {
    const db = getDatabase();
    const rows = await db.select<RawTranscriptionRow[]>(SELECT_ALL_SQL);
    return rows.map(mapRowToRecord);
  },
}));
