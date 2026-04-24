import { fetch } from "@tauri-apps/plugin-http";
import { getValidAccessToken } from "@/lib/googleAuth";
import {
  serializeVocabulary,
  parseVocabularyJson,
  computeImportDiff,
} from "@/lib/vocabularyFile";
import type { VocabularyEntry } from "@/types/vocabulary";
import { logInfo, logError } from "@/lib/logger";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const VOCAB_FILENAME = "typelate-vocabulary.json";

interface DriveFile {
  id: string;
  name: string;
}

/**
 * Find the vocabulary file in appDataFolder.
 */
async function findVocabularyFile(accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${VOCAB_FILENAME}' and trashed = false`,
    fields: "files(id,name)",
  });

  const response = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Drive API search failed: ${response.status}`);
  }

  const data = (await response.json()) as { files?: DriveFile[] };
  const files = data.files ?? [];
  const first = files[0];
  return first ? first.id : null;
}

/**
 * Download vocabulary JSON from Google Drive.
 */
async function downloadVocabularyFile(
  accessToken: string,
  fileId: string,
): Promise<string> {
  const response = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Drive API download failed: ${response.status}`);
  }

  return await response.text();
}

/**
 * Create a new vocabulary file in appDataFolder.
 */
async function createVocabularyFile(
  accessToken: string,
  content: string,
): Promise<string> {
  // Use multipart upload to set metadata + content in one request
  const metadata = {
    name: VOCAB_FILENAME,
    parents: ["appDataFolder"],
  };

  const boundary = "typelate_boundary_" + Date.now();
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    content +
    `\r\n--${boundary}--`;

  const response = await fetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(`Drive API create failed: ${response.status}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Update an existing vocabulary file on Google Drive.
 */
async function updateVocabularyFile(
  accessToken: string,
  fileId: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: content,
    },
  );

  if (!response.ok) {
    throw new Error(`Drive API update failed: ${response.status}`);
  }
}

export type SyncStrategy = "merge" | "keep-local" | "keep-remote";

export interface SyncConflictInfo {
  localCount: number;
  remoteCount: number;
}

export interface SyncResult {
  added: number;
  updated: number;
  uploaded: boolean;
}

/**
 * Check whether both local and remote have vocabulary data (potential conflict).
 * Returns null if no conflict (remote empty or doesn't exist).
 */
export async function checkGoogleDriveConflict(
  clientId: string,
  localCount: number,
): Promise<SyncConflictInfo | null> {
  if (localCount === 0) return null;

  const accessToken = await getValidAccessToken(clientId);
  const fileId = await findVocabularyFile(accessToken);
  if (!fileId) return null;

  const remoteContent = await downloadVocabularyFile(accessToken, fileId);
  const parseResult = parseVocabularyJson(remoteContent);

  if (!parseResult.valid || parseResult.terms.length === 0) return null;

  return { localCount, remoteCount: parseResult.terms.length };
}

/**
 * Perform sync between local vocabulary and Google Drive.
 *
 * Strategies:
 * - "merge" (default): bidirectional merge, higher weight wins
 * - "keep-local": ignore remote, upload local
 * - "keep-remote": replace local with remote data
 *
 * Returns the operations performed.
 */
export async function syncVocabulary(
  clientId: string,
  localTermList: VocabularyEntry[],
  applyImport: (
    toInsert: Array<{ term: string; source: "manual" | "ai"; weight: number; createdAt: string }>,
    toUpdate: Array<{ id: string; weight: number }>,
  ) => Promise<void>,
  replaceLocalWithRemote?: (
    remoteTerms: Array<{ term: string; source: "manual" | "ai"; weight: number; createdAt: string }>,
  ) => Promise<void>,
  strategy: SyncStrategy = "merge",
): Promise<SyncResult> {
  logInfo("googleDriveSync", `Starting vocabulary sync (strategy: ${strategy})...`);

  const accessToken = await getValidAccessToken(clientId);

  // keep-local: skip download, just signal caller to upload
  if (strategy === "keep-local") {
    return { added: 0, updated: 0, uploaded: false };
  }

  // 1. Find existing file on Drive
  const fileId = await findVocabularyFile(accessToken);

  let added = 0;
  let updated = 0;

  if (fileId) {
    // 2. Download and parse remote data
    const remoteContent = await downloadVocabularyFile(accessToken, fileId);
    const parseResult = parseVocabularyJson(remoteContent);

    if (parseResult.valid && parseResult.terms.length > 0) {
      if (strategy === "keep-remote" && replaceLocalWithRemote) {
        // Replace all local with remote
        await replaceLocalWithRemote(parseResult.terms);
        added = parseResult.terms.length;
      } else {
        // Merge: compute what remote has that local doesn't (or has higher weight)
        const diff = computeImportDiff(parseResult.terms, localTermList);

        if (diff.toInsert.length > 0 || diff.toUpdate.length > 0) {
          await applyImport(diff.toInsert, diff.toUpdate);
          added = diff.toInsert.length;
          updated = diff.toUpdate.length;
        }
      }
    } else if (parseResult.errors.length > 0) {
      logError("googleDriveSync", `Remote file parse errors: ${parseResult.errors.join(", ")}`);
    }
  }

  return { added, updated, uploaded: false };
}

/**
 * Upload local vocabulary to Google Drive (called after merge)
 */
export async function uploadVocabulary(
  clientId: string,
  termList: VocabularyEntry[],
): Promise<void> {
  const accessToken = await getValidAccessToken(clientId);
  const content = serializeVocabulary(termList);

  const fileId = await findVocabularyFile(accessToken);

  if (fileId) {
    await updateVocabularyFile(accessToken, fileId, content);
  } else {
    await createVocabularyFile(accessToken, content);
  }

  logInfo("googleDriveSync", `Uploaded ${termList.length} terms to Drive`);
}
