import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Globe, Loader2, Pencil, Plus, RotateCcw, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { getProviderConfig } from "@/lib/providerConfig";
import {
  extractVocabularyFromText,
  MAX_TEXT_LENGTH,
  type ExtractedTerm,
} from "@/lib/textVocabularyExtractor";

type Step = "input" | "loading" | "review";

const RELEVANCE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

export default function TextAnalyzerSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  const getApiKey = useSettingsStore((s) => s.getApiKey);
  const selectedVocabularyAnalysisModelId = useSettingsStore(
    (s) => s.selectedVocabularyAnalysisModelId,
  );

  const batchAddTerms = useVocabularyStore((s) => s.batchAddTerms);

  const [step, setStep] = useState<Step>("input");
  const [textInput, setTextInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [extractedTerms, setExtractedTerms] = useState<ExtractedTerm[]>([]);
  const [selectedTermSet, setSelectedTermSet] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const selectedCount = selectedTermSet.size;
  const allSelected = selectedCount === extractedTerms.length && extractedTerms.length > 0;

  const sortedTerms = useMemo(() => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...extractedTerms].sort(
      (a, b) => (order[a.relevance] ?? 1) - (order[b.relevance] ?? 1),
    );
  }, [extractedTerms]);

  async function handleAnalyze() {
    const text = textInput.trim();
    if (!text) {
      feedback.show("error", t("dictionary.textAnalyzer.noTextProvided"));
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      feedback.show("error", t("dictionary.textAnalyzer.apiKeyRequired"));
      return;
    }

    const providerConfig = getProviderConfig(selectedProviderId);

    setStep("loading");
    try {
      const result = await extractVocabularyFromText(text, apiKey, {
        modelId: selectedVocabularyAnalysisModelId,
        chatApiUrl: providerConfig.chatBaseUrl,
      });

      if (result.terms.length === 0) {
        feedback.show("error", t("dictionary.textAnalyzer.noTermsFound"));
        setStep("input");
        return;
      }

      setExtractedTerms(result.terms);
      // Pre-select high & medium relevance terms
      setSelectedTermSet(
        new Set(
          result.terms
            .filter((term) => term.relevance !== "low")
            .map((term) => term.term),
        ),
      );
      setStep("review");
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
      setStep("input");
    }
  }

  async function handleUploadFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Text",
            extensions: ["txt", "md", "srt"],
          },
        ],
      });

      if (typeof selected !== "string") return;

      const content = await invoke<string | null>("read_sync_file", { path: selected });
      if (content) {
        setTextInput(content);
      }
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFetchUrl() {
    const url = urlInput.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      feedback.show("error", t("dictionary.textAnalyzer.invalidUrl"));
      return;
    }

    setIsFetchingUrl(true);
    try {
      const text = await invoke<string>("fetch_url_text", { url });
      setTextInput(text);
      setUrlInput("");
      setShowPreview(true);
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingUrl(false);
    }
  }

  function toggleTerm(term: string) {
    setSelectedTermSet((prev) => {
      const next = new Set(prev);
      if (next.has(term)) {
        next.delete(term);
      } else {
        next.add(term);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedTermSet(new Set());
    } else {
      setSelectedTermSet(new Set(extractedTerms.map((t) => t.term)));
    }
  }

  async function handleAddSelected() {
    const terms = extractedTerms
      .filter((t) => selectedTermSet.has(t.term))
      .map((t) => t.term);

    if (terms.length === 0) return;

    try {
      setIsAdding(true);
      const result = await batchAddTerms(terms);
      feedback.show(
        "success",
        t("dictionary.textAnalyzer.addSuccess", {
          added: result.added,
          skipped: result.skipped,
        }),
      );
      handleReset();
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdding(false);
    }
  }

  function handleReset() {
    setStep("input");
    setTextInput("");
    setUrlInput("");
    setExtractedTerms([]);
    setSelectedTermSet(new Set());
    setShowPreview(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">{t("dictionary.textAnalyzer.title")}</h4>
        <p className="text-xs text-muted-foreground">{t("dictionary.textAnalyzer.description")}</p>
      </div>

      {/* Step: Input — normal mode */}
      {step === "input" && !showPreview && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t("dictionary.textAnalyzer.urlPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFetchUrl();
              }}
              disabled={isFetchingUrl}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!urlInput.trim() || isFetchingUrl}
              onClick={() => void handleFetchUrl()}
            >
              {isFetchingUrl ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="mr-1 h-3.5 w-3.5" />
              )}
              {isFetchingUrl
                ? t("dictionary.textAnalyzer.fetchingUrl")
                : t("dictionary.textAnalyzer.fetchUrl")}
            </Button>
          </div>
          <Textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={t("dictionary.textAnalyzer.placeholder")}
            rows={6}
            className="resize-y"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleUploadFile()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.uploadFile")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("dictionary.textAnalyzer.supportedFormats")}
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              disabled={!textInput.trim()}
              onClick={() => void handleAnalyze()}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.analyze")}
            </Button>
          </div>
        </div>
      )}

      {/* Step: Input — URL preview mode */}
      {step === "input" && showPreview && (
        <div className="space-y-3">
          {/* Character count + truncation info */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1">
              <FileText className="h-3 w-3" />
              {t("dictionary.textAnalyzer.urlPreviewCharCount", {
                count: textInput.length.toLocaleString(),
              })}
            </Badge>
            {textInput.length > MAX_TEXT_LENGTH ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {t("dictionary.textAnalyzer.urlPreviewTruncated", {
                  limit: MAX_TEXT_LENGTH.toLocaleString(),
                  percent: Math.round((MAX_TEXT_LENGTH / textInput.length) * 100),
                })}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("dictionary.textAnalyzer.urlPreviewAnalyzeAll")}
              </span>
            )}
          </div>

          {/* Truncation progress bar */}
          {textInput.length > MAX_TEXT_LENGTH && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-amber-500"
                style={{
                  width: `${Math.round((MAX_TEXT_LENGTH / textInput.length) * 100)}%`,
                }}
              />
            </div>
          )}

          {/* Text preview (collapsed, 3 lines max) */}
          <div className="rounded-md border bg-muted/50 p-3">
            <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
              {textInput.slice(0, 500)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(false)}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.urlPreviewEdit")}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              {t("dictionary.textAnalyzer.urlPreviewClear")}
            </Button>
            <div className="flex-1" />
            <Button size="sm" onClick={() => void handleAnalyze()}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.analyze")}
            </Button>
          </div>
        </div>
      )}

      {/* Step: Loading */}
      {step === "loading" && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t("dictionary.textAnalyzer.analyzing")}</span>
        </div>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {t("dictionary.textAnalyzer.foundTerms", { count: extractedTerms.length })}
            </Badge>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="text-xs" onClick={toggleAll}>
              {allSelected
                ? t("dictionary.textAnalyzer.deselectAll")
                : t("dictionary.textAnalyzer.selectAll")}
            </Button>
          </div>

          {/* Term list */}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {sortedTerms.map((term) => (
              <label
                key={term.term}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  checked={selectedTermSet.has(term.term)}
                  onCheckedChange={() => toggleTerm(term.term)}
                />
                <span className="flex-1 text-sm font-medium">{term.term}</span>
                <Badge variant="outline" className="text-[10px]">
                  {term.category}
                </Badge>
                <Badge
                  variant={RELEVANCE_VARIANT[term.relevance] ?? "outline"}
                  className="text-[10px]"
                >
                  {term.relevance}
                </Badge>
              </label>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.reset")}
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              disabled={selectedCount === 0 || isAdding}
              onClick={() => void handleAddSelected()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("dictionary.textAnalyzer.addSelected", { count: selectedCount })}
            </Button>
          </div>
        </div>
      )}

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </div>
  );
}
