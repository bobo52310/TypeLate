import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { performSync } from "@/lib/syncEngine";
import type { SyncResult } from "@/lib/syncEngine";
import { createFileSyncProvider, pickSyncFolder } from "@/lib/fileSyncProvider";
import {
  startOAuthFlow,
  getStoredTokens,
  revokeTokens,
  getValidAccessToken,
} from "@/lib/googleAuth";
import {
  syncVocabulary,
  uploadVocabulary,
  checkGoogleDriveConflict,
} from "@/lib/googleDriveSync";
import type { SyncStrategy, SyncConflictInfo } from "@/lib/googleDriveSync";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { extractErrorMessage } from "@/lib/errorUtils";
import { logInfo, logError } from "@/lib/logger";
import { captureError } from "@/lib/sentry";
import { VOCABULARY_CHANGED } from "@/hooks/useTauriEvent";

const STORE_NAME = "settings.json";
const PROVIDER_TYPE_KEY = "syncProviderType";
const SYNC_FOLDER_KEY = "syncFolderPath";
const CLIENT_ID_KEY = "googleOAuthClientId";
const LAST_SYNC_KEY = "googleDriveLastSyncAt";

type ProviderType = "file" | "google-drive";

interface SyncState {
  // -- State --
  providerType: ProviderType | null;
  isConnected: boolean;
  lastSyncAt: string | null;
  isSyncing: boolean;
  syncError: string | null;
  lastSyncResult: SyncResult | null;

  // File sync specific
  syncFolderPath: string | null;

  // Google Drive specific (backward compat)
  clientId: string;
  userEmail: string | null;

  // -- Actions --
  loadSyncStatus: () => Promise<void>;
  setupFileSync: () => Promise<void>;
  changeSyncFolder: () => Promise<void>;
  saveClientId: (clientId: string) => Promise<void>;
  setupGoogleDrive: () => Promise<void>;
  disconnect: () => Promise<void>;
  checkConflict: () => Promise<SyncConflictInfo | null>;
  syncNow: (strategy?: SyncStrategy) => Promise<SyncResult>;
  initAutoSync: () => () => void;
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  // -- State --
  providerType: null,
  isConnected: false,
  lastSyncAt: null,
  isSyncing: false,
  syncError: null,
  lastSyncResult: null,
  syncFolderPath: null,
  clientId: "",
  userEmail: null,

  // -- Actions --

  loadSyncStatus: async () => {
    try {
      const store = await load(STORE_NAME);
      const savedProviderType = await store.get<ProviderType>(PROVIDER_TYPE_KEY);
      const savedFolderPath = await store.get<string>(SYNC_FOLDER_KEY);
      const savedClientId = await store.get<string>(CLIENT_ID_KEY);
      const savedLastSync = await store.get<string>(LAST_SYNC_KEY);

      // Check Google Drive tokens for backward compatibility
      const tokens = await getStoredTokens();

      if (savedProviderType === "file" && savedFolderPath) {
        set({
          providerType: "file",
          isConnected: true,
          syncFolderPath: savedFolderPath,
          lastSyncAt: savedLastSync ?? null,
          clientId: savedClientId ?? "",
        });
      } else if (savedProviderType === "google-drive" && tokens) {
        set({
          providerType: "google-drive",
          isConnected: true,
          userEmail: tokens.userEmail,
          lastSyncAt: savedLastSync ?? null,
          clientId: savedClientId ?? "",
        });
      } else if (!savedProviderType && tokens) {
        // Backward compat: existing Google Drive user without providerType
        set({
          providerType: "google-drive",
          isConnected: true,
          userEmail: tokens.userEmail,
          lastSyncAt: savedLastSync ?? null,
          clientId: savedClientId ?? "",
        });
        // Persist the providerType for next time
        await store.set(PROVIDER_TYPE_KEY, "google-drive");
        await store.save();
      } else {
        set({
          providerType: null,
          isConnected: false,
          clientId: savedClientId ?? "",
        });
      }
    } catch (error) {
      logError("sync", `Failed to load sync status: ${extractErrorMessage(error)}`);
    }
  },

  setupFileSync: async () => {
    const folderPath = await pickSyncFolder();
    if (!folderPath) return; // User cancelled

    try {
      set({ syncError: null });

      const store = await load(STORE_NAME);
      await store.set(PROVIDER_TYPE_KEY, "file");
      await store.set(SYNC_FOLDER_KEY, folderPath);
      await store.save();

      set({
        providerType: "file",
        isConnected: true,
        syncFolderPath: folderPath,
      });

      logInfo("sync", `File sync configured: ${folderPath}`);

      // Perform initial sync
      await get().syncNow();
    } catch (error) {
      const message = extractErrorMessage(error);
      set({ syncError: message });
      logError("sync", `File sync setup failed: ${message}`);
      captureError(error, { source: "sync", step: "setupFileSync" });
      throw error;
    }
  },

  changeSyncFolder: async () => {
    const folderPath = await pickSyncFolder();
    if (!folderPath) return;

    try {
      const store = await load(STORE_NAME);
      await store.set(SYNC_FOLDER_KEY, folderPath);
      await store.save();

      set({ syncFolderPath: folderPath, syncError: null });
      logInfo("sync", `Sync folder changed: ${folderPath}`);

      // Sync to new folder
      await get().syncNow();
    } catch (error) {
      const message = extractErrorMessage(error);
      set({ syncError: message });
      logError("sync", `Change folder failed: ${message}`);
      throw error;
    }
  },

  saveClientId: async (clientId: string) => {
    try {
      const store = await load(STORE_NAME);
      await store.set(CLIENT_ID_KEY, clientId.trim());
      await store.save();
      set({ clientId: clientId.trim() });
    } catch (error) {
      logError("sync", `Failed to save client ID: ${extractErrorMessage(error)}`);
      throw error;
    }
  },

  setupGoogleDrive: async () => {
    const { clientId } = get();
    if (!clientId.trim()) throw new Error("Please enter your Google OAuth Client ID first");

    try {
      set({ syncError: null });
      const tokens = await startOAuthFlow(clientId);

      const store = await load(STORE_NAME);
      await store.set(PROVIDER_TYPE_KEY, "google-drive");
      await store.save();

      set({
        providerType: "google-drive",
        isConnected: true,
        userEmail: tokens.userEmail,
      });

      logInfo("sync", `Google Drive connected as ${tokens.userEmail}`);
    } catch (error) {
      const message = extractErrorMessage(error);
      set({ syncError: message });
      logError("sync", `Google Drive OAuth failed: ${message}`);
      captureError(error, { source: "sync", step: "setupGoogleDrive" });
      throw error;
    }
  },

  disconnect: async () => {
    const { providerType } = get();

    try {
      if (providerType === "google-drive") {
        await revokeTokens();
      }

      const store = await load(STORE_NAME);
      await store.delete(PROVIDER_TYPE_KEY);
      await store.delete(SYNC_FOLDER_KEY);
      await store.delete(LAST_SYNC_KEY);
      await store.save();

      set({
        providerType: null,
        isConnected: false,
        syncFolderPath: null,
        userEmail: null,
        syncError: null,
        lastSyncAt: null,
        lastSyncResult: null,
      });
    } catch (error) {
      logError("sync", `Disconnect failed: ${extractErrorMessage(error)}`);
      // Still clear local state
      set({
        providerType: null,
        isConnected: false,
        syncFolderPath: null,
        userEmail: null,
      });
    }
  },

  checkConflict: async () => {
    const { providerType, clientId } = get();

    if (providerType === "google-drive" && clientId) {
      const vocabularyStore = useVocabularyStore.getState();
      await vocabularyStore.fetchTermList();
      const localCount = vocabularyStore.termList.length;

      return await checkGoogleDriveConflict(clientId, localCount);
    }

    // File sync: check if remote file has data and local has data
    if (providerType === "file") {
      const { syncFolderPath } = get();
      if (!syncFolderPath) return null;

      const vocabularyStore = useVocabularyStore.getState();
      await vocabularyStore.fetchTermList();
      const localCount = vocabularyStore.termList.length;
      if (localCount === 0) return null;

      const provider = createFileSyncProvider(syncFolderPath);
      const remoteContent = await provider.read();
      if (!remoteContent) return null;

      const { parseVocabularyJson } = await import("@/lib/vocabularyFile");
      const parseResult = parseVocabularyJson(remoteContent);
      if (!parseResult.valid || parseResult.terms.length === 0) return null;

      return { localCount, remoteCount: parseResult.terms.length };
    }

    return null;
  },

  syncNow: async (strategy: SyncStrategy = "merge") => {
    const { providerType, syncFolderPath, clientId } = get();
    if (!providerType) throw new Error("No sync provider configured");

    set({ isSyncing: true, syncError: null });

    try {
      let result: SyncResult;

      if (providerType === "file" && syncFolderPath) {
        const provider = createFileSyncProvider(syncFolderPath);
        result = await performSync(provider, strategy);
      } else if (providerType === "google-drive" && clientId) {
        // Use the existing Google Drive sync flow (which has its own read/merge logic)
        await getValidAccessToken(clientId);

        const vocabularyStore = useVocabularyStore.getState();
        await vocabularyStore.fetchTermList();
        const localTerms = vocabularyStore.termList;

        const syncResult = await syncVocabulary(
          clientId,
          localTerms,
          async (toInsert, toUpdate) => {
            await vocabularyStore.syncImportBatch(toInsert, toUpdate);
          },
          async (remoteTerms) => {
            await vocabularyStore.replaceAllWithRemote(remoteTerms);
          },
          strategy,
        );

        // Re-fetch and upload merged result (skip upload for keep-remote)
        await vocabularyStore.fetchTermList();
        if (strategy !== "keep-remote") {
          await uploadVocabulary(clientId, vocabularyStore.termList);
        }

        result = { added: syncResult.added, updated: syncResult.updated };
      } else {
        throw new Error("Sync provider not properly configured");
      }

      // Save last sync time
      const now = new Date().toISOString();
      const store = await load(STORE_NAME);
      await store.set(LAST_SYNC_KEY, now);
      await store.save();

      set({
        lastSyncAt: now,
        isSyncing: false,
        lastSyncResult: result,
      });

      logInfo("sync", `Sync completed: ${result.added} added, ${result.updated} updated`);
      return result;
    } catch (error) {
      const message = extractErrorMessage(error);
      const isAuthExpired = message === "AUTH_EXPIRED";

      set({
        isSyncing: false,
        syncError: message,
        ...(isAuthExpired ? { isConnected: false, userEmail: null, providerType: null } : {}),
      });

      logError("sync", `Sync failed: ${message}`);
      captureError(error, { source: "sync", step: "syncNow" });
      throw error;
    }
  },

  /**
   * Initialize auto-sync: listen for vocabulary changes and debounce sync.
   * Returns a cleanup function to stop listening.
   */
  initAutoSync: () => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: UnlistenFn | undefined;

    listen(VOCABULARY_CHANGED, () => {
      const { isConnected, isSyncing } = get();
      if (!isConnected || isSyncing) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void get().syncNow().catch((err) => {
          logError("sync", `Auto-sync failed: ${extractErrorMessage(err)}`);
        });
      }, 3000);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten?.();
    };
  },
}));
