import {
  serializeVocabulary,
  parseVocabularyJson,
  computeImportDiff,
} from "@/lib/vocabularyFile";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { logInfo, logError } from "@/lib/logger";

export interface SyncDisplayInfo {
  label: string;
  detail: string;
}

export interface SyncProvider {
  id: "file" | "google-drive";
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
  isConfigured(): boolean;
  getDisplayInfo(): SyncDisplayInfo;
}

export interface SyncResult {
  added: number;
  updated: number;
}

/**
 * Provider-agnostic bidirectional sync.
 *
 * 1. Read remote vocabulary JSON from the provider
 * 2. Parse and compute diff against local terms
 * 3. Apply imports (new terms + higher weights)
 * 4. Re-fetch local terms and upload the merged result
 */
export async function performSync(provider: SyncProvider): Promise<SyncResult> {
  const tag = `sync:${provider.id}`;
  logInfo(tag, "Starting vocabulary sync...");

  const vocabularyStore = useVocabularyStore.getState();

  // Ensure local terms are fresh
  await vocabularyStore.fetchTermList();
  const localTerms = vocabularyStore.termList;

  let added = 0;
  let updated = 0;

  // 1. Download and merge remote → local
  const remoteContent = await provider.read();

  if (remoteContent) {
    const parseResult = parseVocabularyJson(remoteContent);

    if (parseResult.valid && parseResult.terms.length > 0) {
      const diff = computeImportDiff(parseResult.terms, localTerms);

      if (diff.toInsert.length > 0 || diff.toUpdate.length > 0) {
        await vocabularyStore.syncImportBatch(diff.toInsert, diff.toUpdate);
        added = diff.toInsert.length;
        updated = diff.toUpdate.length;
      }
    } else if (parseResult.errors.length > 0) {
      logError(tag, `Remote file parse errors: ${parseResult.errors.join(", ")}`);
    }
  }

  // 2. Re-fetch local (may have been updated by import) and upload merged result
  await vocabularyStore.fetchTermList();
  const mergedTerms = vocabularyStore.termList;
  const content = serializeVocabulary(mergedTerms);
  await provider.write(content);

  logInfo(tag, `Sync completed: ${added} added, ${updated} updated`);
  return { added, updated };
}
