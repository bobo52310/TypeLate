import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Copy,
  Check,
  Trash2,
  Pencil,
  X,
  Save,
  Sparkles,
  Loader2,
  RefreshCw,
  Settings2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { captureError } from "@/lib/sentry";
import { useHistoryStore } from "@/stores/historyStore";
import { useRecordVocabularyAnalysis } from "@/hooks/useRecordVocabularyAnalysis";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { getDisplayText, formatDurationMs } from "@/lib/formatUtils";
import { retryFailedRecord } from "@/lib/retryFailedRecord";
import { useHashRouter } from "@/app/router";
import type { TranscriptionRecord } from "@/types/transcription";
import type { PromptMode } from "@/types/settings";
import VocabularyResultsPanel from "./VocabularyResultsPanel";

const PROMPT_MODE_LABEL_KEYS: Record<PromptMode, string> = {
  none: "settings.prompt.modeNone",
  minimal: "settings.prompt.modeMinimal",
  active: "settings.prompt.modeActive",
  custom: "settings.prompt.modeCustom",
};

interface ExpandedRecordDetailProps {
  record: TranscriptionRecord;
  confirmDeleteId: string | null;
  onRequestDelete: (record: TranscriptionRecord) => void;
}

export default function ExpandedRecordDetail({
  record,
  confirmDeleteId,
  onRequestDelete,
}: ExpandedRecordDetailProps) {
  const { t } = useTranslation();
  const updateTranscriptionText = useHistoryStore((s) => s.updateTranscriptionText);

  // ── Edit state ──
  const [editingField, setEditingField] = useState<"raw" | "processed" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Copy raw text state ──
  const [copiedRaw, setCopiedRaw] = useState(false);
  const copiedRawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Vocabulary analysis ──
  const vocabAnalysis = useRecordVocabularyAnalysis();
  const [showResults, setShowResults] = useState(false);

  // ── Retry failed record state ──
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<{
    category: "provider" | "config" | "local";
    message: string;
  } | null>(null);
  const retryFeedback = useFeedbackMessage();
  const { navigate } = useHashRouter();

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
    };
  }, []);

  function startEdit(field: "raw" | "processed") {
    const value = field === "processed" ? (record.processedText ?? "") : record.rawText;
    setEditValue(value);
    setEditingField(field);
    // Reset analysis when editing
    if (showResults) {
      vocabAnalysis.reset();
      setShowResults(false);
    }
  }

  function cancelEdit() {
    setEditingField(null);
    setEditValue("");
  }

  async function saveEdit() {
    if (editingField === null) return;
    setIsSaving(true);
    try {
      const newRawText = editingField === "raw" ? editValue : record.rawText;
      const newProcessedText =
        editingField === "processed" ? (editValue || null) : record.processedText;

      await updateTranscriptionText(record.id, newRawText, newProcessedText);

      setEditingField(null);
      setEditValue("");
      setSavedFeedback(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedFeedback(false), 2500);
    } catch (err) {
      captureError(err, { source: "history", action: "edit-text" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyRawText() {
    try {
      await invoke("copy_to_clipboard", { text: record.rawText });
      if (copiedRawTimerRef.current) clearTimeout(copiedRawTimerRef.current);
      setCopiedRaw(true);
      copiedRawTimerRef.current = setTimeout(() => setCopiedRaw(false), 2500);
    } catch (err) {
      captureError(err, { source: "history", action: "copy-raw-text" });
    }
  }

  async function handleAnalyze() {
    const text = getDisplayText(record);
    if (!text.trim()) return;
    setShowResults(true);
    await vocabAnalysis.analyzeRecord(text);
  }

  function handleAnalyzeAgain() {
    const text = getDisplayText(record);
    if (!text.trim()) return;
    void vocabAnalysis.analyzeRecord(text);
  }

  async function handleRetryFailed() {
    if (isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      const result = await retryFailedRecord(record);
      if (result.ok) {
        retryFeedback.show("success", t("history.retry.success"));
        return;
      }
      const kind = result.error ?? "transcriptionFailed";
      if (kind === "transcriptionFailed") {
        setRetryError({
          category: "provider",
          message: result.errorMessage ?? t("history.retryFailed.transcriptionFailed"),
        });
      } else if (kind === "apiKeyMissing") {
        setRetryError({
          category: "config",
          message: t("history.retryFailed.apiKeyMissing"),
        });
      } else {
        setRetryError({
          category: "local",
          message: t(`history.retryFailed.${kind}`),
        });
      }
    } catch (err) {
      captureError(err, { source: "history", action: "retry-failed" });
      setRetryError({
        category: "provider",
        message: t("history.retryFailed.transcriptionFailed"),
      });
    } finally {
      setIsRetrying(false);
    }
  }

  const displayText = getDisplayText(record);
  const canAnalyze = displayText.trim().length > 0;
  const canRetry = record.status === "failed" && !!record.audioFilePath;

  return (
    <div className="border-t border-border px-3 py-3 space-y-3">
      {/* Saved feedback */}
      {savedFeedback && (
        <div className="flex items-center gap-1 text-[11px] text-primary">
          <Check className="h-3 w-3" />
          {t("history.edit.saved")}
        </div>
      )}

      {/* Retry success feedback */}
      {retryFeedback.message && retryFeedback.type === "success" && (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary">
          <Check className="h-3 w-3" />
          {retryFeedback.message}
        </div>
      )}

      {/* Enhanced text */}
      {record.wasEnhanced && record.processedText && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-medium text-primary">
              {t("history.enhancedText")}
            </p>
            {editingField !== "processed" && (
              <button
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => startEdit("processed")}
              >
                <Pencil className="h-2.5 w-2.5" />
                <span>{t("history.edit.edit")}</span>
              </button>
            )}
          </div>
          {editingField === "processed" ? (
            <div className="space-y-2">
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="min-h-[80px] text-sm"
                autoFocus
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={isSaving}
                  onClick={() => void saveEdit()}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {t("history.edit.save")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={cancelEdit}
                  disabled={isSaving}
                >
                  <X className="h-3 w-3" />
                  {t("history.edit.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {record.processedText}
            </p>
          )}
        </div>
      )}

      {/* Raw text */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("history.rawText")}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => void handleCopyRawText()}
            >
              {copiedRaw ? (
                <Check className="h-2.5 w-2.5 text-primary" />
              ) : (
                <Copy className="h-2.5 w-2.5" />
              )}
              <span>{copiedRaw ? t("history.copied") : t("history.copy")}</span>
            </button>
            {editingField !== "raw" && (
              <button
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => startEdit("raw")}
              >
                <Pencil className="h-2.5 w-2.5" />
                <span>{t("history.edit.edit")}</span>
              </button>
            )}
          </div>
        </div>
        {editingField === "raw" ? (
          <div className="space-y-2">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[80px] text-sm"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                disabled={isSaving}
                onClick={() => void saveEdit()}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                {t("history.edit.save")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={cancelEdit}
                disabled={isSaving}
              >
                <X className="h-3 w-3" />
                {t("history.edit.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {record.rawText}
          </p>
        )}
      </div>

      {/* Retry error */}
      {retryError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
            {t(`history.retryFailed.label.${retryError.category}`)}
          </div>
          <p className="text-destructive/90 leading-relaxed">{retryError.message}</p>
          {retryError.category === "provider" && (
            <p className="text-[10px] text-destructive/70">
              {t("history.retryFailed.providerHint")}
            </p>
          )}
          {retryError.category === "config" && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => navigate("/ai")}
              >
                <Settings2 className="h-3 w-3" />
                {t("history.retryFailed.openSettings")}
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Metadata + Actions */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        <span>
          {t("history.recordingLabel")} {formatDurationMs(record.recordingDurationMs)}
        </span>
        <span>
          {t("history.transcriptionLabel")} {formatDurationMs(record.transcriptionDurationMs)}
        </span>
        {record.enhancementDurationMs !== null && (
          <span>
            {t("history.aiLabel")} {formatDurationMs(record.enhancementDurationMs)}
          </span>
        )}
        {record.promptMode && (
          <span>
            {t("history.modeLabel")}
            {t(PROMPT_MODE_LABEL_KEYS[record.promptMode])}
          </span>
        )}
        {record.whisperModelId && (
          <span>{t("history.whisperModel", { model: record.whisperModelId })}</span>
        )}
        {record.llmModelId && (
          <span>{t("history.llmModel", { model: record.llmModelId })}</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Retry failed transcription */}
          {canRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-primary hover:text-primary"
              disabled={isRetrying}
              onClick={() => void handleRetryFailed()}
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {isRetrying
                ? t("history.retry.retrying")
                : t("history.retry.button")}
            </Button>
          )}

          {/* Analyze Vocabulary */}
          {!canRetry && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 gap-1 px-2 text-[11px]",
                showResults && vocabAnalysis.extractedTerms.length > 0
                  ? "text-primary"
                  : vocabAnalysis.isAnalyzing
                    ? "text-muted-foreground"
                    : "animate-breathe-glow rounded-md bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary",
              )}
              disabled={!canAnalyze || vocabAnalysis.isAnalyzing}
              onClick={() => void handleAnalyze()}
            >
              {vocabAnalysis.isAnalyzing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {vocabAnalysis.isAnalyzing
                ? t("history.vocabAnalysis.analyzing")
                : t("history.vocabAnalysis.analyze")}
            </Button>
          )}

          {/* Delete */}
          <Button
            variant={confirmDeleteId === record.id ? "destructive" : "ghost"}
            size="sm"
            className={cn(
              "h-6 gap-1 px-2 text-[11px]",
              confirmDeleteId === record.id
                ? "animate-pulse"
                : "text-destructive hover:text-destructive",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(record);
            }}
          >
            <Trash2 className="h-3 w-3" />
            {confirmDeleteId === record.id
              ? t("settings.apiKey.confirmDelete")
              : t("history.delete")}
          </Button>
        </div>
      </div>

      {/* Vocabulary analysis error */}
      {vocabAnalysis.error && showResults && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {vocabAnalysis.error === "apiKeyRequired"
            ? t("history.vocabAnalysis.apiKeyRequired")
            : t("history.vocabAnalysis.error", { message: vocabAnalysis.error })}
        </div>
      )}

      {/* Vocabulary results */}
      {showResults && !vocabAnalysis.error && !vocabAnalysis.isAnalyzing && (
        <VocabularyResultsPanel
          terms={vocabAnalysis.extractedTerms}
          selectedTerms={vocabAnalysis.selectedTerms}
          onToggleTerm={vocabAnalysis.toggleTerm}
          onToggleAll={vocabAnalysis.toggleAll}
          allSelected={vocabAnalysis.allSelected}
          selectableCount={vocabAnalysis.selectableCount}
          isDuplicate={vocabAnalysis.isDuplicate}
          onAddSelected={vocabAnalysis.addSelectedTerms}
          onAnalyzeAgain={handleAnalyzeAgain}
          isAnalyzing={vocabAnalysis.isAnalyzing}
        />
      )}
    </div>
  );
}
