import { Loader2, Plus } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, setsApi, templatesApi } from "@/lib/api"
import type { CategoryWithSets } from "@/lib/types"

interface AddQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoriesWithSets: CategoryWithSets[]
  preselectedCategoryId?: string
  preselectedSetId?: string
  onCreated: (templateId: string) => void
}

export function AddQuestionDialog({
  open,
  onOpenChange,
  categoriesWithSets,
  preselectedCategoryId,
  preselectedSetId,
  onCreated,
}: AddQuestionDialogProps) {
  const { toast } = useToast()
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined)
  const [selectedSetId, setSelectedSetId] = useState<string | undefined>(undefined)
  const [questionText, setQuestionText] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const sortedCategories = useMemo(
    () =>
      [...categoriesWithSets].sort((a, b) => a.category.pointValue - b.category.pointValue),
    [categoriesWithSets],
  )

  const activeCategoryId = preselectedCategoryId ?? selectedCategoryId
  const activeSetId = preselectedSetId ?? selectedSetId
  const activeCategory = sortedCategories.find((c) => c.category.id === activeCategoryId)
  const activeSets = useMemo(
    () => (activeCategory ? [...activeCategory.sets].sort((a, b) => a.setIndex - b.setIndex) : []),
    [activeCategory],
  )

  const reset = useCallback(() => {
    setSelectedCategoryId(undefined)
    setSelectedSetId(undefined)
    setQuestionText("")
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  const handleCategoryChange = useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId)
    setSelectedSetId(undefined)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!activeCategoryId || !activeSetId || !questionText.trim()) return
    const category = sortedCategories.find((c) => c.category.id === activeCategoryId)
    if (!category) return

    try {
      setIsCreating(true)
      const template = await templatesApi.create({
        questionText: questionText.trim(),
        formula: "",
        equationText: "",
        resultUnit: "",
        pointValue: category.category.pointValue,
        variables: [],
        constants: [],
        constraint: undefined,
      })
      await setsApi.addTemplate(activeSetId, template.id)
      toast({ title: cs.topics.addQuestion })
      handleClose(false)
      onCreated(template.id)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.createTopicError, description: message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }, [activeCategoryId, activeSetId, questionText, sortedCategories, toast, handleClose, onCreated])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.addQuestionTitle}</DialogTitle>
          <DialogDescription>{cs.topics.addQuestionDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!preselectedCategoryId && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{cs.topics.selectCategory}</Label>
              <div className="col-span-3">
                <Select
                  value={activeCategoryId ?? ""}
                  onValueChange={handleCategoryChange}
                  disabled={isCreating}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={cs.topics.selectCategory} />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedCategories.map(({ category }) => (
                      <SelectItem key={category.id} value={category.id}>
                        {cs.topics.pointValue.replace("{value}", String(category.pointValue))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!preselectedSetId && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{cs.topics.selectSet}</Label>
              <div className="col-span-3">
                <Select
                  value={activeSetId ?? ""}
                  onValueChange={setSelectedSetId}
                  disabled={isCreating || !activeCategoryId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={cs.topics.selectSet} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSets.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {cs.topics.setIndex.replace("{index}", String(set.setIndex))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="question-text" className="text-right pt-2">
              {cs.topics.questionTextLabel}
            </Label>
            <Textarea
              id="question-text"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              className="col-span-3"
              placeholder={cs.topics.questionTextPlaceholder}
              rows={4}
              disabled={isCreating}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isCreating}>
            {cs.common.cancel}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !questionText.trim() || !activeSetId}
          >
            {isCreating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {cs.topics.creatingTopic}
              </>
            ) : (
              <>
                <Plus className="size-4 mr-2" />
                {cs.common.create}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
