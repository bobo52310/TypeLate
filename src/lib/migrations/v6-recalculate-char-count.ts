import type { Migration } from "./index";

export const v6RecalculateCharCount: Migration = {
  version: 6,
  description: "Recalculate char_count from raw_text",
  up: async (db) => {
    await db.execute("BEGIN TRANSACTION;");
    try {
      await db.execute(`
        UPDATE transcriptions
        SET char_count = LENGTH(raw_text)
        WHERE processed_text IS NOT NULL
          AND char_count != LENGTH(raw_text);
      `);
      await db.execute("COMMIT;");
    } catch (migrationError) {
      await db.execute("ROLLBACK;");
      throw migrationError;
    }
  },
};
