import { Loader2, Save } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

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
import type { Set as SetModel, TemplateMode } from "@/lib/types"

interface EditSetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  set: SetModel | null
  onUpdated: () => void
}

/**
 * Edits a set's own attributes — name and mode — as opposed to its contents
 * (templates) or its category. Both fields are always saved together on
 * submit; `SetRepo::update_name`/`update_mode` are each idempotent no-ops
 * when the value hasn't actually changed, so there's no need to track which
 * field was touched.
 */
export function EditSetDialog({ open, onOpenChange, set, onUpdated }: EditSetDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [mode, setMode] = useState<TemplateMode>("closed")
  const [isSaving, setIsSaving] = useState(false)

  // Re-seed the form from the current set every time the dialog opens —
  // it may have been edited (e.g. via the inline title rename) since the
  // last time this dialog was open.
  useEffect(() => {
    if (open && set) {
      setName(set.name ?? "")
      setMode(set.mode)
    }
  }, [open, set])

  const handleClose = useCallback(
    (next: boolean) => {
      if (!isSaving) onOpenChange(next)
    },
    [isSaving, onOpenChange],
  )

  const handleSave = useCallback(async () => {
    if (!set) return
    const trimmed = name.trim()
    try {
      setIsSaving(true)
      await setsApi.updateName(set.id, trimmed || null)
      await setsApi.updateMode({ setId: set.id, mode })
      toast({ title: cs.topics.updateSetSuccess })
      onOpenChange(false)
      onUpdated()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.updateSetError, description: message, variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }, [set, name, mode, toast, onOpenChange, onUpdated])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.editSetTitle}</DialogTitle>
          <DialogDescription>{cs.topics.editSetDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="edit-set-name" className="text-right">
              {cs.topics.setNameLabel}
            </Label>
            <Input
              id="edit-set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder={cs.topics.setNamePlaceholder}
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{cs.topics.setModeLabel}</Label>
            <div className="col-span-3">
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as TemplateMode)}
                disabled={isSaving}
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
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isSaving}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
