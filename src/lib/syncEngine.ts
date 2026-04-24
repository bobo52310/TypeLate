import {
  serializeVocabulary,
  parseVocabularyJson,
  computeImportDiff,
} from "@/lib/vocabularyFile";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { logInfo, logError } from "@/lib/logger";
import type { SyncStrategy } from "@/lib/googleDriveSync";

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
 * Provider-agnostic sync with strategy support.
 *
 * Strategies:
 * - "merge" (default): bidirectional merge, higher weight wins
 * - "keep-local": ignore remote, upload local
 * - "keep-remote": replace local with remote data, skip upload
 */
export async function performSync(
  provider: SyncProvider,
  strategy: SyncStrategy = "merge",
): Promise<SyncResult> {
  const tag = `sync:${provider.id}`;
  logInfo(tag, `Starting vocabulary sync (strategy: ${strategy})...`);

  const vocabularyStore = useVocabularyStore.getState();

  // Ensure local terms are fresh
  await vocabularyStore.fetchTermList();
  const localTerms = vocabularyStore.termList;

  let added = 0;
  let updated = 0;

  if (strategy === "keep-local") {
    // Skip download, just upload local
    const content = serializeVocabulary(localTerms);
    await provider.write(content);
    logInfo(tag, `Sync completed (keep-local): uploaded ${localTerms.length} terms`);
    return { added: 0, updated: 0 };
  }

  // 1. Download remote
  const remoteContent = await provider.read();

  if (remoteContent) {
    const parseResult = parseVocabularyJson(remoteContent);

    if (parseResult.valid && parseResult.terms.length > 0) {
      if (strategy === "keep-remote") {
        // Replace all local with remote
        await vocabularyStore.replaceAllWithRemote(parseResult.terms);
        added = parseResult.terms.length;
      } else {
        // Merge: compute diff
        const diff = computeImportDiff(parseResult.terms, localTerms);
        if (diff.toInsert.length > 0 || diff.toUpdate.length > 0) {
          await vocabularyStore.syncImportBatch(diff.toInsert, diff.toUpdate);
          added = diff.toInsert.length;
          updated = diff.toUpdate.length;
        }
      }
    } else if (parseResult.errors.length > 0) {
      logError(tag, `Remote file parse errors: ${parseResult.errors.join(", ")}`);
    }
  }

  // 2. Re-fetch local and upload merged result (skip for keep-remote)
  if (strategy !== "keep-remote") {
    await vocabularyStore.fetchTermList();
    const mergedTerms = vocabularyStore.termList;
    const content = serializeVocabulary(mergedTerms);
    await provider.write(content);
  }

  logInfo(tag, `Sync completed: ${added} added, ${updated} updated`);
  return { added, updated };
}
