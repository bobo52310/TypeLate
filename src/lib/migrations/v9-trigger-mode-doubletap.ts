import type { Migration } from "./index";

/**
 * v9: Expand trigger_mode CHECK constraint to include 'doubleTap'.
 *
 * SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT, so we recreate
 * the table with the updated CHECK and copy all data over.
 */
export const v9TriggerModeDoubleTap: Migration = {
  version: 9,
  description: "Allow doubleTap in trigger_mode CHECK constraint",
  up: async (db) => {
    // Clean up partial state from a previous failed attempt
    await db.execute("DROP TABLE IF EXISTS transcriptions_new;");

    await db.execute(`
      CREATE TABLE transcriptions_new (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        processed_text TEXT,
        recording_duration_ms INTEGER NOT NULL,
        transcription_duration_ms INTEGER NOT NULL,
        enhancement_duration_ms INTEGER,
        char_count INTEGER NOT NULL,
        trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle', 'doubleTap')),
        was_enhanced INTEGER NOT NULL DEFAULT 0,
        was_modified INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        audio_file_path TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        whisper_model_id TEXT,
        llm_model_id TEXT
      );
    `);

    await db.execute(`
      INSERT INTO transcriptions_new
      SELECT id, timestamp, raw_text, processed_text,
             recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
             char_count, trigger_mode, was_enhanced, was_modified, created_at,
             audio_file_path, status, whisper_model_id, llm_model_id
      FROM transcriptions;
    `);

    await db.execute("DROP TABLE transcriptions;");
    await db.execute("ALTER TABLE transcriptions_new RENAME TO transcriptions;");

    // Recreate indexes
    await db.execute(`
      CREATE INDEX idx_transcriptions_timestamp ON transcriptions(timestamp DESC);
    `);
    await db.execute(`
      CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at);
    `);
    await db.execute(`
      CREATE INDEX idx_transcriptions_status ON transcriptions(status);
    `);
  },
};
