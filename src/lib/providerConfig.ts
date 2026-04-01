// ── AI Provider Configuration ────────────────────────────────

export type ProviderId = "groq" | "openai";

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  consoleUrl: string;
  /** Key prefix for validation (e.g. "gsk_"). null = no prefix check. */
  keyPrefix: string | null;
  keyPlaceholder: string;
  /** Key name in Tauri persistent store */
  keyStoreKey: string;
  transcriptionBaseUrl: string;
  chatBaseUrl: string;
  /** i18n key for free quota description, null if paid-only */
  freeQuotaDescriptionKey: string | null;
}

export const PROVIDER_LIST: ProviderConfig[] = [
  {
    id: "groq",
    displayName: "Groq",
    consoleUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
    keyPlaceholder: "gsk_...",
    keyStoreKey: "groqApiKey",
    transcriptionBaseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
    chatBaseUrl: "https://api.groq.com/openai/v1/chat/completions",
    freeQuotaDescriptionKey: "settings.provider.groqFreeQuota",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    consoleUrl: "https://platform.openai.com/api-keys",
    keyPrefix: null,
    keyPlaceholder: "sk-...",
    keyStoreKey: "openaiApiKey",
    transcriptionBaseUrl: "https://api.openai.com/v1/audio/transcriptions",
    chatBaseUrl: "https://api.openai.com/v1/chat/completions",
    freeQuotaDescriptionKey: null,
  },
];

export const DEFAULT_PROVIDER_ID: ProviderId = "groq";

export function getProviderConfig(id: ProviderId): ProviderConfig {
  const config = PROVIDER_LIST.find((p) => p.id === id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  return config;
}

export function isValidProviderId(id: string): id is ProviderId {
  return PROVIDER_LIST.some((p) => p.id === id);
}
