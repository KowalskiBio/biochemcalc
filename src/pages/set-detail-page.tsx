import {
  ArrowLeft,
  ArrowRightLeft,
  Download,
  FileText,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { QuestionDetailDialog } from "@/components/questions/question-detail-dialog"
import { AddQuestionDialog } from "@/components/topics/add-question-dialog"
import { EditSetDialog } from "@/components/topics/edit-set-dialog"
import { MoveQuestionDialog } from "@/components/topics/move-question-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RefreshOverlay } from "@/components/ui/refresh-overlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"
import { ExportVariantsDialog } from "@/components/wizard/export-variants-dialog"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import {
  ApiError,
  categoriesApi,
  constantsApi,
  generationApi,
  projektyApi,
  setsApi,
  templatesApi,
} from "@/lib/api"
import {
  evaluateVariantAnswer,
  formatNumberForText,
  resolveOptionsPrecision,
} from "@/lib/math-utils"
import { buildPreviewVariant, QuestionTextRenderer } from "@/lib/render-question-text"
import type {
  CategoryWithSets,
  Notation,
  ProjektQuestion,
  QuestionDifficulty,
  SaveProjektInput,
  Set as SetModel,
  Template,
  TemplateMode,
  TemplateWithDetails,
} from "@/lib/types"
import { useCarryStore } from "@/stores/drag-store"
import { useGenerationActions, useGenerationBySetId } from "@/stores/generation-store"

export function SetDetailPage() {
  const { setId } = useParams<{ setId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const [set, setSet] = useState<SetModel | null>(null)
  const [templateDetails, setTemplateDetails] = useState<TemplateWithDetails[]>([])
  /**
   * Every constant in the database, keyed by symbol. The generator resolves a
   * symbol like `Vk` from here whenever a formula references a constant the
   * teacher never explicitly linked to the template (see
   * `load_template_dependencies` in the Rust engine), so the answer check has
   * to see the same set or it reports "Neznámá proměnná" for answers the
   * backend computed perfectly well.
   */
  const [globalConstants, setGlobalConstants] = useState<Record<string, number>>({})
  const [parentTopicId, setParentTopicId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteSetDialogOpen, setIsDeleteSetDialogOpen] = useState(false)
  const [isDeletingSet, setIsDeletingSet] = useState(false)
  const [isEditSetDialogOpen, setIsEditSetDialogOpen] = useState(false)
  const [regeneratingMap, setRegeneratingMap] = useState<Record<string, boolean>>({})
  const [savingToProjekt, setSavingToProjekt] = useState<string | null | "saving">(null)
  const [projektName, setProjektName] = useState("")
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showClosedConfigDialog, setShowClosedConfigDialog] = useState(false)
  const [showOpenConfigDialog, setShowOpenConfigDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false)
  const [moveTemplate, setMoveTemplate] = useState<Template | null>(null)
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [categoriesWithSets, setCategoriesWithSets] = useState<CategoryWithSets[]>([])
  const [isEditingSetName, setIsEditingSetName] = useState(false)
  const [editSetName, setEditSetName] = useState("")
  const [savingSetName, setSavingSetName] = useState(false)
  const generatedRef = useRef<HTMLDivElement>(null)

  const navigate = useNavigate()
  const isCarrying = useCarryStore((s) => s.isCarrying)
  const startQuestionCarry = useCarryStore((s) => s.startQuestionCarry)
  const justCarriedRef = useRef(false)

  const generation = useGenerationBySetId(setId)
  const { setGeneration, updateGeneration } = useGenerationActions()
  const {
    results: generated,
    mode: generatedMode,
    closedDifficulty,
    closedOptionCount,
    openDifficulty,
    lastClosedDifficulty,
    lastClosedOptionCount,
    lastOpenDifficulty,
    generationError,
  } = generation

  const templateDetailsById = useMemo(
    () => new Map(templateDetails.map((td) => [td.template.id, td])),
    [templateDetails],
  )

  const loadData = useCallback(async () => {
    if (!setId) return
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const data = await setsApi.getWithTemplates(setId)
      setSet(data.set)
      setTemplateDetails(data.templates)
      const category = await categoriesApi.get(data.set.categoryId)
      setParentTopicId(category.topicId)
      const allConstants = await constantsApi.list()
      setGlobalConstants(Object.fromEntries(allConstants.map((c) => [c.symbol, c.value])))
      const topicCategories = await categoriesApi.listByTopic(category.topicId)
      const withSets = await Promise.all(
        topicCategories.map(async (cat) => {
          try {
            return await categoriesApi.getWithSets(cat.id)
          } catch {
            return { category: cat, sets: [] }
          }
        }),
      )
      setCategoriesWithSets(withSets)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      hasLoadedRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [setId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleQuestionMouseDown = useCallback(
    (e: React.MouseEvent, template: Template) => {
      if (e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          cleanup()
          justCarriedRef.current = true
          startQuestionCarry(template, setId ?? "")
        }
      }
      const handleUp = () => {
        cleanup()
      }
      const cleanup = () => {
        document.removeEventListener("mousemove", handleMove)
        document.removeEventListener("mouseup", handleUp)
      }
      document.addEventListener("mousemove", handleMove)
      document.addEventListener("mouseup", handleUp)
    },
    [setId, startQuestionCarry],
  )

  const handleSaveSetName = useCallback(async () => {
    if (!set) return
    const trimmed = editSetName.trim()
    if (!trimmed) {
      setIsEditingSetName(false)
      return
    }
    try {
      setSavingSetName(true)
      await setsApi.updateName(set.id, trimmed || null)
      toast({ title: cs.topics.renameSuccess })
      await loadData()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.renameError, description: message, variant: "destructive" })
    } finally {
      setSavingSetName(false)
      setIsEditingSetName(false)
    }
  }, [set, editSetName, toast, loadData])

  useEffect(() => {
    const templateId = searchParams.get("templateId")
    if (!templateId || templateDetails.length === 0) return
    if (templateDetails.some((t) => t.template.id === templateId)) {
      setSelectedTemplateId(templateId)
      setDialogOpen(true)
      setSearchParams({}, { replace: true })
      window.setTimeout(() => {
        document.getElementById(`template-row-${templateId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        })
      }, 100)
    }
  }, [searchParams, setSearchParams, templateDetails])

  const handleDeleteTemplate = useCallback(
    async (template: Template) => {
      try {
        setIsDeleting(true)
        await templatesApi.delete(template.id)
        setTemplateDetails((prev) => prev.filter((t) => t.template.id !== template.id))
        toast({
          title: cs.sets.deleteSuccess,
          description: cs.sets.deleteSuccessDescription.replace(
            "{name}",
            template.questionText.slice(0, 50),
          ),
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: cs.sets.deleteError,
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsDeleting(false)
        setIsDeleteDialogOpen(false)
        setTemplateToDelete(null)
      }
    },
    [toast],
  )

  const openDeleteDialog = useCallback((template: Template, event: React.MouseEvent) => {
    event.stopPropagation()
    setTemplateToDelete(template)
    setIsDeleteDialogOpen(true)
  }, [])

  const handleDeleteSet = useCallback(async () => {
    if (!set) return
    try {
      setIsDeletingSet(true)
      await setsApi.delete(set.id)
      toast({ title: cs.topics.deleteSetSuccess })
      setIsDeleteSetDialogOpen(false)
      navigate(parentTopicId ? `/topics/${parentTopicId}` : "/topics")
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.deleteSetError, description: message, variant: "destructive" })
    } finally {
      setIsDeletingSet(false)
    }
  }, [set, toast, navigate, parentTopicId])

  const refreshTemplate = useCallback(
    async (templateId: string) => {
      try {
        const details = await templatesApi.getWithDetails(templateId)
        setTemplateDetails((prev) => prev.map((t) => (t.template.id === templateId ? details : t)))
      } catch {
        void loadData()
      }
    },
    [loadData],
  )

  const handleGenerate = useCallback(
    async (mode: TemplateMode, difficulty: QuestionDifficulty, optionCount: number) => {
      if (!setId || templateDetails.length === 0) return
      try {
        setIsGenerating(true)
        setGeneration(setId, {
          results: null,
          generationError: null,
        })
        const results = await generationApi.generateForTemplates({
          templateIds: templateDetails.map((t) => t.template.id),
          count: 1,
          baseSeed: Date.now(),
          mode,
          difficulty,
          optionCount,
        })
        setGeneration(
          setId,
          mode === "closed"
            ? {
                results,
                mode,
                lastClosedDifficulty: difficulty,
                lastClosedOptionCount: optionCount,
              }
            : { results, mode, lastOpenDifficulty: difficulty },
        )
        toast({
          title: "Generování dokončeno",
          description: `Vygenerováno ${results.length} variant.`,
        })
        window.setTimeout(() => {
          generatedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 100)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        setGeneration(setId, { generationError: message })
        toast({
          title: "Chyba generování",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsGenerating(false)
      }
    },
    [setId, templateDetails, setGeneration, toast],
  )

  const handleRegenerateVariant = useCallback(
    async (templateId: string, manualAnswer?: number) => {
      if (!setId || !generatedMode) return

      try {
        setRegeneratingMap((prev) => ({ ...prev, [templateId]: true }))
        const newVariant = await generationApi.regenerateVariant({
          templateId,
          mode: generatedMode,
          seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
          manualAnswer,
          difficulty: generatedMode === "closed" ? lastClosedDifficulty : lastOpenDifficulty,
          optionCount: generatedMode === "closed" ? lastClosedOptionCount : 5,
        })

        updateGeneration(setId, (prev) => {
          if (!prev.results) return prev
          return {
            ...prev,
            results: prev.results.map((g) =>
              g.template.id === templateId ? { ...g, variants: [newVariant] } : g,
            ),
          }
        })

        toast({
          title: "Varianta regenerována",
          description: `Nová správná odpověď: ${formatNumberForText(newVariant.correctAnswer)}`,
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba regenerace",
          description: message,
          variant: "destructive",
        })
      } finally {
        setRegeneratingMap((prev) => ({ ...prev, [templateId]: false }))
      }
    },
    [
      setId,
      generatedMode,
      lastClosedDifficulty,
      lastClosedOptionCount,
      lastOpenDifficulty,
      updateGeneration,
      toast,
    ],
  )

  const handleSaveToProjekt = useCallback(async () => {
    if (!generated || !generatedMode || !set) return

    if (!projektName.trim()) {
      toast({
        title: "Chyba",
        description: "Zadejte název projektu",
        variant: "destructive",
      })
      return
    }

    try {
      setSavingToProjekt("saving")

      const questions: ProjektQuestion[] = generated.map((g) => {
        const variant = g.variants[0]
        const td = templateDetailsById.get(g.template.id)
        const tmpl = td?.template ?? g.template
        const variablePrecisions: Record<string, number> = {}
        const variableSignificantDigits: Record<string, number> = {}
        const variableNotations: Record<string, Notation> = {}
        for (const v of td?.variables ?? []) {
          variablePrecisions[v.variable.symbol] = v.variable.precision
          if (v.variable.significantDigits) {
            variableSignificantDigits[v.variable.symbol] = v.variable.significantDigits
          }
          if (v.variable.notation && v.variable.notation !== "auto") {
            variableNotations[v.variable.symbol] = v.variable.notation
          }
        }
        return {
          templateId: g.template.id,
          questionText: tmpl.questionText,
          resultUnit: tmpl.resultUnit,
          pointValue: tmpl.pointValue,
          correctAnswer: variant?.correctAnswer,
          assignedValues: variant?.assignedValues || {},
          assignedStrings: variant?.assignedStrings || {},
          variablePrecisions,
          variableSignificantDigits:
            Object.keys(variableSignificantDigits).length > 0
              ? variableSignificantDigits
              : undefined,
          variableNotations:
            Object.keys(variableNotations).length > 0 ? variableNotations : undefined,
          resultPrecision: 2,
          significantDigits: tmpl.significantDigits,
          forceScientific: tmpl.forceScientific ?? false,
          numericOptions: variant?.numericOptions,
          correctOption: variant?.correctOption,
          intervalLo: variant?.intervalLo,
          intervalHi: variant?.intervalHi,
          mode: generatedMode,
          seed: variant?.seed || Date.now(),
          answersData: variant?.answersData,
        }
      })

      const input: SaveProjektInput = {
        name: projektName,
        topicName: set?.categoryId ? "Téma" : undefined,
        mode: generatedMode,
        questions,
      }

      const projekt = await projektyApi.save(input)

      toast({
        title: "Projekt uložen",
        description: `Projekt "${projekt.name}" byl úspěšně uložen (${projekt.questionCount} otázek).`,
      })

      setProjektName("")
      setShowSaveDialog(false)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba uložení",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSavingToProjekt(null)
    }
  }, [generated, generatedMode, set, projektName, toast, templateDetailsById])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/topics">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-20 mt-1" />
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-9 w-32" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-16 mt-1" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!set) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Sada nenalezena.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to={parentTopicId ? `/topics/${parentTopicId}` : "/topics"}>Zpět na témata</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(parentTopicId ? `/topics/${parentTopicId}` : "/topics")}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          {isEditingSetName ? (
            <Input
              value={editSetName}
              onChange={(e) => setEditSetName(e.target.value)}
              onBlur={handleSaveSetName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveSetName()
                if (e.key === "Escape") setIsEditingSetName(false)
              }}
              disabled={savingSetName}
              autoFocus
              className="text-2xl font-semibold h-auto py-0 max-w-xs"
            />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              <button
                type="button"
                className="cursor-pointer hover:ring-2 hover:ring-primary/30 rounded px-1 -mx-1 text-left"
                onClick={() => {
                  setEditSetName(
                    set.name || cs.topics.setIndex.replace("{index}", String(set.setIndex)),
                  )
                  setIsEditingSetName(true)
                }}
              >
                {set.name || cs.topics.setIndex.replace("{index}", String(set.setIndex))}
                <Pencil className="size-3 inline ml-2 text-muted-foreground" />
              </button>
            </h1>
          )}
          <p className="text-muted-foreground text-sm">
            {templateDetails.length} {cs.sets.questions.toLowerCase()}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setIsEditSetDialogOpen(true)}
        >
          <Pencil className="size-4 mr-2" />
          {cs.common.edit}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setIsDeleteSetDialogOpen(true)}
          disabled={isDeletingSet}
        >
          <Trash2 className="size-4 mr-2" />
          {cs.common.delete}
        </Button>
      </div>

      <RefreshOverlay isRefreshing={isRefreshing}>
        {/* Mode and actions */}
        <div>
          <Card>
            <CardContent className="flex flex-wrap gap-2 pt-6">
              <Button onClick={() => setIsAddQuestionOpen(true)}>
                <Plus className="size-4 mr-2" />
                {cs.topics.addQuestion}
              </Button>
              <Button
                onClick={() => setShowClosedConfigDialog(true)}
                disabled={isGenerating || templateDetails.length === 0}
                variant="secondary"
              >
                {isGenerating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                {cs.sets.closedQuestions}
              </Button>
              <Button
                onClick={() => setShowOpenConfigDialog(true)}
                disabled={isGenerating || templateDetails.length === 0}
              >
                {isGenerating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                {cs.sets.openQuestions}
              </Button>
              <Button
                onClick={() => setShowExportDialog(true)}
                variant="outline"
                disabled={templateDetails.length === 0 || isGenerating}
              >
                <Download className="size-4 mr-2" />
                {cs.sets.export}
              </Button>
              <Button
                onClick={() => setShowSaveDialog(true)}
                variant="secondary"
                disabled={!generated || isGenerating || savingToProjekt === "saving"}
              >
                <Save className="size-4 mr-2" />
                {cs.sets.saveToProjekt}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Templates table */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <FileText className="size-5 inline mr-2" />
                {cs.sets.questions}
              </CardTitle>
              <CardDescription>
                {templateDetails.length}{" "}
                {templateDetails.length === 1
                  ? "otázka"
                  : templateDetails.length >= 2 && templateDetails.length <= 4
                    ? "otázky"
                    : "otázek"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {templateDetails.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-foreground-muted">{cs.sets.noQuestions}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30px]"></TableHead>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Text otázky</TableHead>
                      <TableHead className="w-[100px]">Body</TableHead>
                      <TableHead className="w-[120px] text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templateDetails.map((t, idx) => (
                      <TableRow
                        key={t.template.id}
                        id={`template-row-${t.template.id}`}
                        className={`cursor-pointer hover:bg-muted/50 ${isCarrying ? "pointer-events-none" : ""}`}
                        onClick={(e) => {
                          if (isCarrying || justCarriedRef.current) {
                            justCarriedRef.current = false
                            e.preventDefault()
                            return
                          }
                          setSelectedTemplateId(t.template.id)
                          setDialogOpen(true)
                        }}
                        onMouseDown={(e) => handleQuestionMouseDown(e, t.template)}
                      >
                        <TableCell className="w-[30px] text-muted-foreground/50">
                          <GripVertical className="size-4" />
                        </TableCell>
                        <TableCell className="font-medium">{idx + 1}</TableCell>
                        <TableCell className="min-w-[400px] max-w-2xl">
                          <QuestionTextRenderer
                            text={t.template.questionText}
                            variables={t.variables}
                            variant={buildPreviewVariant(t.template.id, t.variables)}
                            constants={Object.fromEntries(
                              t.constants.map((c) => [c.symbol, c.value]),
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.template.pointValue}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(event) => {
                                event.stopPropagation()
                                setMoveTemplate(t.template)
                                setIsMoveDialogOpen(true)
                              }}
                              aria-label={cs.topics.moveQuestion}
                            >
                              <ArrowRightLeft className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(event) => openDeleteDialog(t.template, event)}
                              disabled={isDeleting}
                              aria-label={cs.common.delete}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Generation error */}
        {generationError && (
          <div>
            <Card className="border-destructive">
              <CardContent className="pt-6">
                <p className="text-destructive font-medium">Generování selhalo</p>
                <p className="text-sm text-destructive/80 mt-1">{generationError}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Generated results */}
        {generated && (
          <div ref={generatedRef} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{cs.sets.generated}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {generated.map((g, idx) => {
                  const variant = g.variants[0]
                  const details = templateDetailsById.get(g.template.id)
                  const tmpl = details?.template ?? g.template
                  // Constants explicitly linked to the template win; anything
                  // else the formula references falls back to the global table,
                  // exactly as the generator resolves it.
                  const constants = {
                    ...globalConstants,
                    ...Object.fromEntries(
                      (details?.constants ?? []).map((c) => [c.symbol, c.value]),
                    ),
                  }
                  const optionLabels = ["a", "b", "c", "d", "e"]
                  const hasMultiAnswers = (variant?.answersData?.length ?? 0) > 1
                  const options = generatedMode === "closed" ? (variant?.numericOptions ?? []) : []
                  const sigDigits = tmpl.significantDigits
                  const forceSci = tmpl.forceScientific ?? false
                  // Small-magnitude answers can collapse to identical strings at
                  // the default precision, so widen just enough to keep every
                  // option distinct.
                  const optionsPrecision = resolveOptionsPrecision(options)
                  const correctOption = variant?.correctOption
                  const alternateOption = variant?.alternateOption
                  const equationText = tmpl.equationText?.trim() || tmpl.formula
                  const recomputed =
                    equationText && variant
                      ? evaluateVariantAnswer(
                          equationText,
                          details?.variables ?? [],
                          variant,
                          constants,
                          tmpl.questionText,
                        )
                      : null
                  const hasMismatch =
                    recomputed?.ok &&
                    variant?.correctAnswer != null &&
                    Math.abs(recomputed.value - variant.correctAnswer) > 1e-9

                  return (
                    <div key={g.template.id} className="rounded-lg border p-4 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-muted-foreground">{idx + 1}.</p>
                          <QuestionTextRenderer
                            text={tmpl.questionText}
                            variables={details?.variables ?? []}
                            variant={variant}
                            constants={constants}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRegenerateVariant(g.template.id)}
                          disabled={regeneratingMap[g.template.id]}
                        >
                          {regeneratingMap[g.template.id] ? (
                            <Loader2 className="size-4 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4 mr-2" />
                          )}
                          Rekalkulovat
                        </Button>
                      </div>

                      {generatedMode === "closed" &&
                        (hasMultiAnswers && variant?.answersData ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(() => {
                              const answersData = variant.answersData ?? []
                              // Small-magnitude answers can collapse to identical
                              // strings at the default precision, so widen per
                              // slot just enough to keep every option distinct.
                              const optionsPrecision = answersData.map((a) =>
                                resolveOptionsPrecision(a.numericOptions ?? []),
                              )
                              return answersData[0]?.numericOptions?.map((_, optionIdx) => {
                                const label = optionLabels[optionIdx]
                                const isCorrect =
                                  optionIdx + 1 ===
                                    (answersData[0]?.correctOption ?? correctOption) ||
                                  optionIdx + 1 ===
                                    (answersData[0]?.alternateOption ?? alternateOption)
                                return (
                                  <div
                                    key={label}
                                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                                      isCorrect
                                        ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                                        : "bg-muted/30"
                                    }`}
                                  >
                                    <span
                                      className={`font-semibold ${
                                        isCorrect ? "text-green-700 dark:text-green-300" : ""
                                      }`}
                                    >
                                      {label})
                                    </span>
                                    <span>
                                      {answersData.map((a, idx) => {
                                        const value = a.numericOptions?.[optionIdx]
                                        if (value == null) return null
                                        return (
                                          <span key={a.symbol}>
                                            {idx > 0 && ", "}
                                            <FormattedResult
                                              value={value}
                                              unit={a.unit}
                                              precision={optionsPrecision[idx]}
                                              significantDigits={sigDigits}
                                              forceScientific={forceSci}
                                            />
                                          </span>
                                        )
                                      })}
                                    </span>
                                  </div>
                                )
                              })
                            })()}
                          </div>
                        ) : options.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                            {options.map((value, optionIdx) => {
                              const label = optionLabels[optionIdx]
                              const isCorrect =
                                optionIdx + 1 === correctOption || optionIdx + 1 === alternateOption
                              return (
                                <div
                                  key={label}
                                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                                    isCorrect
                                      ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                                      : "bg-muted/30"
                                  }`}
                                >
                                  <span
                                    className={`font-semibold ${
                                      isCorrect ? "text-green-700 dark:text-green-300" : ""
                                    }`}
                                  >
                                    {label})
                                  </span>
                                  <span>
                                    <FormattedResult
                                      value={value}
                                      unit={tmpl.resultUnit}
                                      precision={optionsPrecision}
                                      significantDigits={sigDigits}
                                      forceScientific={forceSci}
                                    />
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-amber-600">
                            Pro tuto otázku nebyly vygenerovány žádné možnosti.
                          </div>
                        ))}

                      {generatedMode === "open" && (
                        <div className="text-sm text-muted-foreground">
                          {hasMultiAnswers && variant?.answersData ? (
                            <>
                              Správné odpovědi:{" "}
                              {variant.answersData.map((a, idx) => (
                                <span key={a.symbol} className="ml-1">
                                  {idx > 0 && "; "}
                                  {a.symbol} ={" "}
                                  <FormattedResult
                                    value={a.value}
                                    unit={a.unit}
                                    significantDigits={sigDigits}
                                    forceScientific={forceSci}
                                  />
                                  {a.intervalLo != null && a.intervalHi != null && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      (± okolí{" "}
                                      <FormattedResult
                                        value={a.intervalLo}
                                        significantDigits={sigDigits}
                                        forceScientific={forceSci}
                                      />
                                      –
                                      <FormattedResult
                                        value={a.intervalHi}
                                        significantDigits={sigDigits}
                                        forceScientific={forceSci}
                                      />
                                      )
                                    </span>
                                  )}
                                </span>
                              ))}
                            </>
                          ) : (
                            <>
                              Správná odpověď:{" "}
                              <FormattedResult
                                value={recomputed?.ok ? recomputed.value : variant?.correctAnswer}
                                unit={tmpl.resultUnit}
                                significantDigits={sigDigits}
                                forceScientific={forceSci}
                              />
                              {recomputed?.ok && hasMismatch && (
                                <span className="ml-2 text-xs text-amber-600">
                                  (backend: {formatNumberForText(variant?.correctAnswer)})
                                </span>
                              )}
                              {!recomputed?.ok && recomputed?.error && (
                                <span className="ml-2 text-xs text-red-600">
                                  ({recomputed.error})
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </RefreshOverlay>

      {/* Save to Projekt Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{cs.sets.saveToProjekt}</DialogTitle>
            <DialogDescription>{cs.sets.saveToProjektDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="projekt-name" className="text-right">
                Název
              </Label>
              <Input
                id="projekt-name"
                value={projektName}
                onChange={(e) => setProjektName(e.target.value)}
                className="col-span-3"
                placeholder="Název projektu..."
                disabled={savingToProjekt === "saving"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
              disabled={savingToProjekt === "saving"}
            >
              Zrušit
            </Button>
            <Button
              onClick={handleSaveToProjekt}
              disabled={savingToProjekt === "saving" || !projektName.trim()}
            >
              {savingToProjekt === "saving" ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Ukládám...
                </>
              ) : (
                <>
                  <Save className="size-4 mr-2" />
                  Uložit
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closed Question Config Dialog */}
      <Dialog open={showClosedConfigDialog} onOpenChange={setShowClosedConfigDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{cs.sets.configureClosed}</DialogTitle>
            <DialogDescription>{cs.sets.configureClosedDescription}</DialogDescription>
          </DialogHeader>
          {set && set.mode !== "closed" && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
              {cs.sets.modeMismatchWarning
                .replace("{setMode}", cs.sets.openMode)
                .replace("{generateMode}", cs.sets.closedQuestions)}
            </div>
          )}
          <div className="grid gap-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="difficulty">{cs.sets.difficultyLabel}</Label>
              <Select
                value={closedDifficulty}
                onValueChange={(value) =>
                  setId && setGeneration(setId, { closedDifficulty: value as QuestionDifficulty })
                }
              >
                <SelectTrigger id="difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">{cs.sets.closedSpreadEasy}</SelectItem>
                  <SelectItem value="medium">{cs.sets.closedSpreadMedium}</SelectItem>
                  <SelectItem value="hard">{cs.sets.closedSpreadHard}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="option-count">{cs.sets.optionCountLabel}</Label>
              <Select
                value={String(closedOptionCount)}
                onValueChange={(value) =>
                  setId && setGeneration(setId, { closedOptionCount: Number(value) })
                }
              >
                <SelectTrigger id="option-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 (a, b)</SelectItem>
                  <SelectItem value="3">3 (a, b, c)</SelectItem>
                  <SelectItem value="4">4 (a, b, c, d)</SelectItem>
                  <SelectItem value="5">5 (a, b, c, d, e)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowClosedConfigDialog(false)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                setShowClosedConfigDialog(false)
                void handleGenerate("closed", closedDifficulty, closedOptionCount)
              }}
            >
              {isGenerating ? "Generuji…" : cs.common.generate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open question config: difficulty sets the answer tolerance interval */}
      <Dialog open={showOpenConfigDialog} onOpenChange={setShowOpenConfigDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{cs.sets.configureOpen}</DialogTitle>
            <DialogDescription>{cs.sets.configureOpenDescription}</DialogDescription>
          </DialogHeader>
          {set && set.mode !== "open" && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
              {cs.sets.modeMismatchWarning
                .replace("{setMode}", cs.sets.closedMode)
                .replace("{generateMode}", cs.sets.openQuestions)}
            </div>
          )}
          <div className="grid gap-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="open-difficulty">{cs.sets.difficultyLabel}</Label>
              <Select
                value={openDifficulty}
                onValueChange={(value) =>
                  setId && setGeneration(setId, { openDifficulty: value as QuestionDifficulty })
                }
              >
                <SelectTrigger id="open-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">{cs.sets.openToleranceEasy}</SelectItem>
                  <SelectItem value="medium">{cs.sets.openToleranceMedium}</SelectItem>
                  <SelectItem value="hard">{cs.sets.openToleranceHard}</SelectItem>
                  <SelectItem value="very_hard">{cs.sets.openToleranceVeryHard}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowOpenConfigDialog(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                setShowOpenConfigDialog(false)
                void handleGenerate("open", openDifficulty, 5)
              }}
            >
              {isGenerating ? "Generuji…" : cs.common.generate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Question Detail Dialog */}
      {selectedTemplateId && (
        <QuestionDetailDialog
          key={selectedTemplateId}
          templateId={selectedTemplateId}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={() => void refreshTemplate(selectedTemplateId)}
          onDelete={() => {
            setDialogOpen(false)
            void loadData()
          }}
          initialTemplateDetails={templateDetailsById.get(selectedTemplateId)}
          initialConstants={globalConstants}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {templateToDelete && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={() => handleDeleteTemplate(templateToDelete)}
          title={cs.sets.deleteQuestion}
          description={cs.sets.deleteQuestionConfirm.replace(
            "{name}",
            templateToDelete.questionText.slice(0, 50),
          )}
        />
      )}

      {/* Export Variants Dialog */}
      {set && (
        <ExportVariantsDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          templates={templateDetails}
          // What the teacher actually generated wins over the set's configured
          // mode — generating open questions in a closed set and exporting
          // used to silently produce multiple-choice options instead of
          // tolerance intervals.
          mode={generatedMode ?? set.mode}
          closedDifficulty={closedDifficulty}
          closedOptionCount={closedOptionCount}
          openDifficulty={openDifficulty}
        />
      )}

      {/* Add Question Dialog — preselects the current set */}
      {set && (
        <AddQuestionDialog
          open={isAddQuestionOpen}
          onOpenChange={setIsAddQuestionOpen}
          categoriesWithSets={categoriesWithSets}
          preselectedCategoryId={set.categoryId}
          preselectedSetId={set.id}
          onCreated={(templateId) => {
            setSelectedTemplateId(templateId)
            setDialogOpen(true)
            void loadData()
          }}
        />
      )}

      {/* Move Question Dialog */}
      {moveTemplate && set && (
        <MoveQuestionDialog
          open={isMoveDialogOpen}
          onOpenChange={setIsMoveDialogOpen}
          template={moveTemplate}
          currentSetId={set.id}
          categoriesWithSets={categoriesWithSets}
          onMoved={() => {
            setMoveTemplate(null)
            void loadData()
          }}
        />
      )}

      <DeleteConfirmDialog
        open={isDeleteSetDialogOpen}
        onOpenChange={setIsDeleteSetDialogOpen}
        onConfirm={handleDeleteSet}
        title={cs.topics.deleteSet}
        description={
          set
            ? `${cs.topics.deleteSetConfirm} „${set.name || cs.topics.setIndex.replace("{index}", String(set.setIndex))}“`
            : cs.topics.deleteSetConfirm
        }
      />

      <EditSetDialog
        open={isEditSetDialogOpen}
        onOpenChange={setIsEditSetDialogOpen}
        set={set}
        onUpdated={loadData}
      />
    </div>
  )
}
