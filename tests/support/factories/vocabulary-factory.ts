import { faker } from "@faker-js/faker";

export type VocabularyEntry = {
  id: string;
  term: string;
  createdAt: string;
};

export const createVocabularyEntry = (
  overrides: Partial<VocabularyEntry> = {},
): VocabularyEntry => ({
  id: faker.string.uuid(),
  term: faker.word.noun(),
  createdAt: new Date().toISOString(),
  ...overrides,
});
