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
import { studentApi } from "@/lib/student-api"

interface ReportQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  attemptId: string
}

export function ReportQuestionDialog({ open, onOpenChange, attemptId }: ReportQuestionDialogProps) {
  const { toast } = useToast()
  const [message, setMessage] = useState("")
  const [isSending, setIsSending] = useState(false)

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (trimmed.length === 0) return

    setIsSending(true)
    try {
      await studentApi.reportQuestion({ attemptId, message: trimmed })
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
