// ── AI Provider Configuration ────────────────────────────────

/** Providers that support OpenAI-compatible Whisper transcription. */
export type TranscriptionProviderId = "groq" | "openai";

/** All providers that support OpenAI-compatible chat completions. */
export type LlmProviderId = "groq" | "openai" | "gemini" | "openrouter" | "nvidia";

/** Legacy alias — equivalent to `LlmProviderId`. Prefer the narrower id types above. */
export type ProviderId = LlmProviderId;

export interface ProviderConfig {
  id: LlmProviderId;
  displayName: string;
  consoleUrl: string;
  /** Key prefix for validation (e.g. "gsk_"). null = no prefix check. */
  keyPrefix: string | null;
  keyPlaceholder: string;
  /** Key name in Tauri persistent store */
  keyStoreKey: string;
  /** null ⇒ provider is LLM-only (no Whisper transcription endpoint) */
  transcriptionBaseUrl: string | null;
  chatBaseUrl: string;
  /** Extra headers to merge into chat requests (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>;
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
  {
    id: "gemini",
    displayName: "Gemini",
    consoleUrl: "https://aistudio.google.com/apikey",
    keyPrefix: "AIza",
    keyPlaceholder: "AIza...",
    keyStoreKey: "geminiApiKey",
    transcriptionBaseUrl: null,
    chatBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    freeQuotaDescriptionKey: "settings.provider.geminiFreeQuota",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    consoleUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    keyPlaceholder: "sk-or-v1-...",
    keyStoreKey: "openrouterApiKey",
    transcriptionBaseUrl: null,
    chatBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: {
      "HTTP-Referer": "https://typelate.app",
      "X-Title": "TypeLate",
    },
    freeQuotaDescriptionKey: "settings.provider.openrouterFreeQuota",
  },
  {
    id: "nvidia",
    displayName: "NVIDIA NIM",
    consoleUrl: "https://build.nvidia.com/settings/api-keys",
    keyPrefix: "nvapi-",
    keyPlaceholder: "nvapi-...",
    keyStoreKey: "nvidiaApiKey",
    transcriptionBaseUrl: null,
    chatBaseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    freeQuotaDescriptionKey: "settings.provider.nvidiaFreeQuota",
  },
];

export const DEFAULT_PROVIDER_ID: ProviderId = "groq";
export const DEFAULT_TRANSCRIPTION_PROVIDER_ID: TranscriptionProviderId = "groq";
export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq";

export function getProviderConfig(id: LlmProviderId): ProviderConfig {
  const config = PROVIDER_LIST.find((p) => p.id === id);
  if (!config) throw new Error(`Unknown provider: ${id}`);
  return config;
}

export function isValidProviderId(id: string): id is LlmProviderId {
  return PROVIDER_LIST.some((p) => p.id === id);
}

export function isValidLlmProviderId(id: string): id is LlmProviderId {
  return PROVIDER_LIST.some((p) => p.id === id);
}

export function isValidTranscriptionProviderId(id: string): id is TranscriptionProviderId {
  return PROVIDER_LIST.some((p) => p.id === id && p.transcriptionBaseUrl !== null);
}

export function getTranscriptionProviders(): ProviderConfig[] {
  return PROVIDER_LIST.filter((p) => p.transcriptionBaseUrl !== null);
}

export function getLlmProviders(): ProviderConfig[] {
  return PROVIDER_LIST;
}
