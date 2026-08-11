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

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, setsApi } from "@/lib/api"
import type { CategoryWithSets, TemplateMode } from "@/lib/types"

interface AddSetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoriesWithSets: CategoryWithSets[]
  onCreated: () => void
}

export function AddSetDialog({
  open,
  onOpenChange,
  categoriesWithSets,
  onCreated,
}: AddSetDialogProps) {
  const { toast } = useToast()
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<TemplateMode>("closed")
  const [isCreating, setIsCreating] = useState(false)

  const sortedCategories = useMemo(
    () => [...categoriesWithSets].sort((a, b) => a.category.pointValue - b.category.pointValue),
    [categoriesWithSets],
  )

  const reset = useCallback(() => {
    setSelectedCategoryId(undefined)
    setMode("closed")
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  const handleCreate = useCallback(async () => {
    if (!selectedCategoryId) return
    try {
      setIsCreating(true)
      await setsApi.create(selectedCategoryId, mode)
      toast({ title: cs.topics.createSetSuccess })
      handleClose(false)
      onCreated()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.createSetError, description: message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }, [selectedCategoryId, mode, toast, handleClose, onCreated])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.addSetTitle}</DialogTitle>
          <DialogDescription>{cs.topics.addSetDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.selectCategory}</Label>
            <div className="col-span-3">
              <Select
                value={selectedCategoryId ?? ""}
                onValueChange={setSelectedCategoryId}
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

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.setModeLabel}</Label>
            <div className="col-span-3">
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as TemplateMode)}
                disabled={isCreating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">{cs.topics.mode.closed}</SelectItem>
                  <SelectItem value="open">{cs.topics.mode.open}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isCreating}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !selectedCategoryId}>
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
