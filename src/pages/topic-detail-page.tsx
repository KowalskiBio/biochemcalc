import { ArrowLeft, Layers, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { QuestionDetailDialog } from "@/components/questions/question-detail-dialog"
import { AddQuestionDialog } from "@/components/topics/add-question-dialog"
import { AddSetDialog } from "@/components/topics/add-set-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { RefreshOverlay } from "@/components/ui/refresh-overlay"
import { Skeleton } from "@/components/ui/skeleton"
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, categoriesApi, setsApi, templatesApi, topicsApi } from "@/lib/api"
import type { Category, CategoryWithSets, Set, Topic } from "@/lib/types"
import { useCarryStore } from "@/stores/drag-store"

export function TopicDetailPage() {
  const { topicId } = useParams<{ topicId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesWithSets, setCategoriesWithSets] = useState<CategoryWithSets[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAddQuestionOpen, setIsAddQuestionOpen] = useState(false)
  const [isAddSetOpen, setIsAddSetOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [isQuestionDialogOpen, setIsQuestionDialogOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)

  const isCarrying = useCarryStore((s) => s.isCarrying)
  const carryKind = useCarryStore((s) => s.kind)
  const carriedTemplate = useCarryStore((s) => s.template)
  const carriedSet = useCarryStore((s) => s.set)
  const sourceSetId = useCarryStore((s) => s.sourceSetId)
  const endCarry = useCarryStore((s) => s.endCarry)
  const startSetCarry = useCarryStore((s) => s.startSetCarry)

  const justDraggedRef = useRef(false)

  const loadData = useCallback(async () => {
    if (!topicId) return
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const [topicData, catList] = await Promise.all([
        topicsApi.get(topicId),
        categoriesApi.listByTopic(topicId),
      ])
      setTopic(topicData)
      setCategories(catList)
      const withSets = await Promise.all(
        catList.map(async (cat) => {
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
      toast({ title: "Chyba", description: message, variant: "destructive" })
    } finally {
      hasLoadedRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [topicId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = useCallback(async () => {
    if (!topicId) return
    try {
      setIsDeleting(true)
      await topicsApi.delete(topicId)
      toast({ title: cs.topics.deleteSuccess })
      navigate("/topics")
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.deleteError, description: message, variant: "destructive" })
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
    }
  }, [topicId, navigate, toast])

  const handleRenameTopic = useCallback(async () => {
    if (!topicId || !topic) return
    const trimmed = editName.trim()
    if (!trimmed || trimmed === topic.name) {
      setIsEditingName(false)
      return
    }
    try {
      setSavingName(true)
      const updated = await topicsApi.update(topicId, trimmed, topic.forStudents)
      setTopic(updated)
      toast({ title: cs.topics.renameSuccess })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.renameError, description: message, variant: "destructive" })
    } finally {
      setSavingName(false)
      setIsEditingName(false)
    }
  }, [topicId, topic, editName, toast])

  const handleDropSetOnCategory = useCallback(
    async (targetCategoryId: string) => {
      if (!carriedSet) return
      const sourceCatId = categoriesWithSets.find((c) => c.sets.some((s) => s.id === carriedSet.id))
        ?.category.id
      if (sourceCatId === targetCategoryId) {
        endCarry()
        return
      }
      try {
        await setsApi.moveToCategory(carriedSet.id, targetCategoryId)
        toast({ title: cs.topics.moveSetSuccess })
        await loadData()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: cs.topics.moveSetError, description: message, variant: "destructive" })
      } finally {
        endCarry()
      }
    },
    [carriedSet, categoriesWithSets, toast, loadData, endCarry],
  )

  const handleDropQuestionOnSet = useCallback(
    async (targetSetId: string, targetCategoryId: string) => {
      if (!carriedTemplate || !sourceSetId) return
      if (targetSetId === sourceSetId) {
        endCarry()
        return
      }
      try {
        const targetCategory = categoriesWithSets.find((c) => c.category.id === targetCategoryId)
        const targetPointValue = targetCategory?.category.pointValue
        if (targetPointValue != null && targetPointValue !== carriedTemplate.pointValue) {
          const details = await templatesApi.getWithDetails(carriedTemplate.id)
          await templatesApi.updateWithVariables({
            id: carriedTemplate.id,
            questionText: details.template.questionText,
            formula: details.template.formula,
            equationText: details.template.equationText,
            numericAnswer: details.template.numericAnswer,
            resultUnit: details.template.resultUnit,
            pointValue: targetPointValue,
            variableMutations: details.variables.map((vwp) => ({
              action: "keep" as const,
              variableId: vwp.variable.id,
              placeholder: vwp.placeholder,
              greaterThanVariableId: vwp.greaterThanVariableId ?? undefined,
              lessThanVariableId: vwp.lessThanVariableId ?? undefined,
            })),
            constants: details.constants.map((c) => ({ constantId: c.id })),
            constraint: details.constraint ?? undefined,
          })
        }
        await setsApi.removeTemplate(sourceSetId, carriedTemplate.id)
        await setsApi.addTemplate(targetSetId, carriedTemplate.id)
        toast({ title: cs.topics.moveSuccess })
        await loadData()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: cs.topics.moveError, description: message, variant: "destructive" })
      } finally {
        endCarry()
      }
    },
    [carriedTemplate, sourceSetId, categoriesWithSets, toast, loadData, endCarry],
  )

  const handleSetMouseDown = useCallback(
    (e: React.MouseEvent, setObj: Set) => {
      if (e.button !== 0 || isCarrying) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          cleanup()
          justDraggedRef.current = true
          startSetCarry(setObj)
        }
      }
      const handleUp = () => cleanup()
      const cleanup = () => {
        document.removeEventListener("mousemove", handleMove)
        document.removeEventListener("mouseup", handleUp)
      }
      document.addEventListener("mousemove", handleMove)
      document.addEventListener("mouseup", handleUp)
    },
    [isCarrying, startSetCarry],
  )

  const modeLabel = (mode: string) =>
    mode === "closed" ? cs.topics.mode.closed : cs.topics.mode.open

  const modeVariant = (mode: string) =>
    mode === "closed" ? ("secondary" as const) : ("default" as const)

  const isCarryingQuestion = isCarrying && carryKind === "question"
  const isCarryingSet = isCarrying && carryKind === "set"

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
            <Skeleton className="h-4 w-24 mt-1" />
          </div>
        </div>
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-20 mt-1" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((j) => (
                  <Skeleton key={j} className="h-20 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!topic) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Téma nenalezeno.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/topics">Zpět na témata</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/topics">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div>
          {isEditingName ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameTopic}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameTopic()
                if (e.key === "Escape") setIsEditingName(false)
              }}
              disabled={savingName}
              autoFocus
              className="text-2xl font-semibold h-auto py-0"
            />
          ) : (
            <h1
              className="text-2xl font-semibold tracking-tight text-foreground cursor-pointer hover:ring-2 hover:ring-primary/30 rounded px-1 -mx-1"
              onClick={() => {
                setEditName(topic.name)
                setIsEditingName(true)
              }}
            >
              {topic.name}
              <Pencil className="size-3 inline ml-2 text-muted-foreground opacity-0 hover:opacity-100" />
            </h1>
          )}
          <p className="text-muted-foreground text-sm">
            {categories.length} {cs.topics.categories.toLowerCase()}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setIsAddSetOpen(true)}>
            <Plus className="size-4 mr-2" />
            {cs.topics.addSet}
          </Button>
          <Button onClick={() => setIsAddQuestionOpen(true)}>
            <Plus className="size-4 mr-2" />
            {cs.topics.addQuestion}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isDeleting}
          >
            <Trash2 className="size-4 mr-2" />
            {cs.common.delete}
          </Button>
        </div>
      </div>

      <RefreshOverlay isRefreshing={isRefreshing}>
        <div className="space-y-6">
          {categoriesWithSets
            .sort((a, b) => a.category.pointValue - b.category.pointValue)
            .map(({ category, sets }) => {
              const isDropTarget = isCarryingSet && hoveredCategory === category.id
              return (
                <Card
                  key={category.id}
                  className={`transition-colors ${
                    isDropTarget
                      ? "border-primary border-2 ring-2 ring-primary/40 bg-primary/5"
                      : isCarryingSet
                        ? "border-dashed"
                        : ""
                  }`}
                  onMouseEnter={() => {
                    if (isCarryingSet) setHoveredCategory(category.id)
                  }}
                  onMouseLeave={() => {
                    if (isCarryingSet) setHoveredCategory(null)
                  }}
                  onMouseUp={() => {
                    if (isCarryingSet) {
                      void handleDropSetOnCategory(category.id)
                    }
                  }}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="size-5 text-primary" />
                      <span>
                        {cs.topics.pointValue.replace("{value}", String(category.pointValue))}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {sets.length} {cs.topics.sets.toLowerCase()}
                      {isDropTarget && (
                        <span className="text-primary font-medium ml-2">— pusťte sem</span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {sets
                        .sort((a, b) => a.setIndex - b.setIndex)
                        .map((set) => {
                          const setLabel =
                            set.name || cs.topics.setIndex.replace("{index}", String(set.setIndex))
                          const isBeingCarried = isCarryingSet && carriedSet?.id === set.id
                          return (
                            <div
                              key={set.id}
                              onMouseDown={(e) => handleSetMouseDown(e, set)}
                              onMouseUp={() => {
                                if (isCarryingQuestion) {
                                  void handleDropQuestionOnSet(set.id, category.id)
                                }
                              }}
                            >
                              {isCarryingQuestion ? (
                                <Card className="cursor-pointer transition-colors border-primary border-2 border-dashed hover:bg-primary/5">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-sm truncate">
                                        {setLabel}
                                      </span>
                                      <Badge variant={modeVariant(set.mode)}>
                                        {modeLabel(set.mode)}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-primary mt-2 text-center">
                                      {cs.topics.dropQuestionHere}
                                    </p>
                                  </CardContent>
                                </Card>
                              ) : (
                                <Card
                                  className={`cursor-pointer hover:border-primary transition-colors ${
                                    isBeingCarried ? "opacity-40 border-primary" : ""
                                  } ${isCarryingSet && !isBeingCarried ? "border-dashed" : ""}`}
                                  onClick={() => {
                                    if (justDraggedRef.current) {
                                      justDraggedRef.current = false
                                      return
                                    }
                                    if (isCarrying) return
                                    navigate(`/sets/${set.id}`)
                                  }}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-sm truncate">
                                        {setLabel}
                                      </span>
                                      <Badge variant={modeVariant(set.mode)}>
                                        {modeLabel(set.mode)}
                                      </Badge>
                                    </div>
                                  </CardContent>
                                </Card>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
        </div>
      </RefreshOverlay>

      {topic && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={handleDelete}
          title={cs.topics.deleteTopic}
          description={cs.topics.deleteTopicConfirm.replace("{name}", topic.name)}
        />
      )}

      <AddQuestionDialog
        open={isAddQuestionOpen}
        onOpenChange={setIsAddQuestionOpen}
        categoriesWithSets={categoriesWithSets}
        onCreated={(templateId) => {
          setEditingTemplateId(templateId)
          setIsQuestionDialogOpen(true)
        }}
      />

      <AddSetDialog
        open={isAddSetOpen}
        onOpenChange={setIsAddSetOpen}
        categoriesWithSets={categoriesWithSets}
        onCreated={() => loadData()}
      />

      {editingTemplateId && (
        <QuestionDetailDialog
          templateId={editingTemplateId}
          open={isQuestionDialogOpen}
          onClose={() => {
            setIsQuestionDialogOpen(false)
            setEditingTemplateId(null)
          }}
          onDelete={() => {
            setIsQuestionDialogOpen(false)
            setEditingTemplateId(null)
          }}
        />
      )}
    </div>
  )
}
