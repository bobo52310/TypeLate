import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BookOpen, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractedTerm } from "@/lib/textVocabularyExtractor";

const RELEVANCE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

interface VocabularyResultsPanelProps {
  terms: ExtractedTerm[];
  selectedTerms: Set<string>;
  onToggleTerm: (term: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  selectableCount: number;
  isDuplicate: (term: string) => boolean;
  onAddSelected: () => Promise<{ added: number; skipped: number }>;
  onAnalyzeAgain: () => void;
  isAnalyzing: boolean;
}

export default function VocabularyResultsPanel({
  terms,
  selectedTerms,
  onToggleTerm,
  onToggleAll,
  allSelected,
  selectableCount,
  isDuplicate,
  onAddSelected,
  onAnalyzeAgain,
  isAnalyzing,
}: VocabularyResultsPanelProps) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleAdd() {
    setIsAdding(true);
    try {
      const result = await onAddSelected();
      setFeedback(t("history.vocabAnalysis.added", { added: result.added }));
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setIsAdding(false);
    }
  }

  if (terms.length === 0 && !isAnalyzing) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
        {t("history.vocabAnalysis.noTerms")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground">
            {t("history.vocabAnalysis.found", { count: terms.length })}
          </span>
        </div>
        {selectableCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={onToggleAll}
          >
            {allSelected
              ? t("history.vocabAnalysis.deselectAll")
              : t("history.vocabAnalysis.selectAll")}
          </Button>
        )}
      </div>

      {/* Term list */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {terms.map((term) => {
          const duplicate = isDuplicate(term.term);
          return (
            <label
              key={term.term}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer transition-colors",
                duplicate ? "opacity-50" : "hover:bg-accent/40",
              )}
            >
              <Checkbox
                checked={selectedTerms.has(term.term)}
                disabled={duplicate}
                onCheckedChange={() => onToggleTerm(term.term)}
              />
              <span className="flex-1 truncate text-xs">{term.term}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 leading-tight">
                {term.category}
              </Badge>
              <Badge
                variant={RELEVANCE_VARIANT[term.relevance] ?? "outline"}
                className="text-[9px] px-1 py-0 leading-tight"
              >
                {term.relevance}
              </Badge>
              {duplicate && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 leading-tight">
                  {t("history.vocabAnalysis.alreadyAdded")}
                </Badge>
              )}
            </label>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={onAnalyzeAgain}
          disabled={isAnalyzing}
        >
          {isAnalyzing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {t("history.vocabAnalysis.analyze")}
        </Button>

        <div className="flex items-center gap-2">
          {feedback && (
            <span className="flex items-center gap-1 text-[11px] text-primary">
              <Check className="h-3 w-3" />
              {feedback}
            </span>
          )}
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={selectedTerms.size === 0 || isAdding}
            onClick={() => void handleAdd()}
          >
            {isAdding && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t("history.vocabAnalysis.addSelected", { count: selectedTerms.size })}
          </Button>
        </div>
      </div>
    </div>
  );
}
