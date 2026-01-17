import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Bot, Hand, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

function getWeightVariant(
  weight: number,
): "default" | "secondary" | "outline" {
  if (weight >= 30) return "default";
  if (weight >= 10) return "secondary";
  return "outline";
}

function formatDate(dateString: string, locale: string): string {
  try {
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

export default function DictionaryView() {
  const { t, i18n } = useTranslation();
  const feedback = useFeedbackMessage();

  const termCount = useVocabularyStore((s) => s.termCount);
  const isLoading = useVocabularyStore((s) => s.isLoading);
  const aiSuggestedTermList = useVocabularyStore((s) => s.aiSuggestedTermList);
  const manualTermList = useVocabularyStore((s) => s.manualTermList);
  const isDuplicateTerm = useVocabularyStore((s) => s.isDuplicateTerm);
  const fetchTermList = useVocabularyStore((s) => s.fetchTermList);
  const addTerm = useVocabularyStore((s) => s.addTerm);
  const removeTerm = useVocabularyStore((s) => s.removeTerm);

  const [newTermInput, setNewTermInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingTermIdSet, setRemovingTermIdSet] = useState<Set<string>>(
    new Set(),
  );

  const isAddDisabled = useMemo(
    () => !newTermInput.trim() || isAdding,
    [newTermInput, isAdding],
  );

  const showDuplicateHint = useMemo(
    () => newTermInput.trim() !== "" && isDuplicateTerm(newTermInput),
    [newTermInput, isDuplicateTerm],
  );

  async function handleAddTerm() {
    const term = newTermInput.trim();
    if (!term) return;

    try {
      setIsAdding(true);
      await addTerm(term);
      setNewTermInput("");
      feedback.show("success", t("dictionary.added", { term }));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemoveTerm(id: string, term: string) {
    if (removingTermIdSet.has(id)) return;

    try {
      setRemovingTermIdSet((prev) => new Set(prev).add(id));
      await removeTerm(id);
      feedback.show("success", t("dictionary.removed", { term }));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRemovingTermIdSet((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    void fetchTermList();
  }, [fetchTermList]);

  const locale = i18n.language;

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Badge variant="secondary">
          {t("dictionary.termCount", { count: termCount })}
        </Badge>

        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <Input
              value={newTermInput}
              onChange={(e) => setNewTermInput(e.target.value)}
              placeholder={t("dictionary.inputPlaceholder")}
              className="w-48"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddTerm();
              }}
            />
            {showDuplicateHint && (
              <p className="mt-1 text-xs text-destructive">
                {t("dictionary.duplicateEntry")}
              </p>
            )}
          </div>
          <Button
            size="sm"
            disabled={isAddDisabled || showDuplicateHint}
            onClick={() => void handleAddTerm()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("dictionary.add")}
          </Button>
        </div>
      </div>

      {/* Description */}
      <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("dictionary.description")}</p>
            <p>{t("dictionary.weightDescription", { limit: 50 })}</p>
          </div>
        </div>
      </div>

      {/* Feedback message */}
      {feedback.message && (
        <p
          className={`mt-3 text-sm ${
            feedback.type === "success"
              ? "text-emerald-500"
              : "text-destructive"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="mt-6 text-center text-muted-foreground">
          {t("dictionary.loading")}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && termCount === 0 && (
        <div className="mt-6">
          <Card>
            <div className="px-4 py-8 text-center text-muted-foreground">
              {t("dictionary.emptyState")}
            </div>
          </Card>
        </div>
      )}

      {/* Dictionary sections */}
      {!isLoading && termCount > 0 && (
        <div className="mt-6 space-y-6">
          {/* AI Recommended Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  <Bot className="mr-1 inline h-4 w-4" />
                  {t("dictionary.aiRecommended")}
                </CardTitle>
                {aiSuggestedTermList.length > 0 && (
                  <Badge variant="secondary">
                    {t("dictionary.aiTermCount", {
                      count: aiSuggestedTermList.length,
                    })}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {aiSuggestedTermList.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {t("dictionary.noAiSuggestions")}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-full">
                        {t("dictionary.termHeader")}
                      </TableHead>
                      <TableHead className="w-24 text-center">
                        {t("dictionary.weight")}
                      </TableHead>
                      <TableHead className="w-40">
                        {t("dictionary.dateHeader")}
                      </TableHead>
                      <TableHead className="w-20 text-right">
                        {t("dictionary.actionHeader")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiSuggestedTermList.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium text-foreground">
                          {entry.term}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={getWeightVariant(entry.weight)}>
                            {entry.weight}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(entry.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={removingTermIdSet.has(entry.id)}
                            onClick={() =>
                              void handleRemoveTerm(entry.id, entry.term)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Manual Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <Hand className="mr-1 inline h-4 w-4" />
                {t("dictionary.manualAdded")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {manualTermList.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-full">
                        {t("dictionary.termHeader")}
                      </TableHead>
                      <TableHead className="w-24 text-center">
                        {t("dictionary.weight")}
                      </TableHead>
                      <TableHead className="w-40">
                        {t("dictionary.dateHeader")}
                      </TableHead>
                      <TableHead className="w-20 text-right">
                        {t("dictionary.actionHeader")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualTermList.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium text-foreground">
                          {entry.term}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={getWeightVariant(entry.weight)}>
                            {entry.weight}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(entry.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={removingTermIdSet.has(entry.id)}
                            onClick={() =>
                              void handleRemoveTerm(entry.id, entry.term)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {t("dictionary.emptyState")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
