import type { Migration } from "./index";

export const v8ModelTracking: Migration = {
  version: 8,
  description: "Add whisper_model_id and llm_model_id to transcriptions",
  up: async (db) => {
    await db.execute(
      "ALTER TABLE transcriptions ADD COLUMN whisper_model_id TEXT;",
    );
    await db.execute(
      "ALTER TABLE transcriptions ADD COLUMN llm_model_id TEXT;",
    );
  },
};
