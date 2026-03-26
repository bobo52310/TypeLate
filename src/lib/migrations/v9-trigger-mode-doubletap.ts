import type { Migration } from "./index";
import { tableExists } from "./utils";

/**
 * v9: Expand trigger_mode CHECK constraint to include 'doubleTap'.
 *
 * Strategy: RENAME old → _old, CREATE new, COPY, DROP _old.
 * If DROP _old fails the new table is already functional, so the
 * migration still succeeds. Handles partial state from prior failures.
 */
export const v9TriggerModeDoubleTap: Migration = {
  version: 9,
  description: "Allow doubleTap in trigger_mode CHECK constraint",
  up: async (db) => {
    // If a previous run already completed the rename+create but failed on
    // cleanup, the correct "transcriptions" table already exists with the
    // new constraint. Detect this by checking if _old lingers.
    const oldExists = await tableExists(db, "transcriptions_old");
    const newExists = await tableExists(db, "transcriptions_new");

    // Clean up any leftover temp tables from previous failed attempts
    if (newExists) {
      await db.execute("DROP TABLE transcriptions_new;");
    }

    if (oldExists) {
      // Previous run renamed original → _old and may have created the
      // new table already. Just make sure _old is gone.
      await db.execute("DROP TABLE transcriptions_old;");
      // If transcriptions (the new one) already exists, we're done.
      if (await tableExists(db, "transcriptions")) return;
    }

    // Step 1: Rename original out of the way
    await db.execute("ALTER TABLE transcriptions RENAME TO transcriptions_old;");

    // Step 2: Create replacement with updated CHECK constraint
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

    // Step 3: Copy all existing data
    await db.execute(`
      INSERT INTO transcriptions
      SELECT id, timestamp, raw_text, processed_text,
             recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
             char_count, trigger_mode, was_enhanced, was_modified, created_at,
             audio_file_path, status, whisper_model_id, llm_model_id
      FROM transcriptions_old;
    `);

    // Step 4: Recreate indexes on new table
    await db.execute(
      "CREATE INDEX idx_transcriptions_timestamp ON transcriptions(timestamp DESC);",
    );
    await db.execute(
      "CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at);",
    );
    await db.execute(
      "CREATE INDEX idx_transcriptions_status ON transcriptions(status);",
    );

    // Step 5: Drop old table (best-effort — new table is already usable)
    try {
      await db.execute("DROP TABLE transcriptions_old;");
    } catch {
      // Non-fatal: _old lingers but will be cleaned up on next startup
    }
  },
};
