import type { Migration } from "./index";

export const v7RemoveHallucinationTerms: Migration = {
  version: 7,
  description: "Remove hallucination_terms table",
  up: async (db) => {
    await db.execute("BEGIN TRANSACTION;");
    try {
      await db.execute("DROP TABLE IF EXISTS hallucination_terms;");
      await db.execute("COMMIT;");
    } catch (migrationError) {
      await db.execute("ROLLBACK;");
      throw migrationError;
    }
  },
};
