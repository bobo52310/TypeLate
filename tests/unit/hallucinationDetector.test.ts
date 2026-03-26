import { describe, expect, it } from "vitest";
import {
  detectHallucination,
  detectEnhancementAnomaly,
  SPEED_ANOMALY_MAX_DURATION_MS,
  SPEED_ANOMALY_MIN_CHARS,
  SILENCE_PEAK_ENERGY_THRESHOLD,
  SILENCE_RMS_THRESHOLD,
  SILENCE_NSP_THRESHOLD,
  LAYER2B_PEAK_ENERGY_CEILING,
  HIGH_CONFIDENCE_NSP_THRESHOLD,
  ENHANCEMENT_LENGTH_EXPLOSION_RATIO,
  KNOWN_HALLUCINATION_EXACT,
  KNOWN_HALLUCINATION_SUBSTRING,
} from "@/lib/hallucinationDetector";

describe("detectHallucination", () => {
  const normalParams = {
    rawText: "Hello this is a normal sentence that was spoken clearly",
    recordingDurationMs: 5000,
    peakEnergyLevel: 0.5,
    rmsEnergyLevel: 0.1,
    noSpeechProbability: 0.1,
  };

  it("allows normal speech through", () => {
    const result = detectHallucination(normalParams);
    expect(result.isHallucination).toBe(false);
    expect(result.reason).toBeNull();
  });

  describe("Layer 1: speed anomaly", () => {
    it("detects too-fast speech (short recording, many chars)", () => {
      const result = detectHallucination({
        ...normalParams,
        recordingDurationMs: SPEED_ANOMALY_MAX_DURATION_MS - 1,
        rawText: "A".repeat(SPEED_ANOMALY_MIN_CHARS + 1),
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("speed-anomaly");
    });

    it("allows short text in short recording", () => {
      const result = detectHallucination({
        ...normalParams,
        recordingDurationMs: 500,
        rawText: "Hi",
      });
      expect(result.isHallucination).toBe(false);
    });

    it("allows long text in long recording", () => {
      const result = detectHallucination({
        ...normalParams,
        recordingDurationMs: SPEED_ANOMALY_MAX_DURATION_MS + 1,
        rawText: "A".repeat(100),
      });
      expect(result.isHallucination).toBe(false);
    });
  });

  describe("Layer 2: no speech detected", () => {
    it("detects complete silence (very low peak)", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: SILENCE_PEAK_ENERGY_THRESHOLD - 0.001,
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("no-speech-detected");
    });

    it("detects low-energy + high NSP (background noise only)", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: LAYER2B_PEAK_ENERGY_CEILING - 0.001,
        rmsEnergyLevel: SILENCE_RMS_THRESHOLD - 0.001,
        noSpeechProbability: SILENCE_NSP_THRESHOLD + 0.01,
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("no-speech-detected");
    });

    it("allows speech when peak is above ceiling and NSP is moderate (escape hatch)", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: LAYER2B_PEAK_ENERGY_CEILING + 0.01,
        rmsEnergyLevel: SILENCE_RMS_THRESHOLD - 0.001,
        noSpeechProbability: SILENCE_NSP_THRESHOLD + 0.01, // 0.71 — moderate, not extreme
      });
      expect(result.isHallucination).toBe(false);
    });

    it("detects high-confidence NSP even with high peak energy (Layer 2c)", () => {
      // Real case: background noise (fan/AC) pushes peak high, but Whisper knows there's no speech
      const result = detectHallucination({
        ...normalParams,
        rawText: "some hallucinated text here",
        peakEnergyLevel: 0.0945, // well above escape hatch
        rmsEnergyLevel: 0.0155,
        noSpeechProbability: 0.985, // Whisper is 98.5% sure there's no speech
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("no-speech-detected");
    });

    it("detects NSP just above high-confidence threshold", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: 0.5,
        rmsEnergyLevel: 0.1,
        noSpeechProbability: HIGH_CONFIDENCE_NSP_THRESHOLD + 0.01,
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("no-speech-detected");
    });

    it("allows speech when NSP is just below high-confidence threshold", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: 0.5,
        rmsEnergyLevel: 0.1,
        noSpeechProbability: HIGH_CONFIDENCE_NSP_THRESHOLD - 0.01,
      });
      expect(result.isHallucination).toBe(false);
    });
  });

  describe("Layer 3: known hallucination patterns", () => {
    it("detects exact-match hallucination (e.g. 謝謝觀看)", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "謝謝觀看",
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("known-hallucination-pattern");
    });

    it("detects exact-match hallucination with extra whitespace", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "  Thank you.  ",
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("known-hallucination-pattern");
    });

    it("detects substring hallucination (明報加拿大)", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "明報加拿大 明報多倫多",
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("known-hallucination-pattern");
    });

    it("detects substring hallucination (Amara.org)", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "Subtitles by the Amara.org community",
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("known-hallucination-pattern");
    });

    it("detects English transliteration of known hallucination (MING PAO)", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "MING PAO CANADA MING PAO TORONTO",
      });
      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("known-hallucination-pattern");
    });

    it("allows normal text that is not in blocklist", () => {
      const result = detectHallucination({
        ...normalParams,
        rawText: "今天天氣真好，我們去公園散步吧",
      });
      expect(result.isHallucination).toBe(false);
    });

    it("blocklist arrays are non-empty", () => {
      expect(KNOWN_HALLUCINATION_EXACT.length).toBeGreaterThan(0);
      expect(KNOWN_HALLUCINATION_SUBSTRING.length).toBeGreaterThan(0);
    });
  });

  it("trims whitespace from detected text", () => {
    const result = detectHallucination({
      ...normalParams,
      rawText: "  hello world  ",
    });
    expect(result.detectedText).toBe("hello world");
  });
});

describe("detectEnhancementAnomaly", () => {
  it("allows normal enhancement", () => {
    const result = detectEnhancementAnomaly({
      rawText: "hello world",
      enhancedText: "Hello, world.",
    });
    expect(result.isAnomaly).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("detects length explosion", () => {
    const raw = "test";
    const enhanced = "T".repeat(raw.length * ENHANCEMENT_LENGTH_EXPLOSION_RATIO);
    const result = detectEnhancementAnomaly({
      rawText: raw,
      enhancedText: enhanced,
    });
    expect(result.isAnomaly).toBe(true);
    expect(result.reason).toBe("length-explosion");
  });

  it("handles empty raw text without anomaly", () => {
    const result = detectEnhancementAnomaly({
      rawText: "",
      enhancedText: "some enhanced text",
    });
    expect(result.isAnomaly).toBe(false);
  });

  it("handles whitespace-only raw text without anomaly", () => {
    const result = detectEnhancementAnomaly({
      rawText: "   ",
      enhancedText: "some text",
    });
    expect(result.isAnomaly).toBe(false);
  });
});
