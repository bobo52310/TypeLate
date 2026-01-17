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
  ENHANCEMENT_LENGTH_EXPLOSION_RATIO,
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

    it("allows speech when peak is above ceiling (escape hatch)", () => {
      const result = detectHallucination({
        ...normalParams,
        peakEnergyLevel: LAYER2B_PEAK_ENERGY_CEILING + 0.01,
        rmsEnergyLevel: SILENCE_RMS_THRESHOLD - 0.001,
        noSpeechProbability: SILENCE_NSP_THRESHOLD + 0.01,
      });
      expect(result.isHallucination).toBe(false);
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
    const enhanced = "T".repeat(
      raw.length * ENHANCEMENT_LENGTH_EXPLOSION_RATIO,
    );
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
