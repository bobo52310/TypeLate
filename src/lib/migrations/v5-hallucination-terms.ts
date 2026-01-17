import type { Migration } from "./index";

export const v5HallucinationTerms: Migration = {
  version: 5,
  description: "Create hallucination_terms table",
  up: async (db) => {
    await db.execute("BEGIN TRANSACTION;");
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS hallucination_terms (
          id TEXT PRIMARY KEY,
          term TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL CHECK(source IN ('builtin', 'auto', 'manual')),
          locale TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_hallucination_terms_locale
        ON hallucination_terms(locale);
      `);
      await db.execute("COMMIT;");
    } catch (migrationError) {
      await db.execute("ROLLBACK;");
      throw migrationError;
    }
  },
};
