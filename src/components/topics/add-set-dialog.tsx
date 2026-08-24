import { Loader2, Plus } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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

type SetType = "normal" | "aggregate"

interface AddSetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoriesWithSets: CategoryWithSets[]
  onCreated: () => void
}

const modeLabel = (mode: TemplateMode) =>
  mode === "closed" ? cs.topics.mode.closed : cs.topics.mode.open

const modeVariant = (mode: TemplateMode) =>
  mode === "closed" ? ("secondary" as const) : ("default" as const)

export function AddSetDialog({
  open,
  onOpenChange,
  categoriesWithSets,
  onCreated,
}: AddSetDialogProps) {
  const { toast } = useToast()
  const [setType, setSetType] = useState<SetType>("normal")
  const [name, setName] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<TemplateMode>("closed")
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const sortedCategories = useMemo(
    () => [...categoriesWithSets].sort((a, b) => a.category.pointValue - b.category.pointValue),
    [categoriesWithSets],
  )

  const sourceSets = useMemo(() => {
    const entry = categoriesWithSets.find((c) => c.category.id === selectedCategoryId)
    return entry ? [...entry.sets].sort((a, b) => a.setIndex - b.setIndex) : []
  }, [categoriesWithSets, selectedCategoryId])

  const reset = useCallback(() => {
    setSetType("normal")
    setName("")
    setSelectedCategoryId(undefined)
    setMode("closed")
    setSelectedSourceIds([])
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  const handleCategoryChange = useCallback((id: string) => {
    setSelectedCategoryId(id)
    setSelectedSourceIds([])
  }, [])

  const toggleSource = useCallback((id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }, [])

  const canCreate = !!selectedCategoryId && (setType === "normal" || selectedSourceIds.length > 0)

  const handleCreate = useCallback(async () => {
    if (!selectedCategoryId) return
    const trimmed = name.trim()
    try {
      setIsCreating(true)
      if (setType === "aggregate") {
        // Deterministic union order: by set_index, not by click order.
        const orderedIds = sourceSets
          .filter((s) => selectedSourceIds.includes(s.id))
          .map((s) => s.id)
        await setsApi.createAggregate(selectedCategoryId, mode, trimmed || null, orderedIds)
      } else {
        await setsApi.create(selectedCategoryId, mode, trimmed || null)
      }
      toast({ title: cs.topics.createSetSuccess })
      handleClose(false)
      onCreated()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.createSetError, description: message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }, [
    selectedCategoryId,
    setType,
    name,
    mode,
    selectedSourceIds,
    sourceSets,
    toast,
    handleClose,
    onCreated,
  ])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.addSetTitle}</DialogTitle>
          <DialogDescription>
            {setType === "aggregate"
              ? cs.topics.addSetAggregateDescription
              : cs.topics.addSetDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.setTypeLabel}</Label>
            <div className="col-span-3">
              <Select
                value={setType}
                onValueChange={(v) => setSetType(v as SetType)}
                disabled={isCreating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">{cs.topics.setTypeNormal}</SelectItem>
                  <SelectItem value="aggregate">{cs.topics.setTypeAggregate}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.selectCategory}</Label>
            <div className="col-span-3">
              <Select
                value={selectedCategoryId ?? ""}
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

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="set-name" className="text-right">
              {cs.topics.setNameLabel}
            </Label>
            <Input
              id="set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder={cs.topics.setNamePlaceholder}
              disabled={isCreating}
            />
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

          {setType === "aggregate" && selectedCategoryId && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right pt-2">{cs.topics.selectSourceSets}</Label>
              <div className="col-span-3">
                {sourceSets.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{cs.topics.noSourceSets}</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                    {sourceSets.map((s) => {
                      const selected = selectedSourceIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={isCreating}
                          onClick={() => toggleSource(s.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                            selected
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted/60"
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className={`size-4 shrink-0 rounded-sm border flex items-center justify-center text-[10px] ${
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border"
                              }`}
                            >
                              {selected ? "✓" : ""}
                            </span>
                            <span className="truncate">
                              {s.name || cs.topics.setIndex.replace("{index}", String(s.setIndex))}
                            </span>
                          </span>
                          <Badge variant={modeVariant(s.mode)}>{modeLabel(s.mode)}</Badge>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isCreating}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !canCreate}>
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
