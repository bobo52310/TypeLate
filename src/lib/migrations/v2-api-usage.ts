import type { Migration } from "./index";

export const v2ApiUsage: Migration = {
  version: 2,
  description: "API usage tracking table",
  up: async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY,
        transcription_id TEXT NOT NULL,
        api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat')),
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        prompt_time_ms REAL,
        completion_time_ms REAL,
        total_time_ms REAL,
        audio_duration_ms INTEGER,
        estimated_cost_ceiling REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
      ON api_usage(transcription_id);
    `);
  },
};
