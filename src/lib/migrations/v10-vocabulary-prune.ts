import type { Migration } from "./index";
import { addColumnIfNotExists } from "./utils";

export const v10VocabularyPrune: Migration = {
  version: 10,
  description: "Add last_used_at column to vocabulary for prune support",
  up: async (db) => {
    await addColumnIfNotExists(db, "vocabulary", "last_used_at TEXT");
  },
};
