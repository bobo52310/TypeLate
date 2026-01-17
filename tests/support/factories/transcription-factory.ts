import { faker } from "@faker-js/faker";

export type TranscriptionRecord = {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  charCount: number;
  triggerMode: "hold" | "toggle";
  wasEnhanced: boolean;
  wasModified: boolean | null;
  createdAt: string;
};

export const createTranscriptionRecord = (
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord => {
  const rawText = overrides.rawText ?? faker.lorem.sentences(2);
  const wasEnhanced = overrides.wasEnhanced ?? faker.datatype.boolean();

  return {
    id: faker.string.uuid(),
    timestamp: Date.now(),
    rawText,
    processedText: wasEnhanced ? faker.lorem.sentences(2) : null,
    recordingDurationMs: faker.number.int({ min: 500, max: 30_000 }),
    transcriptionDurationMs: faker.number.int({ min: 200, max: 5_000 }),
    enhancementDurationMs: wasEnhanced
      ? faker.number.int({ min: 100, max: 5_000 })
      : null,
    charCount: rawText.length,
    triggerMode: faker.helpers.arrayElement(["hold", "toggle"]),
    wasEnhanced,
    wasModified: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
};
