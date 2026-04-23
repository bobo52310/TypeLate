import { describe, expect, it } from "vitest";
import {
  PROVIDER_LIST,
  DEFAULT_TRANSCRIPTION_PROVIDER_ID,
  DEFAULT_LLM_PROVIDER_ID,
  getProviderConfig,
  getTranscriptionProviders,
  getLlmProviders,
  isValidLlmProviderId,
  isValidTranscriptionProviderId,
} from "@/lib/providerConfig";
import { getDefaultLlmModelForProvider } from "@/lib/modelRegistry";

describe("providerConfig — provider lists", () => {
  it("PROVIDER_LIST includes all 5 providers", () => {
    const ids = PROVIDER_LIST.map((p) => p.id).sort();
    expect(ids).toEqual(["gemini", "groq", "nvidia", "openai", "openrouter"]);
  });

  it("getLlmProviders() returns all 5 providers", () => {
    expect(getLlmProviders()).toHaveLength(5);
  });

  it("getTranscriptionProviders() returns only providers with a Whisper endpoint", () => {
    const providers = getTranscriptionProviders();
    expect(providers.map((p) => p.id).sort()).toEqual(["groq", "openai"]);
    for (const p of providers) {
      expect(p.transcriptionBaseUrl).toBeTruthy();
    }
  });
});

describe("providerConfig — validators", () => {
  it("isValidTranscriptionProviderId rejects LLM-only providers", () => {
    expect(isValidTranscriptionProviderId("gemini")).toBe(false);
    expect(isValidTranscriptionProviderId("openrouter")).toBe(false);
    expect(isValidTranscriptionProviderId("nvidia")).toBe(false);
  });

  it("isValidTranscriptionProviderId accepts Groq and OpenAI", () => {
    expect(isValidTranscriptionProviderId("groq")).toBe(true);
    expect(isValidTranscriptionProviderId("openai")).toBe(true);
  });

  it("isValidLlmProviderId accepts all 5 providers", () => {
    for (const id of ["groq", "openai", "gemini", "openrouter", "nvidia"] as const) {
      expect(isValidLlmProviderId(id)).toBe(true);
    }
  });

  it("isValidLlmProviderId rejects unknown ids", () => {
    expect(isValidLlmProviderId("anthropic")).toBe(false);
    expect(isValidLlmProviderId("")).toBe(false);
  });
});

describe("providerConfig — per-provider config", () => {
  it("every LLM provider has a chat URL and key store key", () => {
    for (const provider of PROVIDER_LIST) {
      expect(provider.chatBaseUrl).toMatch(/^https?:\/\//);
      expect(provider.keyStoreKey).toBeTruthy();
    }
  });

  it("every provider has a curated default LLM model", () => {
    for (const provider of PROVIDER_LIST) {
      const defaultId = getDefaultLlmModelForProvider(provider.id);
      expect(defaultId).toBeTruthy();
    }
  });

  it("Gemini uses the OpenAI-compatible chat endpoint", () => {
    const gemini = getProviderConfig("gemini");
    expect(gemini.chatBaseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(gemini.transcriptionBaseUrl).toBeNull();
  });

  it("OpenRouter ships attribution headers per TOS", () => {
    const openrouter = getProviderConfig("openrouter");
    expect(openrouter.extraHeaders).toBeDefined();
    expect(openrouter.extraHeaders?.["HTTP-Referer"]).toBeTruthy();
    expect(openrouter.extraHeaders?.["X-Title"]).toBeTruthy();
  });

  it("NVIDIA uses the OpenAI-compatible chat endpoint", () => {
    const nvidia = getProviderConfig("nvidia");
    expect(nvidia.chatBaseUrl).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(nvidia.transcriptionBaseUrl).toBeNull();
  });
});

describe("providerConfig — defaults", () => {
  it("default transcription provider is Whisper-capable", () => {
    expect(isValidTranscriptionProviderId(DEFAULT_TRANSCRIPTION_PROVIDER_ID)).toBe(true);
  });

  it("default LLM provider is valid", () => {
    expect(isValidLlmProviderId(DEFAULT_LLM_PROVIDER_ID)).toBe(true);
  });
});
