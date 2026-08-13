import { cva } from "class-variance-authority"

import { ExternalLink, Eye, Loader2, Pencil, Save, Search, Wand2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { QuestionDetailDialog } from "@/components/questions/question-detail-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MathRenderer } from "@/components/ui/math-renderer"
import { RefreshOverlay } from "@/components/ui/refresh-overlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, constantsApi, templatesApi } from "@/lib/api"
import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import {
  getEquationKey,
  getUniqueQuestionTexts,
  groupTemplatesByEquation,
  normalizeEquationKey,
} from "@/lib/formula-grouping"
import { renderEquationAsLatex } from "@/lib/math-utils"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import type { Template } from "@/lib/types"
import { cn } from "@/lib/utils"

const pageContainerVariants = cva("space-y-6")

const formulaCardVariants = cva("space-y-4")

const formulaItemVariants = cva(
  "p-4 bg-muted/50 rounded-lg border border-border/20 hover:bg-muted/70 transition-colors duration-200",
)

function formatQuestionCount(count: number): string {
  if (count === 1) return "1 otázka"
  if (count >= 2 && count <= 4) return `${count} otázky`
  return `${count} otázek`
}

function suggestUnitFromEquation(equationText: string): string {
  const rawLhs = equationText.split("=")[0]?.trim() ?? ""
  const lhs = rawLhs.toLowerCase()
  if (lhs.includes("perc") || lhs.includes("percentage") || lhs.endsWith("%")) {
    return "%"
  }
  if (/^m\d*$/.test(lhs) || ["ms", "mv", "mr"].includes(lhs)) {
    return "g"
  }
  if (/^v\d*$/.test(lhs) || ["vs", "vr"].includes(lhs)) {
    return "L"
  }
  if (lhs.startsWith("rho")) {
    return "g/cm³"
  }
  if (rawLhs === "n") {
    return "mol"
  }
  if (rawLhs === "c") {
    return "mol/l"
  }
  return ""
}

export function FormulasPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string>("")
  const [editEquationText, setEditEquationText] = useState("")
  const [editResultUnit, setEditResultUnit] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewKey, setPreviewKey] = useState<string>("")
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [constants, setConstants] = useState<Record<string, number>>({})

  type SortMode = "equation" | "unit"
  const [sortMode, setSortMode] = useState<SortMode>("unit")
  const [searchQuery, setSearchQuery] = useState("")
  const [isAutoAssigning, setIsAutoAssigning] = useState(false)

  const loadTemplates = useCallback(async () => {
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const allTemplates = await templatesApi.list()
      const templatesWithFormulas = allTemplates.filter((t) => t.formula?.trim() !== "")
      setTemplates(templatesWithFormulas)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepodařilo se načíst šablony")
    } finally {
      hasLoadedRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    let cancelled = false
    constantsApi
      .list()
      .then((allConstants) => {
        if (cancelled) return
        const map: Record<string, number> = {}
        for (const c of allConstants) {
          map[c.symbol] = c.value
        }
        setConstants(map)
      })
      .catch(() => {
        setConstants({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => groupTemplatesByEquation(templates), [templates])
  const sortedKeys = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const entries = Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        rawKey: getEquationKey(group[0]),
        unit: (group[0]?.resultUnit ?? "").trim().toLowerCase(),
        group,
      }))
      .filter(({ rawKey, group }) => {
        if (!query) return true
        if (rawKey.toLowerCase().includes(query)) return true
        return group.some((template) => template.questionText.toLowerCase().includes(query))
      })

    entries.sort((a, b) => {
      if (sortMode === "equation") {
        return a.rawKey.localeCompare(b.rawKey)
      }

      const aUnassigned = a.unit === "" ? 0 : 1
      const bUnassigned = b.unit === "" ? 0 : 1
      if (aUnassigned !== bUnassigned) {
        return aUnassigned - bUnassigned
      }
      if (a.unit !== b.unit) {
        return a.unit.localeCompare(b.unit)
      }
      return a.rawKey.localeCompare(b.rawKey)
    })

    return entries.map((e) => e.key)
  }, [groups, sortMode, searchQuery])

  const handleOpenDialog = useCallback(
    (rawKey: string) => {
      const key = normalizeEquationKey(rawKey)
      const group = groups.get(key) ?? []
      const first = group[0]
      const currentUnit = first?.resultUnit?.trim() ?? ""
      setEditingKey(key)
      setEditEquationText(rawKey)
      setEditResultUnit(currentUnit)
      setDialogOpen(true)
    },
    [groups],
  )

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingKey("")
    setEditEquationText("")
    setEditResultUnit("")
  }, [])

  const handleOpenPreview = useCallback((key: string) => {
    setPreviewKey(key)
    setPreviewOpen(true)
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewOpen(false)
    setPreviewKey("")
  }, [])

  const handleOpenDetail = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId)
    setDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false)
    setSelectedTemplateId(null)
    void loadTemplates()
  }, [loadTemplates])

  const handleGoToQuestion = useCallback(
    async (templates: Template[]) => {
      try {
        for (const template of templates) {
          const location = await templatesApi.getLocation(template.id)
          if (location) {
            navigate(`/sets/${location.setId}?templateId=${template.id}`)
            return
          }
        }
        toast({
          title: "Chyba",
          description: "Otázku se nepodařilo nalézt v žádné sadě.",
          variant: "destructive",
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba",
          description: message,
          variant: "destructive",
        })
      }
    },
    [navigate, toast],
  )

  const handleSave = useCallback(async () => {
    if (!editingKey) return
    try {
      setIsSaving(true)
      const newEquationText = editEquationText.trim()
      const affected = await templatesApi.updateByEquation({
        oldEquationText: editEquationText.trim(),
        newEquationText,
        newFormula: normalizeFormulaForEvaluation(newEquationText),
        newResultUnit: editResultUnit.trim(),
      })
      toast({
        title: "Uloženo",
        description: `Upraveno ${affected} otázek.`,
      })
      handleCloseDialog()
      await loadTemplates()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }, [editingKey, editEquationText, editResultUnit, handleCloseDialog, loadTemplates, toast])

  const handleAutoAssignUnits = useCallback(async () => {
    const updates: { rawKey: string; unit: string }[] = []
    for (const [, group] of groups.entries()) {
      const rawKey = getEquationKey(group[0])
      const currentUnit = (group[0]?.resultUnit ?? "").trim()
      const suggested = suggestUnitFromEquation(rawKey)
      if (suggested && suggested !== currentUnit) {
        updates.push({ rawKey, unit: suggested })
      }
    }

    if (updates.length === 0) {
      toast({
        title: cs.formulas.autoAssign,
        description: cs.formulas.autoAssignNoChanges,
      })
      return
    }

    try {
      setIsAutoAssigning(true)
      await Promise.all(
        updates.map(({ rawKey, unit }) =>
          templatesApi.updateByEquation({
            oldEquationText: rawKey,
            newEquationText: rawKey,
            newFormula: normalizeFormulaForEvaluation(rawKey),
            newResultUnit: unit,
          }),
        ),
      )
      toast({
        title: cs.formulas.autoAssign,
        description: cs.formulas.autoAssignSuccess.replace("{count}", String(updates.length)),
      })
      await loadTemplates()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.formulas.autoAssign,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsAutoAssigning(false)
    }
  }, [groups, loadTemplates, toast])

  const skeletonItems = [1, 2, 3, 4, 5].map((key) => (
    <div key={key} className={cn(formulaItemVariants())}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2 mt-1" />
        </div>
        <Skeleton className="h-7 w-32" />
      </div>
    </div>
  ))

  if (isLoading) {
    return (
      <div className={cn(pageContainerVariants())}>
        <div>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {cs.formulas.title}
            </h1>
            <p className="text-muted-foreground">{cs.formulas.description}</p>
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>{cs.formulas.pageTitle}</CardTitle>
              <CardDescription>{cs.formulas.pageDescription}</CardDescription>
            </CardHeader>
            <CardContent className={cn(formulaCardVariants())}>{skeletonItems}</CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn(pageContainerVariants())}>
        <div>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {cs.formulas.title}
            </h1>
            <p className="text-muted-foreground">{cs.formulas.description}</p>
          </div>
        </div>

        <div className="text-center py-12 text-destructive">
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(pageContainerVariants())}>
      {/* Page header */}
      <div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.formulas.title}
          </h1>
          <p className="text-muted-foreground">{cs.formulas.description}</p>
        </div>
      </div>

      {/* Formulas card */}
      <RefreshOverlay isRefreshing={isRefreshing}>
        <div>
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <CardTitle>{cs.formulas.pageTitle}</CardTitle>
                <CardDescription>{cs.formulas.pageDescription}</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="formulas-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={cs.formulas.searchPlaceholder}
                    className="pl-9 w-[220px]"
                  />
                </div>
                <Label
                  htmlFor="formulas-sort"
                  className="text-sm text-muted-foreground whitespace-nowrap"
                >
                  {cs.formulas.sortBy}
                </Label>
                <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                  <SelectTrigger id="formulas-sort" className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unit">{cs.formulas.sortByUnit}</SelectItem>
                    <SelectItem value="equation">{cs.formulas.sortByEquation}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoAssignUnits}
                  disabled={isAutoAssigning || isLoading}
                >
                  {isAutoAssigning ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Wand2 className="size-4 mr-2" />
                  )}
                  {cs.formulas.autoAssign}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={cn(formulaCardVariants())}>
              {sortedKeys.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>{cs.sets.noQuestions}</p>
                  <p className="text-sm mt-2">
                    Žádné šablony s vzorci zatím neexistují. Vzorec přidejte editací otázky.
                  </p>
                </div>
              ) : (
                sortedKeys.map((key) => {
                  const group = groups.get(key) ?? []
                  const first = group[0]
                  const rawKey = getEquationKey(first)
                  const uniqueQuestionTexts = getUniqueQuestionTexts(group)
                  return (
                    <div key={key} className={cn(formulaItemVariants())}>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="py-1">
                            <MathRenderer text={renderEquationAsLatex(rawKey)} />
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {formatQuestionCount(uniqueQuestionTexts.length)}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {first.resultUnit?.trim() ? (
                                <UnitRenderer unit={first.resultUnit} />
                              ) : (
                                "bez jednotky"
                              )}
                            </Badge>
                            <span className="text-foreground-muted text-xs">
                              {cs.formulas.usedInQuestions}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleOpenPreview(key)}>
                            <Eye className="size-4 mr-2" />
                            {cs.common.preview}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenDialog(rawKey)}
                          >
                            <Pencil className="size-4 mr-2" />
                            {cs.common.edit}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 pl-3 border-l-2 border-border space-y-2">
                        {Array.from(
                          group
                            .reduce((map, template) => {
                              const text = template.questionText.trim()
                              const existing = map.get(text) ?? []
                              existing.push(template)
                              map.set(text, existing)
                              return map
                            }, new Map<string, Template[]>())
                            .entries(),
                        ).map(([text, templates]) => (
                          <div key={text} className="flex items-start gap-3 group">
                            <div className="flex-1 min-w-0 break-words text-sm text-muted-foreground">
                              <QuestionTextRenderer
                                text={text}
                                variables={[]}
                                constants={constants}
                              />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleOpenDetail(templates[0].id)}
                              >
                                <Pencil className="size-4 mr-2" />
                                {cs.common.edit}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleGoToQuestion(templates)}
                              >
                                <ExternalLink className="size-4 mr-2" />
                                {cs.common.open}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </RefreshOverlay>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{cs.formulas.editTitle}</DialogTitle>
            <CardDescription>{cs.formulas.editDescription}</CardDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="equation-text">{cs.formulas.equationLabel}</Label>
              <Textarea
                id="equation-text"
                value={editEquationText}
                onChange={(e) => setEditEquationText(e.target.value)}
                placeholder="w = ms / (ms + mv) × 100"
                rows={3}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="result-unit">{cs.formulas.resultUnitLabel}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditResultUnit(suggestUnitFromEquation(editEquationText))}
                  disabled={isSaving}
                >
                  <Wand2 className="size-3 mr-1" />
                  {cs.formulas.unitAutoSuggested}
                </Button>
              </div>
              <Input
                id="result-unit"
                value={editResultUnit}
                onChange={(e) => setEditResultUnit(e.target.value)}
                placeholder={cs.formulas.resultUnitPlaceholder}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">{cs.form.unitFormatHint}</p>
              <p className="text-xs text-muted-foreground">
                {cs.formulas.currentUnit}:{" "}
                {groups.get(editingKey)?.[0]?.resultUnit?.trim() ? (
                  <UnitRenderer unit={groups.get(editingKey)?.[0]?.resultUnit ?? ""} />
                ) : (
                  "bez jednotky"
                )}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
                <X className="size-4 mr-2" />
                {cs.common.cancel}
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Save className="size-4 mr-2" />
                )}
                {cs.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{cs.common.preview}</DialogTitle>
            <CardDescription>{cs.formulas.usedInQuestions}</CardDescription>
          </DialogHeader>
          <div className="space-y-6 pt-2">
            {Array.from(
              (groups.get(previewKey) ?? [])
                .reduce((map, template) => {
                  const text = template.questionText.trim()
                  const existing = map.get(text) ?? []
                  existing.push(template)
                  map.set(text, existing)
                  return map
                }, new Map<string, Template[]>())
                .entries(),
            ).map(([text, templates], idx) => (
              <div key={text} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {cs.common.preview} {idx + 1}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenDetail(templates[0].id)}
                    >
                      <Pencil className="size-4 mr-2" />
                      {cs.common.edit}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleGoToQuestion(templates)}>
                      <ExternalLink className="size-4 mr-2" />
                      {cs.common.open}
                    </Button>
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <QuestionTextRenderer text={text} variables={[]} constants={constants} />
                </div>
              </div>
            ))}
            {(groups.get(previewKey) ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{cs.sets.noQuestions}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClosePreview}>
              <X className="size-4 mr-2" />
              {cs.common.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {selectedTemplateId && (
        <QuestionDetailDialog
          templateId={selectedTemplateId}
          open={detailOpen}
          onClose={handleCloseDetail}
          onDelete={handleCloseDetail}
        />
      )}
    </div>
  )
}
