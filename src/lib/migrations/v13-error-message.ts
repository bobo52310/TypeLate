import type { Migration } from "./index";

/**
 * v13: Add error_message column to transcriptions.
 *
 * Persists the technical reason a transcription failed (e.g. Groq API error
 * body, network error, parse error). Until now this string was only printed
 * to stdout via debug_log, leaving DB-only failure rows with no diagnostic
 * trail. Populated by the voice-flow pipeline's catch path; NULL on success.
 */
export const v13ErrorMessage: Migration = {
  version: 13,
  description: "Add error_message column to transcriptions",
  up: async (db) => {
    const columns = await db.select<{ name: string }[]>("PRAGMA table_info(transcriptions);");
    const alreadyExists = columns.some((c) => c.name === "error_message");
    if (alreadyExists) return;

    await db.execute("ALTER TABLE transcriptions ADD COLUMN error_message TEXT;");
  },
};
