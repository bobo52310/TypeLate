import type { Migration } from "./index";

/**
 * v11: Add prompt_mode column to transcriptions.
 *
 * Records the AI enhancement mode used for each transcription
 * (none / minimal / active / custom). Existing rows are left NULL since
 * historical mode is unknown.
 */
export const v11PromptMode: Migration = {
  version: 11,
  description: "Add prompt_mode column to transcriptions",
  up: async (db) => {
    const columns = await db.select<{ name: string }[]>("PRAGMA table_info(transcriptions);");
    const alreadyExists = columns.some((c) => c.name === "prompt_mode");
    if (alreadyExists) return;

    await db.execute("ALTER TABLE transcriptions ADD COLUMN prompt_mode TEXT;");
  },
};
