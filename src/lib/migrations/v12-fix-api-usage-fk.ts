import type { Migration } from "./index";
import { tableExists } from "./utils";

/**
 * v12: Fix broken api_usage FK that references the dropped transcriptions_old table.
 *
 * Background: v9 ran `ALTER TABLE transcriptions RENAME TO transcriptions_old`.
 * Modern SQLite (>= 3.25) with default `legacy_alter_table=OFF` auto-rewrites
 * FK references in OTHER tables. So api_usage's FK silently became
 * `REFERENCES transcriptions_old(id)`. After v9 dropped transcriptions_old,
 * any DML on api_usage fails with "no such table: main.transcriptions_old"
 * (sqlx-sqlite enables `PRAGMA foreign_keys = ON` by default).
 *
 * Fix: rebuild api_usage without the FK. The relation is already maintained
 * manually in app code (deleteTranscription deletes from api_usage first).
 */
export const v12FixApiUsageFk: Migration = {
  version: 12,
  description: "Rebuild api_usage to drop FK referencing missing transcriptions_old",
  up: async (db) => {
    // Best-effort: drop any lingering transcriptions_old left over from v9.
    try {
      await db.execute("DROP TABLE IF EXISTS transcriptions_old;");
    } catch {
      // non-fatal
    }

    if (!(await tableExists(db, "api_usage"))) return;

    const fkList = await db.select<{ table: string }[]>("PRAGMA foreign_key_list(api_usage);");
    const broken = fkList.some((fk) => fk.table !== "transcriptions");
    if (!broken) return;

    // Clean up any leftover rebuild table from a previous failed attempt.
    if (await tableExists(db, "api_usage_v12_broken")) {
      try {
        await db.execute("DROP TABLE api_usage_v12_broken;");
      } catch {
        // non-fatal
      }
    }

    await db.execute("ALTER TABLE api_usage RENAME TO api_usage_v12_broken;");

    await db.execute(`
      CREATE TABLE api_usage (
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
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await db.execute(`
      INSERT INTO api_usage
      SELECT id, transcription_id, api_type, model, prompt_tokens, completion_tokens,
             total_tokens, prompt_time_ms, completion_time_ms, total_time_ms,
             audio_duration_ms, estimated_cost_ceiling, created_at
      FROM api_usage_v12_broken;
    `);

    try {
      await db.execute("DROP TABLE api_usage_v12_broken;");
    } catch {
      // non-fatal: leftover doesn't affect functionality
    }

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
      ON api_usage(transcription_id);
    `);
  },
};
