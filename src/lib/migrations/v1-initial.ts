import type { Migration } from "./index";

export const v1Initial: Migration = {
  version: 1,
  description: "Initial schema (transcriptions + vocabulary tables)",
  up: async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS transcriptions (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        processed_text TEXT,
        recording_duration_ms INTEGER NOT NULL,
        transcription_duration_ms INTEGER NOT NULL,
        enhancement_duration_ms INTEGER,
        char_count INTEGER NOT NULL,
        trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
        was_enhanced INTEGER NOT NULL DEFAULT 0,
        was_modified INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp
      ON transcriptions(timestamp DESC);
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
      ON transcriptions(created_at);
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS vocabulary (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
