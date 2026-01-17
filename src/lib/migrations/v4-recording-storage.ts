import type { Migration } from "./index";
import { addColumnIfNotExists } from "./utils";

export const v4RecordingStorage: Migration = {
  version: 4,
  description: "Add audio_file_path and status columns to transcriptions",
  up: async (db) => {
    // DDL (ALTER TABLE ADD COLUMN) must run outside transactions
    await addColumnIfNotExists(db, "transcriptions", "audio_file_path TEXT");
    await addColumnIfNotExists(
      db,
      "transcriptions",
      "status TEXT NOT NULL DEFAULT 'success'",
    );

    await db.execute("BEGIN TRANSACTION;");
    try {
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);",
      );
      await db.execute("COMMIT;");
    } catch (migrationError) {
      await db.execute("ROLLBACK;");
      throw migrationError;
    }
  },
};
