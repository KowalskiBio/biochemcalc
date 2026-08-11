import { ArrowRightLeft, Loader2 } from "lucide-react"
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

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, setsApi, templatesApi } from "@/lib/api"
import type {
  CategoryWithSets,
  Template,
  UpdateTemplateWithVariablesPayload,
  VariableMutation,
} from "@/lib/types"

interface MoveQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: Template
  currentSetId: string
  categoriesWithSets: CategoryWithSets[]
  onMoved: () => void
}

export function MoveQuestionDialog({
  open,
  onOpenChange,
  template,
  currentSetId,
  categoriesWithSets,
  onMoved,
}: MoveQuestionDialogProps) {
  const { toast } = useToast()
  const [targetCategoryId, setTargetCategoryId] = useState<string | undefined>(undefined)
  const [targetSetId, setTargetSetId] = useState<string | undefined>(undefined)
  const [isMoving, setIsMoving] = useState(false)

  const sortedCategories = useMemo(
    () => [...categoriesWithSets].sort((a, b) => a.category.pointValue - b.category.pointValue),
    [categoriesWithSets],
  )

  const currentCategory = sortedCategories.find((c) => c.sets.some((s) => s.id === currentSetId))
  const currentPointValue = currentCategory?.category.pointValue ?? template.pointValue

  const targetCategory = sortedCategories.find((c) => c.category.id === targetCategoryId)
  const targetSets = useMemo(
    () => (targetCategory ? [...targetCategory.sets].sort((a, b) => a.setIndex - b.setIndex) : []),
    [targetCategory],
  )

  const isSameSet = targetSetId === currentSetId
  const isPointValueChanged =
    targetCategory != null && targetCategory.category.pointValue !== currentPointValue

  const reset = useCallback(() => {
    setTargetCategoryId(undefined)
    setTargetSetId(undefined)
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  const handleCategoryChange = useCallback((categoryId: string) => {
    setTargetCategoryId(categoryId)
    setTargetSetId(undefined)
  }, [])

  const handleMove = useCallback(async () => {
    if (!targetSetId || !targetCategoryId) return
    if (isSameSet) return

    try {
      setIsMoving(true)

      if (isPointValueChanged && targetCategory) {
        const details = await templatesApi.getWithDetails(template.id)
        const variableMutations: VariableMutation[] = details.variables.map((vwp) => ({
          action: "keep",
          variableId: vwp.variable.id,
          placeholder: vwp.placeholder,
          greaterThanVariableId: vwp.greaterThanVariableId ?? undefined,
          lessThanVariableId: vwp.lessThanVariableId ?? undefined,
        }))

        const payload: UpdateTemplateWithVariablesPayload = {
          id: template.id,
          questionText: details.template.questionText,
          formula: details.template.formula,
          equationText: details.template.equationText,
          numericAnswer: details.template.numericAnswer,
          resultUnit: details.template.resultUnit,
          pointValue: targetCategory.category.pointValue,
          variableMutations,
          constants: details.constants.map((c) => ({ constantId: c.id })),
          constraint: details.constraint ?? undefined,
        }
        await templatesApi.updateWithVariables(payload)
      }

      await setsApi.removeTemplate(currentSetId, template.id)
      await setsApi.addTemplate(targetSetId, template.id)

      toast({ title: cs.topics.moveSuccess })
      handleClose(false)
      onMoved()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.moveError, description: message, variant: "destructive" })
    } finally {
      setIsMoving(false)
    }
  }, [
    targetSetId,
    targetCategoryId,
    isSameSet,
    isPointValueChanged,
    targetCategory,
    template,
    currentSetId,
    toast,
    handleClose,
    onMoved,
  ])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.moveQuestionTitle}</DialogTitle>
          <DialogDescription>{cs.topics.moveQuestionDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.targetCategory}</Label>
            <div className="col-span-3">
              <Select
                value={targetCategoryId ?? ""}
                onValueChange={handleCategoryChange}
                disabled={isMoving}
              >
                <SelectTrigger>
                  <SelectValue placeholder={cs.topics.selectCategory} />
                </SelectTrigger>
                <SelectContent>
                  {sortedCategories.map(({ category }) => (
                    <SelectItem key={category.id} value={category.id}>
                      {cs.topics.pointValue.replace("{value}", String(category.pointValue))}
                      {category.pointValue === currentPointValue ? " (aktuální)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.targetSet}</Label>
            <div className="col-span-3">
              <Select
                value={targetSetId ?? ""}
                onValueChange={setTargetSetId}
                disabled={isMoving || !targetCategoryId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={cs.topics.selectSet} />
                </SelectTrigger>
                <SelectContent>
                  {targetSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      {cs.topics.setIndex.replace("{index}", String(set.setIndex))}
                      {set.id === currentSetId ? " (aktuální)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isSameSet && targetSetId && (
            <p className="text-sm text-amber-600 col-span-4 text-center">
              {cs.topics.sameSetWarning}
            </p>
          )}
          {isPointValueChanged && targetCategory && (
            <p className="text-sm text-muted-foreground col-span-4 text-center">
              Bodová hodnota se změní z {currentPointValue}b na {targetCategory.category.pointValue}
              b.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isMoving}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleMove} disabled={isMoving || !targetSetId || isSameSet}>
            {isMoving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {cs.topics.creatingTopic}
              </>
            ) : (
              <>
                <ArrowRightLeft className="size-4 mr-2" />
                {cs.common.confirm}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
