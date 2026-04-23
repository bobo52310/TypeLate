import { useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { getProviderConfig } from "@/lib/providerConfig";
import { extractVocabularyFromText } from "@/lib/textVocabularyExtractor";
import type { ExtractedTerm } from "@/lib/textVocabularyExtractor";
import { captureError } from "@/lib/sentry";

export interface UseRecordVocabularyAnalysis {
  isAnalyzing: boolean;
  extractedTerms: ExtractedTerm[];
  error: string | null;
  analyzeRecord: (text: string) => Promise<void>;

  selectedTerms: Set<string>;
  toggleTerm: (term: string) => void;
  toggleAll: () => void;
  allSelected: boolean;
  selectableCount: number;

  addSelectedTerms: () => Promise<{ added: number; skipped: number }>;
  isDuplicate: (term: string) => boolean;
  reset: () => void;
}

export function useRecordVocabularyAnalysis(): UseRecordVocabularyAnalysis {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedTerms, setExtractedTerms] = useState<ExtractedTerm[]>([]);
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Vocabulary analysis uses Groq-only models, so always hit the Groq chat endpoint
  // with the Groq API key regardless of the user's selected LLM provider.
  const groqApiKey = useSettingsStore((s) => s.apiKeys.groq);
  const selectedVocabularyAnalysisModelId = useSettingsStore(
    (s) => s.selectedVocabularyAnalysisModelId,
  );

  const isDuplicateTerm = useVocabularyStore((s) => s.isDuplicateTerm);
  const batchAddTerms = useVocabularyStore((s) => s.batchAddTerms);

  const isDuplicate = useCallback(
    (term: string) => isDuplicateTerm(term),
    [isDuplicateTerm],
  );

  const analyzeRecord = useCallback(
    async (text: string) => {
      if (!groqApiKey) {
        setError("apiKeyRequired");
        return;
      }

      setIsAnalyzing(true);
      setError(null);
      setExtractedTerms([]);
      setSelectedTerms(new Set());

      try {
        const providerConfig = getProviderConfig("groq");
        const result = await extractVocabularyFromText(text, groqApiKey, {
          modelId: selectedVocabularyAnalysisModelId,
          chatApiUrl: providerConfig.chatBaseUrl,
        });

        setExtractedTerms(result.terms);

        // Auto-select non-low relevance terms that are not duplicates
        const autoSelected = new Set<string>();
        for (const term of result.terms) {
          if (term.relevance !== "low" && !isDuplicateTerm(term.term)) {
            autoSelected.add(term.term);
          }
        }
        setSelectedTerms(autoSelected);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        captureError(err, { source: "history", action: "vocab-analysis" });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [groqApiKey, selectedVocabularyAnalysisModelId, isDuplicateTerm],
  );

  const toggleTerm = useCallback((term: string) => {
    setSelectedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(term)) {
        next.delete(term);
      } else {
        next.add(term);
      }
      return next;
    });
  }, []);

  const selectableCount = extractedTerms.filter((t) => !isDuplicateTerm(t.term)).length;

  const allSelected =
    selectableCount > 0 &&
    extractedTerms
      .filter((t) => !isDuplicateTerm(t.term))
      .every((t) => selectedTerms.has(t.term));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedTerms(new Set());
    } else {
      const all = new Set<string>();
      for (const term of extractedTerms) {
        if (!isDuplicateTerm(term.term)) {
          all.add(term.term);
        }
      }
      setSelectedTerms(all);
    }
  }, [allSelected, extractedTerms, isDuplicateTerm]);

  const addSelectedTerms = useCallback(async () => {
    const termsToAdd = Array.from(selectedTerms);
    if (termsToAdd.length === 0) return { added: 0, skipped: 0 };

    const result = await batchAddTerms(termsToAdd);
    return result;
  }, [selectedTerms, batchAddTerms]);

  const reset = useCallback(() => {
    setExtractedTerms([]);
    setSelectedTerms(new Set());
    setError(null);
    setIsAnalyzing(false);
  }, []);

  return {
    isAnalyzing,
    extractedTerms,
    error,
    analyzeRecord,
    selectedTerms,
    toggleTerm,
    toggleAll,
    allSelected,
    selectableCount,
    addSelectedTerms,
    isDuplicate,
    reset,
  };
}
