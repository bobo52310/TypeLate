import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Bot, Hand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function getWeightVariant(weight: number): "default" | "secondary" | "outline" {
  if (weight >= 30) return "default";
  if (weight >= 10) return "secondary";
  return "outline";
}

function formatDate(dateString: string, locale: string): string {
  try {
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return dateString;
  }
}

export default function VocabularyListSection() {
  const { t, i18n } = useTranslation();
  const feedback = useFeedbackMessage();

  const getTermCount = useVocabularyStore((s) => s.termCount);
  const isLoading = useVocabularyStore((s) => s.isLoading);
  const getAiSuggestedTermList = useVocabularyStore((s) => s.aiSuggestedTermList);
  const getManualTermList = useVocabularyStore((s) => s.manualTermList);
  const isDuplicateTerm = useVocabularyStore((s) => s.isDuplicateTerm);
  const fetchTermList = useVocabularyStore((s) => s.fetchTermList);
  const addTerm = useVocabularyStore((s) => s.addTerm);
  const removeTerm = useVocabularyStore((s) => s.removeTerm);

  const termCount = getTermCount();
  const aiSuggestedTermList = getAiSuggestedTermList();
  const manualTermList = getManualTermList();

  const [newTermInput, setNewTermInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingTermIdSet, setRemovingTermIdSet] = useState<Set<string>>(new Set());

  const isAddDisabled = useMemo(() => !newTermInput.trim() || isAdding, [newTermInput, isAdding]);
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
      feedback.show("error", err instanceof Error ? err.message : String(err));
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
      feedback.show("error", err instanceof Error ? err.message : String(err));
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
    <div className="space-y-4">
      {/* Add term */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{t("dictionary.termCount", { count: termCount })}</Badge>
        <div className="flex flex-1 items-center gap-2">
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
              <p className="mt-1 text-xs text-destructive">{t("dictionary.duplicateEntry")}</p>
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
      <p className="text-sm text-muted-foreground">{t("dictionary.description")}</p>

      {/* Feedback */}
      {feedback.message && (
        <p
          className={`text-sm ${feedback.type === "success" ? "text-primary" : "text-destructive"}`}
        >
          {feedback.message}
        </p>
      )}

      {isLoading && <p className="text-center text-muted-foreground">{t("dictionary.loading")}</p>}

      {!isLoading && termCount === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("dictionary.emptyState")}
        </p>
      )}

      {!isLoading && termCount > 0 && (
        <div className="space-y-4">
          {/* AI Suggested */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">
                  <Bot className="mr-1 inline h-3.5 w-3.5" />
                  {t("dictionary.aiRecommended")}
                </CardTitle>
                {aiSuggestedTermList.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {aiSuggestedTermList.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {aiSuggestedTermList.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  {t("dictionary.noAiSuggestions")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-full">{t("dictionary.termHeader")}</TableHead>
                      <TableHead className="w-20 text-center">{t("dictionary.weight")}</TableHead>
                      <TableHead className="w-32">{t("dictionary.dateHeader")}</TableHead>
                      <TableHead className="w-16 text-right">
                        {t("dictionary.actionHeader")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiSuggestedTermList.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">{entry.term}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={getWeightVariant(entry.weight)}>{entry.weight}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatDate(entry.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            disabled={removingTermIdSet.has(entry.id)}
                            onClick={() => void handleRemoveTerm(entry.id, entry.term)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Manual */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Hand className="mr-1 inline h-3.5 w-3.5" />
                {t("dictionary.manualAdded")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {manualTermList.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  {t("dictionary.emptyState")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-full">{t("dictionary.termHeader")}</TableHead>
                      <TableHead className="w-20 text-center">{t("dictionary.weight")}</TableHead>
                      <TableHead className="w-32">{t("dictionary.dateHeader")}</TableHead>
                      <TableHead className="w-16 text-right">
                        {t("dictionary.actionHeader")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualTermList.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-medium">{entry.term}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={getWeightVariant(entry.weight)}>{entry.weight}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatDate(entry.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            disabled={removingTermIdSet.has(entry.id)}
                            onClick={() => void handleRemoveTerm(entry.id, entry.term)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
