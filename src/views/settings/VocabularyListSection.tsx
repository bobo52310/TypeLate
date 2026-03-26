import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Bot, Hand, List, FileText, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import type { VocabularyEntry } from "@/types/vocabulary";

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

type SortField = "term" | "weight" | "source" | "createdAt";
type SortDirection = "asc" | "desc";

export default function VocabularyListSection() {
  const { t, i18n } = useTranslation();
  const feedback = useFeedbackMessage();

  const getTermCount = useVocabularyStore((s) => s.termCount);
  const isLoading = useVocabularyStore((s) => s.isLoading);
  const termList = useVocabularyStore((s) => s.termList);
  const isDuplicateTerm = useVocabularyStore((s) => s.isDuplicateTerm);
  const fetchTermList = useVocabularyStore((s) => s.fetchTermList);
  const addTerm = useVocabularyStore((s) => s.addTerm);
  const removeTerm = useVocabularyStore((s) => s.removeTerm);
  const batchAddTerms = useVocabularyStore((s) => s.batchAddTerms);

  const termCount = getTermCount();

  const [newTermInput, setNewTermInput] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [removingTermIdSet, setRemovingTermIdSet] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const isAddDisabled = useMemo(() => !newTermInput.trim() || isAdding, [newTermInput, isAdding]);
  const showDuplicateHint = useMemo(
    () => newTermInput.trim() !== "" && isDuplicateTerm(newTermInput),
    [newTermInput, isDuplicateTerm],
  );

  const sortedTermList = useMemo(() => {
    const list = [...termList];
    list.sort((a: VocabularyEntry, b: VocabularyEntry) => {
      let cmp = 0;
      switch (sortField) {
        case "term":
          cmp = a.term.localeCompare(b.term);
          break;
        case "weight":
          cmp = a.weight - b.weight;
          break;
        case "source":
          cmp = a.source.localeCompare(b.source);
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return list;
  }, [termList, sortField, sortDirection]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

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

  async function handleBulkAdd() {
    const terms = bulkInput
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (terms.length === 0) {
      feedback.show("error", t("dictionary.bulkAddEmpty"));
      return;
    }
    try {
      setIsAdding(true);
      const result = await batchAddTerms(terms);
      setBulkInput("");
      feedback.show(
        "success",
        t("dictionary.bulkAddSuccess", { added: result.added, skipped: result.skipped }),
      );
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
      {/* Add term toolbar */}
      <SettingsGroup>
        <div className="flex items-center gap-3 px-4 py-3">
          <Badge variant="secondary">{t("dictionary.termCount", { count: termCount })}</Badge>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setIsBulkMode((prev) => !prev)}
          >
            {isBulkMode ? (
              <>
                <List className="mr-1 h-3.5 w-3.5" />
                {t("dictionary.singleAdd")}
              </>
            ) : (
              <>
                <FileText className="mr-1 h-3.5 w-3.5" />
                {t("dictionary.bulkAdd")}
              </>
            )}
          </Button>
        </div>

        {isBulkMode ? (
          <div className="space-y-2 px-4 pb-3">
            <Textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={t("dictionary.bulkAddPlaceholder")}
              rows={5}
              className="resize-y"
            />
            <Button
              size="sm"
              disabled={!bulkInput.trim() || isAdding}
              onClick={() => void handleBulkAdd()}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("dictionary.bulkAddButton")}
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-4 pb-3">
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
        )}

        <SettingsFeedback message={feedback.message} type={feedback.type} />
      </SettingsGroup>

      {/* Description */}
      <p className="px-1 text-sm text-muted-foreground">{t("dictionary.description")}</p>

      {isLoading && (
        <p className="text-center text-muted-foreground">{t("dictionary.loading")}</p>
      )}

      {!isLoading && termCount === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("dictionary.emptyState")}
        </p>
      )}

      {/* Unified vocabulary table */}
      {!isLoading && termCount > 0 && (
        <SettingsGroup>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("term")}
                  >
                    {t("dictionary.termHeader")}
                    {sortField === "term" && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </TableHead>
                <TableHead className="w-20 text-center">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("source")}
                  >
                    {t("dictionary.sourceHeader", { defaultValue: "Source" })}
                    {sortField === "source" && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </TableHead>
                <TableHead className="w-20 text-center">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("weight")}
                  >
                    {t("dictionary.weight")}
                    {sortField === "weight" && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </TableHead>
                <TableHead className="w-28">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("createdAt")}
                  >
                    {t("dictionary.dateHeader")}
                    {sortField === "createdAt" && <ArrowUpDown className="h-3 w-3" />}
                  </button>
                </TableHead>
                <TableHead className="w-12 text-right">{t("dictionary.actionHeader")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTermList.map((entry: VocabularyEntry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.term}</TableCell>
                  <TableCell className="text-center">
                    {entry.source === "ai" ? (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Bot className="h-3 w-3" />
                        AI
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Hand className="h-3 w-3" />
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={getWeightVariant(entry.weight)}>{entry.weight}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
        </SettingsGroup>
      )}
    </div>
  );
}
