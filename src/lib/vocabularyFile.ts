import type { VocabularyEntry, VocabularySource } from "@/types/vocabulary";

const CURRENT_VERSION = 1;

export interface VocabularyFileData {
  version: number;
  lastModified: string;
  terms: VocabularyFileTerm[];
}

export interface VocabularyFileTerm {
  term: string;
  weight: number;
  source: VocabularySource;
  createdAt: string;
}

export interface ParseResult {
  valid: boolean;
  terms: VocabularyFileTerm[];
  errors: string[];
}

export interface ImportDiff {
  toInsert: Array<{
    term: string;
    source: VocabularySource;
    weight: number;
    createdAt: string;
  }>;
  toUpdate: Array<{ id: string; weight: number }>;
  unchanged: number;
}

/**
 * Serialize vocabulary entries to the portable JSON format.
 */
export function serializeVocabulary(termList: VocabularyEntry[]): string {
  const data: VocabularyFileData = {
    version: CURRENT_VERSION,
    lastModified: new Date().toISOString(),
    terms: termList.map((entry) => ({
      term: entry.term,
      weight: entry.weight,
      source: entry.source,
      createdAt: entry.createdAt,
    })),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Parse and validate a vocabulary JSON string.
 */
export function parseVocabularyJson(content: string): ParseResult {
  const errors: string[] = [];

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { valid: false, terms: [], errors: ["Invalid JSON"] };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, terms: [], errors: ["Root must be an object"] };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== "number" || obj.version !== CURRENT_VERSION) {
    return {
      valid: false,
      terms: [],
      errors: [`Unsupported version: ${String(obj.version)}, expected ${CURRENT_VERSION}`],
    };
  }

  if (!Array.isArray(obj.terms)) {
    return { valid: false, terms: [], errors: ["Missing or invalid 'terms' array"] };
  }

  const terms: VocabularyFileTerm[] = [];

  for (let i = 0; i < obj.terms.length; i++) {
    const item = obj.terms[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) {
      errors.push(`terms[${i}]: not an object`);
      continue;
    }
    if (typeof item.term !== "string" || !item.term.trim()) {
      errors.push(`terms[${i}]: missing or empty 'term'`);
      continue;
    }
    terms.push({
      term: String(item.term).trim(),
      weight: typeof item.weight === "number" && item.weight >= 0 ? item.weight : 1,
      source: item.source === "ai" ? "ai" : "manual",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    });
  }

  return { valid: true, terms, errors };
}

/**
 * Compute the diff between incoming terms (from remote/file) and existing local terms.
 * Uses term text (case-insensitive) as the unique key.
 * For conflicts: incoming term wins if its weight is higher.
 */
export function computeImportDiff(
  incoming: VocabularyFileTerm[],
  existing: VocabularyEntry[],
): ImportDiff {
  // Build a lookup by lowercase term
  const existingMap = new Map<string, VocabularyEntry>();
  for (const entry of existing) {
    existingMap.set(entry.term.toLowerCase(), entry);
  }

  const toInsert: ImportDiff["toInsert"] = [];
  const toUpdate: ImportDiff["toUpdate"] = [];
  let unchanged = 0;

  for (const incoming_term of incoming) {
    const key = incoming_term.term.toLowerCase();
    const local = existingMap.get(key);

    if (!local) {
      // New term
      toInsert.push({
        term: incoming_term.term,
        source: incoming_term.source,
        weight: incoming_term.weight,
        createdAt: incoming_term.createdAt,
      });
    } else if (incoming_term.weight > local.weight) {
      // Remote has higher weight → update
      toUpdate.push({ id: local.id, weight: incoming_term.weight });
    } else {
      unchanged++;
    }
  }

  return { toInsert, toUpdate, unchanged };
}
