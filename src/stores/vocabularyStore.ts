import { create } from "zustand";
import { getDatabase } from "@/lib/database";
import { extractErrorMessage } from "@/lib/errorUtils";
import { logError } from "@/lib/logger";
import { captureError } from "@/lib/sentry";
import { emitEvent, VOCABULARY_CHANGED } from "@/hooks/useTauriEvent";
import type { VocabularyEntry, VocabularySource } from "@/types/vocabulary";
import type { VocabularyChangedPayload } from "@/types/events";
import i18n from "@/i18n";

interface RawVocabularyRow {
  id: string;
  term: string;
  weight: number;
  source: string;
  created_at: string;
}

function mapRowToEntry(row: RawVocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    weight: row.weight,
    source: row.source as VocabularySource,
    createdAt: row.created_at,
  };
}

interface VocabularyState {
  // -- State --
  termList: VocabularyEntry[];
  isLoading: boolean;

  // -- Derived getters --
  termCount: () => number;
  manualTermList: () => VocabularyEntry[];
  aiSuggestedTermList: () => VocabularyEntry[];

  // -- Actions --
  isDuplicateTerm: (term: string) => boolean;
  fetchTermList: () => Promise<void>;
  addTerm: (term: string) => Promise<void>;
  removeTerm: (id: string) => Promise<void>;
  addAiSuggestedTerm: (term: string) => Promise<void>;
  batchIncrementWeights: (termIdList: string[]) => Promise<void>;
  syncImportBatch: (
    toInsert: Array<{
      term: string;
      source: VocabularySource;
      weight: number;
      createdAt: string;
    }>,
    toUpdate: Array<{ id: string; weight: number }>,
  ) => Promise<void>;
  getTopTermListByWeight: (limit: number) => Promise<string[]>;
  batchAddTerms: (terms: string[]) => Promise<{ added: number; skipped: number }>;
}

export const useVocabularyStore = create<VocabularyState>()((set, get) => ({
  // -- State --
  termList: [],
  isLoading: false,

  // -- Derived getters --
  termCount: () => get().termList.length,

  manualTermList: () => get().termList.filter((entry) => entry.source === "manual"),

  aiSuggestedTermList: () => get().termList.filter((entry) => entry.source === "ai"),

  // -- Actions --
  isDuplicateTerm: (term: string) => {
    const normalizedInput = term.trim().toLowerCase();
    return get().termList.some((entry) => entry.term.trim().toLowerCase() === normalizedInput);
  },

  fetchTermList: async () => {
    set({ isLoading: true });
    try {
      const db = getDatabase();
      const rows = await db.select<RawVocabularyRow[]>(
        "SELECT id, term, weight, source, created_at FROM vocabulary ORDER BY weight DESC, created_at DESC",
      );
      set({ termList: rows.map(mapRowToEntry) });
    } catch (error) {
      logError("vocabulary", `fetchTermList failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "fetch" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  addTerm: async (term: string) => {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    if (get().isDuplicateTerm(trimmedTerm)) {
      throw new Error(i18n.t("dictionary.duplicateEntry"));
    }

    const id = crypto.randomUUID();
    try {
      const db = getDatabase();
      await db.execute("INSERT INTO vocabulary (id, term, source) VALUES ($1, $2, 'manual')", [
        id,
        trimmedTerm,
      ]);
      await get().fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      const message = extractErrorMessage(error);
      if (message.includes("UNIQUE")) {
        throw new Error(i18n.t("dictionary.duplicateEntry"));
      }
      logError("vocabulary", `addTerm failed: ${message}`);
      captureError(error, { source: "vocabulary", step: "add" });
      throw error;
    }
  },

  removeTerm: async (id: string) => {
    const entry = get().termList.find((e) => e.id === id);
    if (!entry) return;

    try {
      const db = getDatabase();
      await db.execute("DELETE FROM vocabulary WHERE id = $1", [id]);
      await get().fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "removed",
        term: entry.term,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      logError("vocabulary", `removeTerm failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "remove" });
      throw error;
    }
  },

  addAiSuggestedTerm: async (term: string) => {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    const id = crypto.randomUUID();
    try {
      const db = getDatabase();
      await db.execute("INSERT INTO vocabulary (id, term, source) VALUES ($1, $2, 'ai')", [
        id,
        trimmedTerm,
      ]);
      await get().fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      const message = extractErrorMessage(error);
      if (message.includes("UNIQUE")) {
        // Already exists -- silently ignore (caller will do weight +1)
        return;
      }
      logError("vocabulary", `addAiSuggestedTerm failed: ${message}`);
      captureError(error, { source: "vocabulary", step: "add-ai" });
      throw error;
    }
  },

  batchIncrementWeights: async (termIdList: string[]) => {
    if (termIdList.length === 0) return;
    try {
      const db = getDatabase();
      for (const id of termIdList) {
        await db.execute("UPDATE vocabulary SET weight = weight + 1 WHERE id = $1", [id]);
      }
      await get().fetchTermList();
    } catch (error) {
      logError("vocabulary", `batchIncrementWeights failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "increment-weights" });
      throw error;
    }
  },

  syncImportBatch: async (
    toInsert: Array<{
      term: string;
      source: VocabularySource;
      weight: number;
      createdAt: string;
    }>,
    toUpdate: Array<{ id: string; weight: number }>,
  ) => {
    try {
      const db = getDatabase();
      for (const entry of toInsert) {
        const id = crypto.randomUUID();
        await db.execute(
          "INSERT OR IGNORE INTO vocabulary (id, term, source, weight, created_at) VALUES ($1, $2, $3, $4, $5)",
          [id, entry.term.trim(), entry.source, entry.weight, entry.createdAt],
        );
      }
      for (const { id, weight } of toUpdate) {
        await db.execute("UPDATE vocabulary SET weight = $1 WHERE id = $2 AND weight < $1", [
          weight,
          id,
        ]);
      }
      await get().fetchTermList();
      if (toInsert.length > 0) {
        void emitEvent(VOCABULARY_CHANGED, {
          action: "added",
          term: `${toInsert.length} terms synced`,
        } satisfies VocabularyChangedPayload);
      }
    } catch (error) {
      logError("vocabulary", `syncImportBatch failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "sync-import" });
      throw error;
    }
  },

  batchAddTerms: async (terms: string[]) => {
    // Trim, filter empty, deduplicate input
    const uniqueTerms = [
      ...new Map(
        terms
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
          .map((t) => [t.toLowerCase(), t] as const),
      ).values(),
    ];

    if (uniqueTerms.length === 0) return { added: 0, skipped: 0 };

    let added = 0;
    let skipped = 0;

    try {
      const db = getDatabase();
      for (const term of uniqueTerms) {
        if (get().isDuplicateTerm(term)) {
          skipped++;
          continue;
        }
        const id = crypto.randomUUID();
        try {
          await db.execute("INSERT OR IGNORE INTO vocabulary (id, term, source) VALUES ($1, $2, 'manual')", [
            id,
            term,
          ]);
          added++;
        } catch {
          skipped++;
        }
      }
      await get().fetchTermList();
      if (added > 0) {
        void emitEvent(VOCABULARY_CHANGED, {
          action: "added",
          term: `${added} terms batch added`,
        } satisfies VocabularyChangedPayload);
      }
      return { added, skipped };
    } catch (error) {
      logError("vocabulary", `batchAddTerms failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "batch-add" });
      throw error;
    }
  },

  getTopTermListByWeight: async (limit: number) => {
    try {
      const db = getDatabase();
      const rows = await db.select<{ term: string }[]>(
        "SELECT term FROM vocabulary ORDER BY weight DESC, created_at DESC LIMIT $1",
        [limit],
      );
      return rows.map((row) => row.term);
    } catch (error) {
      logError("vocabulary", `getTopTermListByWeight failed: ${extractErrorMessage(error)}`);
      captureError(error, { source: "vocabulary", step: "top-by-weight" });
      return [];
    }
  },
}));
