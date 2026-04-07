export type VocabularySource = "manual" | "ai";

export interface VocabularyEntry {
  id: string;
  term: string;
  weight: number;
  source: VocabularySource;
  createdAt: string;
  lastUsedAt: string | null;
}
