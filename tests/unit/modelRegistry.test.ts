import { describe, expect, it } from "vitest";
import {
  findLlmModelConfig,
  findWhisperModelConfig,
  findVocabularyAnalysisModelConfig,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  getEffectiveVocabularyAnalysisModelId,
  getDefaultLlmModelForProvider,
  getLlmModelsForProvider,
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID,
  LLM_MODEL_LIST,
  WHISPER_MODEL_LIST,
  VOCABULARY_ANALYSIS_MODEL_LIST,
} from "@/lib/modelRegistry";

describe("findLlmModelConfig", () => {
  it("finds a valid model", () => {
    const config = findLlmModelConfig(DEFAULT_LLM_MODEL_ID);
    expect(config).toBeDefined();
    expect(config?.id).toBe(DEFAULT_LLM_MODEL_ID);
  });

  it("returns undefined for unknown model", () => {
    expect(findLlmModelConfig("nonexistent-model")).toBeUndefined();
  });
});

describe("findWhisperModelConfig", () => {
  it("finds a valid model", () => {
    const config = findWhisperModelConfig(DEFAULT_WHISPER_MODEL_ID);
    expect(config).toBeDefined();
    expect(config?.id).toBe(DEFAULT_WHISPER_MODEL_ID);
  });

  it("returns undefined for unknown model", () => {
    expect(findWhisperModelConfig("nonexistent-model")).toBeUndefined();
  });
});

describe("findVocabularyAnalysisModelConfig", () => {
  it("finds a valid model", () => {
    const config = findVocabularyAnalysisModelConfig(DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID);
    expect(config).toBeDefined();
    expect(config?.id).toBe(DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID);
  });
});

describe("getEffectiveLlmModelId", () => {
  it("returns saved ID when valid", () => {
    expect(getEffectiveLlmModelId(DEFAULT_LLM_MODEL_ID)).toBe(DEFAULT_LLM_MODEL_ID);
  });

  it("returns default for null", () => {
    expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
  });

  it("returns default for unknown model", () => {
    expect(getEffectiveLlmModelId("unknown-model")).toBe(DEFAULT_LLM_MODEL_ID);
  });
});

describe("getEffectiveWhisperModelId", () => {
  it("returns saved ID when valid", () => {
    expect(getEffectiveWhisperModelId(DEFAULT_WHISPER_MODEL_ID)).toBe(DEFAULT_WHISPER_MODEL_ID);
  });

  it("returns default for null", () => {
    expect(getEffectiveWhisperModelId(null)).toBe(DEFAULT_WHISPER_MODEL_ID);
  });
});

describe("getEffectiveVocabularyAnalysisModelId", () => {
  it("returns saved ID when valid", () => {
    expect(getEffectiveVocabularyAnalysisModelId(DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID)).toBe(
      DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID,
    );
  });

  it("returns default for null", () => {
    expect(getEffectiveVocabularyAnalysisModelId(null)).toBe(DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID);
  });
});

describe("model lists", () => {
  it("LLM model list has at least one default", () => {
    expect(LLM_MODEL_LIST.some((m) => m.isDefault)).toBe(true);
  });

  it("Whisper model list has at least one default", () => {
    expect(WHISPER_MODEL_LIST.some((m) => m.isDefault)).toBe(true);
  });

  it("all LLM models have required fields", () => {
    for (const model of LLM_MODEL_LIST) {
      expect(model.id).toBeTruthy();
      expect(model.displayName).toBeTruthy();
      expect(model.freeQuotaRpd).toBeGreaterThanOrEqual(0);
      expect(model.freeQuotaTpd).toBeGreaterThanOrEqual(0);
    }
  });

  it("all Whisper models have required fields", () => {
    for (const model of WHISPER_MODEL_LIST) {
      expect(model.id).toBeTruthy();
      expect(model.displayName).toBeTruthy();
      expect(model.costPerHour).toBeGreaterThanOrEqual(0);
    }
  });

  it("all vocabulary analysis models have required fields", () => {
    for (const model of VOCABULARY_ANALYSIS_MODEL_LIST) {
      expect(model.id).toBeTruthy();
      expect(model.displayName).toBeTruthy();
    }
  });
});

describe("multi-provider LLM catalog", () => {
  it("each LLM provider has at least one curated model", () => {
    for (const providerId of ["groq", "openai", "gemini", "openrouter", "nvidia"] as const) {
      const models = getLlmModelsForProvider(providerId);
      expect(models.length, `provider ${providerId}`).toBeGreaterThan(0);
    }
  });

  it("each provider exposes a default model", () => {
    for (const providerId of ["groq", "openai", "gemini", "openrouter", "nvidia"] as const) {
      const models = getLlmModelsForProvider(providerId);
      const defaults = models.filter((m) => m.isDefault);
      expect(defaults.length, `provider ${providerId}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("getDefaultLlmModelForProvider returns Gemini 2.5 Flash for gemini", () => {
    expect(getDefaultLlmModelForProvider("gemini")).toBe("gemini-2.5-flash");
  });

  it("LLM_MODEL_LIST contains all newly seeded model IDs", () => {
    const ids = LLM_MODEL_LIST.map((m) => m.id);
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-pro");
    expect(ids).toContain("gemini-2.0-flash-lite");
    expect(ids).toContain("deepseek/deepseek-chat-v3.1");
    expect(ids).toContain("meta-llama/llama-3.3-70b-instruct");
    expect(ids).toContain("qwen/qwen-2.5-72b-instruct");
    expect(ids).toContain("nvidia/llama-3.3-nemotron-super-49b-v1");
    expect(ids).toContain("meta/llama-3.3-70b-instruct");
  });
});
