import type { Migration } from "./index";
import { tableExists } from "./utils";

/**
 * v9: Expand trigger_mode CHECK constraint to include 'doubleTap'.
 *
 * Strategy: RENAME old → _old, CREATE new, COPY, best-effort DROP _old.
 * All DROP TABLE calls are wrapped in try/catch because Tauri's plugin-sql
 * rejects DROP TABLE in certain connection states. The migration is
 * designed to succeed as long as the new table is created and populated.
 */
export const v9TriggerModeDoubleTap: Migration = {
  version: 9,
  description: "Allow doubleTap in trigger_mode CHECK constraint",
  up: async (db) => {
    const mainExists = await tableExists(db, "transcriptions");
    const oldExists = await tableExists(db, "transcriptions_old");
    const newExists = await tableExists(db, "transcriptions_new");

    // Clean up any leftover _new from the original migration approach
    if (newExists) {
      try {
        await db.execute("DROP TABLE transcriptions_new;");
      } catch {
        // non-fatal
      }
    }

    // If a previous run already created the replacement table but
    // couldn't drop _old, the migration is effectively done.
    if (mainExists && oldExists) {
      try {
        await db.execute("DROP TABLE transcriptions_old;");
      } catch {
        // non-fatal: _old lingers but doesn't affect functionality
      }
      return;
    }

    // If only _old exists (main was renamed but new wasn't created yet),
    // rebuild from _old.
    if (!mainExists && oldExists) {
      await createNewTable(db);
      await db.execute(`
        INSERT INTO transcriptions
        SELECT id, timestamp, raw_text, processed_text,
               recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
               char_count, trigger_mode, was_enhanced, was_modified, created_at,
               audio_file_path, status, whisper_model_id, llm_model_id
        FROM transcriptions_old;
      `);
      await createIndexes(db);
      try {
        await db.execute("DROP TABLE transcriptions_old;");
      } catch {
        // non-fatal
      }
      return;
    }

    // Normal path: rename original, create new, copy data
    if (mainExists) {
      await db.execute("ALTER TABLE transcriptions RENAME TO transcriptions_old;");
      await createNewTable(db);
      await db.execute(`
        INSERT INTO transcriptions
        SELECT id, timestamp, raw_text, processed_text,
               recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
               char_count, trigger_mode, was_enhanced, was_modified, created_at,
               audio_file_path, status, whisper_model_id, llm_model_id
        FROM transcriptions_old;
      `);
      await createIndexes(db);
      try {
        await db.execute("DROP TABLE transcriptions_old;");
      } catch {
        // non-fatal
      }
    }
  },
};

async function createNewTable(db: import("@tauri-apps/plugin-sql").default) {
  // NOTE: prompt_mode column is added by v11 migration via ALTER TABLE;
  // it is intentionally absent from v9's CREATE TABLE so the copy INSERT
  // at v9 matches the original 16-column schema.
  await db.execute(`
    CREATE TABLE transcriptions (
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
}

async function createIndexes(db: import("@tauri-apps/plugin-sql").default) {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp DESC);",
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at);",
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);",
  );
}
