import type { Migration } from "./index";
import { addColumnIfNotExists, tableExists } from "./utils";

export const v3VocabularyWeight: Migration = {
  version: 3,
  description: "Add weight/source columns to vocabulary + expand api_usage CHECK constraint",
  up: async (db) => {
    // DDL (ALTER TABLE ADD COLUMN) must run outside transactions —
    // under tauri-plugin-sql, DDL inside explicit transactions is invisible to subsequent statements
    await addColumnIfNotExists(db, "vocabulary", "weight INTEGER NOT NULL DEFAULT 1");
    await addColumnIfNotExists(db, "vocabulary", "source TEXT NOT NULL DEFAULT 'manual'");

    await db.execute("BEGIN TRANSACTION;");
    try {
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_vocabulary_weight ON vocabulary(weight DESC);",
      );

      // Rebuild api_usage table to expand CHECK constraint with 'vocabulary_analysis'.
      // SQLite does not support ALTER CONSTRAINT, so a full table rebuild is required.
      // Drop any leftover temp table from a previous failed migration attempt.
      await db.execute("DROP TABLE IF EXISTS api_usage_new;");
      await db.execute(`
        CREATE TABLE api_usage_new (
          id TEXT PRIMARY KEY,
          transcription_id TEXT NOT NULL,
          api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat', 'vocabulary_analysis')),
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

      // api_usage may have been DROPped in a prior failed migration without RENAME back
      const hasApiUsage = await tableExists(db, "api_usage");
      if (hasApiUsage) {
        await db.execute("INSERT INTO api_usage_new SELECT * FROM api_usage;");
        await db.execute("DROP TABLE api_usage;");
      }
      await db.execute("ALTER TABLE api_usage_new RENAME TO api_usage;");
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
        ON api_usage(transcription_id);
      `);

      await db.execute("COMMIT;");
    } catch (migrationError) {
      await db.execute("ROLLBACK;");
      throw migrationError;
    }
  },
};
