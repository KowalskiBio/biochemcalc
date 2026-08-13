import { Loader2, Plus } from "lucide-react"
import { useCallback, useState } from "react"

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

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, topicGroupsApi } from "@/lib/api"
import type { TopicGroup } from "@/lib/types"

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (group: TopicGroup) => void
}

export function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const reset = useCallback(() => {
    setName("")
  }, [])

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next)
      if (!next) reset()
    },
    [onOpenChange, reset],
  )

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return
    try {
      setIsCreating(true)
      const group = await topicGroupsApi.create(name.trim())
      toast({ title: cs.topics.createGroupSuccess })
      handleClose(false)
      onCreated(group)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.createGroupError, description: message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }, [name, toast, handleClose, onCreated])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.createGroupTitle}</DialogTitle>
          <DialogDescription>{cs.topics.createGroupDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="group-name" className="text-right">
              {cs.topics.groupNameLabel}
            </Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder={cs.topics.groupNamePlaceholder}
              disabled={isCreating}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isCreating && name.trim()) {
                  void handleCreate()
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isCreating}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {cs.topics.creatingGroup}
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
