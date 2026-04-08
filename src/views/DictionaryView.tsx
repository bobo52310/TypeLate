import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp, FileText, List, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SettingsFeedback } from "@/components/settings-layout";
import TextAnalyzerSection from "@/views/settings/TextAnalyzerSection";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import type { VocabularyEntry } from "@/types/vocabulary";

type FilterType = "all" | "ai" | "manual";
type SortField = "createdAt" | "term" | "weight";
type SortDirection = "asc" | "desc";

export default function DictionaryView() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const termList = useVocabularyStore((s) => s.termList);
  const isLoading = useVocabularyStore((s) => s.isLoading);
  const isDuplicateTerm = useVocabularyStore((s) => s.isDuplicateTerm);
  const fetchTermList = useVocabularyStore((s) => s.fetchTermList);
  const addTerm = useVocabularyStore((s) => s.addTerm);
  const updateTerm = useVocabularyStore((s) => s.updateTerm);
  const removeTerm = useVocabularyStore((s) => s.removeTerm);
  const batchAddTerms = useVocabularyStore((s) => s.batchAddTerms);

  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Add sheet state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [newTermInput, setNewTermInput] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingIdSet, setRemovingIdSet] = useState<Set<string>>(new Set());

  const isAddDisabled = useMemo(
    () => !newTermInput.trim() || isAdding,
    [newTermInput, isAdding],
  );
  const showDuplicateHint = useMemo(
    () => newTermInput.trim() !== "" && isDuplicateTerm(newTermInput),
    [newTermInput, isDuplicateTerm],
  );

  const filteredTermList = useMemo(() => {
    let list = [...termList];
    if (filter === "ai") list = list.filter((e) => e.source === "ai");
    if (filter === "manual") list = list.filter((e) => e.source === "manual");
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((e) => e.term.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "term":
          cmp = a.term.localeCompare(b.term);
          break;
        case "weight":
          cmp = a.weight - b.weight;
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return list;
  }, [termList, filter, searchQuery, sortField, sortDirection]);

  function cycleSortField() {
    const fields: SortField[] = ["createdAt", "term", "weight"];
    const idx = fields.indexOf(sortField);
    const nextIdx = (idx + 1) % fields.length;
    setSortField(fields[nextIdx]!);
    setSortDirection("desc");
  }

  useEffect(() => {
    void fetchTermList();
  }, [fetchTermList]);

  // ── Add handlers ──

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
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
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

  // ── Edit handlers ──

  function startEditing(entry: VocabularyEntry) {
    setEditingId(entry.id);
    setEditingValue(entry.term);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingValue("");
  }

  async function handleSaveEdit(id: string) {
    const trimmed = editingValue.trim();
    if (!trimmed) {
      cancelEditing();
      return;
    }
    try {
      await updateTerm(id, trimmed);
      feedback.show("success", t("dictionary.updated", { term: trimmed }));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      cancelEditing();
    }
  }

  // ── Delete handler ──

  async function handleRemove(id: string, term: string) {
    if (removingIdSet.has(id)) return;
    try {
      setRemovingIdSet((prev) => new Set(prev).add(id));
      await removeTerm(id);
      feedback.show("success", t("dictionary.removed", { term }));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingIdSet((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-y-auto">
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />

        <div className="space-y-5 px-6 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{t("mainApp.nav.dictionary")}</h1>
            <Button onClick={() => setIsAddSheetOpen(true)}>
              {t("dictionary.addWord")}
            </Button>
          </div>

          {/* Filter tabs + search */}
          <div className="flex items-center justify-between gap-3">
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(v as FilterType)}
            >
              <TabsList>
                <TabsTrigger value="all">{t("dictionary.filterAll")}</TabsTrigger>
                <TabsTrigger value="ai" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("dictionary.filterAuto")}
                </TabsTrigger>
                <TabsTrigger value="manual" className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  {t("dictionary.filterManual")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {isSearchOpen ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("dictionary.searchPlaceholder")}
                  className="h-8 w-44"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setIsSearchOpen(true)}
              >
                <Search className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Term count + sort */}
          {!isLoading && termList.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {t("dictionary.termCount", { count: filteredTermList.length })}
              </Badge>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={cycleSortField}
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
                {sortField === "createdAt" && t("dictionary.sortByDate")}
                {sortField === "term" && t("dictionary.sortByTerm")}
                {sortField === "weight" && t("dictionary.sortByWeight")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs text-muted-foreground"
                onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
              >
                {sortDirection === "desc" ? "↓" : "↑"}
              </Button>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <p className="py-8 text-center text-muted-foreground">{t("dictionary.loading")}</p>
          )}

          {/* Empty */}
          {!isLoading && termList.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("dictionary.emptyState")}
            </p>
          )}

          {/* Card grid */}
          {!isLoading && filteredTermList.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5">
              {filteredTermList.map((entry) => (
                <div
                  key={entry.id}
                  className="group relative flex items-center gap-2.5 rounded-lg bg-muted/50 px-3.5 py-2.5 transition-colors hover:bg-muted"
                >
                  {/* Source icon */}
                  {entry.source === "ai" ? (
                    <Sparkles className="h-4 w-4 shrink-0 text-teal-500" />
                  ) : (
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                  )}

                  {/* Term text or inline edit */}
                  {editingId === entry.id ? (
                    <div className="flex flex-1 items-center gap-1">
                      <Input
                        ref={editInputRef}
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        className="h-7 flex-1 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveEdit(entry.id);
                          if (e.key === "Escape") cancelEditing();
                        }}
                        onBlur={() => void handleSaveEdit(entry.id)}
                      />
                    </div>
                  ) : (
                    <span
                      className="flex-1 cursor-pointer truncate text-sm font-medium"
                      onClick={() => startEditing(entry)}
                    >
                      {entry.term}
                    </span>
                  )}

                  {/* Delete on hover */}
                  {editingId !== entry.id && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      disabled={removingIdSet.has(entry.id)}
                      onClick={() => void handleRemove(entry.id, entry.term)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* No results for search/filter */}
          {!isLoading && termList.length > 0 && filteredTermList.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("dictionary.emptyState")}
            </p>
          )}

          <SettingsFeedback message={feedback.message} type={feedback.type} />
        </div>

        <div className="pointer-events-none sticky bottom-0 z-10 h-3 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* Add word sheet */}
      <Sheet open={isAddSheetOpen} onOpenChange={setIsAddSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("dictionary.addWord")}</SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="manual" className="px-4">
            <TabsList variant="line" className="w-full border-b">
              <TabsTrigger value="manual" className="flex-1">
                {t("dictionary.filterManual")}
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex-1">
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {t("dictionary.textAnalyzer.title")}
              </TabsTrigger>
            </TabsList>

            {/* Manual add tab */}
            <TabsContent value="manual">
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">{t("dictionary.description")}</p>

                <div className="flex justify-end">
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
                  <div className="space-y-3">
                    <Textarea
                      value={bulkInput}
                      onChange={(e) => setBulkInput(e.target.value)}
                      placeholder={t("dictionary.bulkAddPlaceholder")}
                      rows={8}
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
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-1 flex-col">
                        <Input
                          value={newTermInput}
                          onChange={(e) => setNewTermInput(e.target.value)}
                          placeholder={t("dictionary.inputPlaceholder")}
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
                )}

                <SettingsFeedback message={feedback.message} type={feedback.type} />
              </div>
            </TabsContent>

            {/* AI text analyzer tab */}
            <TabsContent value="ai">
              <TextAnalyzerSection />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}
