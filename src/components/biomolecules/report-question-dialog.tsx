import { Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"

interface BiomoleculeReportQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Wired by the page: freeze the snapshot and call the report endpoint. */
  onSubmit: (message: string) => Promise<void>
}

/**
 * "Report a broken question" dialog for the Biomolecule quiz and streak. The
 * page owns the question identity and snapshot; this component only collects
 * the message, toasts success/backend error text, and clears on close.
 */
export function BiomoleculeReportQuestionDialog({
  open,
  onOpenChange,
  onSubmit,
}: BiomoleculeReportQuestionDialogProps) {
  const { toast } = useToast()
  const [message, setMessage] = useState("")
  const [isSending, setIsSending] = useState(false)

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (trimmed.length === 0) return

    setIsSending(true)
    try {
      await onSubmit(trimmed)
      toast({ title: cs.student.reportSuccess })
      setMessage("")
      onOpenChange(false)
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.student.reportError),
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMessage("")
    }
    onOpenChange(nextOpen)
  }

  const canSubmit = message.trim().length > 0 && !isSending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cs.student.reportTitle}</DialogTitle>
          <DialogDescription>{cs.student.reportPrompt}</DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder={cs.student.reportPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isSending}
          className="min-h-[100px]"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {cs.student.reportSending}
              </>
            ) : (
              cs.student.reportSubmit
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
