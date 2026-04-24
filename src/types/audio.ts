export interface AudioInputDeviceInfo {
  name: string;
}

export interface WaveformPayload {
  levels: number[];
}

export interface StopRecordingResult {
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  wavData: number[];
}

export interface TranscriptionResult {
  rawText: string;
  transcriptionDurationMs: number;
  noSpeechProbability: number;
  rateLimit: import("./transcription").RateLimitInfo | null;
}

export interface FrontmostAppInfo {
  name: string;
  bundleId: string;
  iconBase64: string;
}
