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
import { ApiError, categoriesApi, topicsApi } from "@/lib/api"
import type { Topic } from "@/lib/types"

interface CreateTopicDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (topic: Topic) => void
}

export function CreateTopicDialog({ open, onOpenChange, onCreated }: CreateTopicDialogProps) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [forStudents, setForStudents] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const reset = useCallback(() => {
    setName("")
    setForStudents(false)
    setIsTest(false)
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
      const topic = await topicsApi.create({
        name: name.trim(),
        forStudents,
        isTest,
      })
      await Promise.all(
        [2, 3, 4].map((pv) => categoriesApi.create({ topicId: topic.id, pointValue: pv })),
      )
      toast({ title: cs.topics.createTopicSuccess })
      handleClose(false)
      onCreated(topic)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.createTopicError, description: message, variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }, [name, forStudents, isTest, toast, handleClose, onCreated])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.topics.createTopicTitle}</DialogTitle>
          <DialogDescription>{cs.topics.createTopicDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="topic-name" className="text-right">
              {cs.topics.topicNameLabel}
            </Label>
            <Input
              id="topic-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder={cs.topics.topicNamePlaceholder}
              disabled={isCreating}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isCreating && name.trim()) {
                  void handleCreate()
                }
              }}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="for-students" className="text-right">
              {cs.topics.forStudentsLabel}
            </Label>
            <button
              type="button"
              id="for-students"
              disabled={isCreating}
              onClick={() => setForStudents((v) => !v)}
              className={`col-span-3 flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-colors w-fit ${
                forStudents
                  ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              {forStudents ? "✓ " : ""}
              {cs.topics.forStudentsHelp}
            </button>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="is-test" className="text-right">
              {cs.topics.testLabelOn}
            </Label>
            <button
              type="button"
              id="is-test"
              disabled={isCreating}
              onClick={() => setIsTest((v) => !v)}
              className={`col-span-3 flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-colors w-fit ${
                isTest
                  ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              {isTest ? "✓ " : ""}
              {cs.topics.testHelp}
            </button>
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
