import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import {
  startOAuthFlow,
  getStoredTokens,
  revokeTokens,
  getValidAccessToken,
} from "@/lib/googleAuth";
import { syncVocabulary, uploadVocabulary } from "@/lib/googleDriveSync";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { extractErrorMessage } from "@/lib/errorUtils";
import { logInfo, logError } from "@/lib/logger";
import { captureError } from "@/lib/sentry";

const STORE_NAME = "settings.json";
const CLIENT_ID_KEY = "googleOAuthClientId";
const LAST_SYNC_KEY = "googleDriveLastSyncAt";

interface GoogleDriveState {
  // -- State --
  isConnected: boolean;
  userEmail: string | null;
  lastSyncAt: string | null;
  isSyncing: boolean;
  syncError: string | null;
  clientId: string;

  // -- Actions --
  loadConnectionStatus: () => Promise<void>;
  saveClientId: (clientId: string) => Promise<void>;
  startOAuthFlow: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<{ added: number; updated: number }>;
}

export const useGoogleDriveStore = create<GoogleDriveState>()((set, get) => ({
  // -- State --
  isConnected: false,
  userEmail: null,
  lastSyncAt: null,
  isSyncing: false,
  syncError: null,
  clientId: "",

  // -- Actions --
  loadConnectionStatus: async () => {
    try {
      const store = await load(STORE_NAME);
      const savedClientId = await store.get<string>(CLIENT_ID_KEY);
      const savedLastSync = await store.get<string>(LAST_SYNC_KEY);

      const tokens = await getStoredTokens();
      set({
        isConnected: tokens !== null,
        userEmail: tokens?.userEmail ?? null,
        lastSyncAt: savedLastSync ?? null,
        clientId: savedClientId ?? "",
      });
    } catch (error) {
      logError("googleDrive", `Failed to load connection status: ${extractErrorMessage(error)}`);
    }
  },

  saveClientId: async (clientId: string) => {
    try {
      const store = await load(STORE_NAME);
      await store.set(CLIENT_ID_KEY, clientId.trim());
      await store.save();
      set({ clientId: clientId.trim() });
    } catch (error) {
      logError("googleDrive", `Failed to save client ID: ${extractErrorMessage(error)}`);
      throw error;
    }
  },

  startOAuthFlow: async () => {
    const { clientId } = get();
    if (!clientId.trim()) throw new Error("Please enter your Google OAuth Client ID first");

    try {
      set({ syncError: null });
      const tokens = await startOAuthFlow(clientId);
      set({
        isConnected: true,
        userEmail: tokens.userEmail,
      });
      logInfo("googleDrive", `Connected as ${tokens.userEmail}`);
    } catch (error) {
      const message = extractErrorMessage(error);
      set({ syncError: message });
      logError("googleDrive", `OAuth flow failed: ${message}`);
      captureError(error, { source: "googleDrive", step: "oauth" });
      throw error;
    }
  },

  disconnect: async () => {
    try {
      await revokeTokens();
      set({
        isConnected: false,
        userEmail: null,
        syncError: null,
      });
    } catch (error) {
      logError("googleDrive", `Disconnect failed: ${extractErrorMessage(error)}`);
      // Still clear local state even if revocation fails
      set({ isConnected: false, userEmail: null });
    }
  },

  syncNow: async () => {
    const { clientId } = get();
    if (!clientId.trim()) throw new Error("OAuth Client ID not configured");

    set({ isSyncing: true, syncError: null });

    try {
      // Verify token is still valid
      await getValidAccessToken(clientId);

      const vocabularyStore = useVocabularyStore.getState();
      await vocabularyStore.fetchTermList();
      const localTerms = vocabularyStore.termList;

      // Sync: download remote → merge into local
      const result = await syncVocabulary(
        clientId,
        localTerms,
        async (toInsert, toUpdate) => {
          await vocabularyStore.syncImportBatch(toInsert, toUpdate);
        },
      );

      // Re-fetch local terms (may have been updated by import)
      await vocabularyStore.fetchTermList();
      const updatedTerms = vocabularyStore.termList;

      // Upload merged result to Drive
      await uploadVocabulary(clientId, updatedTerms);

      // Save last sync time
      const now = new Date().toISOString();
      const store = await load(STORE_NAME);
      await store.set(LAST_SYNC_KEY, now);
      await store.save();

      set({ lastSyncAt: now, isSyncing: false });
      logInfo("googleDrive", `Sync completed: ${result.added} added, ${result.updated} updated`);

      return { added: result.added, updated: result.updated };
    } catch (error) {
      const message = extractErrorMessage(error);
      const isAuthExpired = message === "AUTH_EXPIRED";

      set({
        isSyncing: false,
        syncError: message,
        ...(isAuthExpired ? { isConnected: false, userEmail: null } : {}),
      });

      logError("googleDrive", `Sync failed: ${message}`);
      captureError(error, { source: "googleDrive", step: "sync" });
      throw error;
    }
  },
}));
