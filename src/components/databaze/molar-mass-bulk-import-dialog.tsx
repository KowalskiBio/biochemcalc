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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { cs } from "@/i18n/cs"
import { type BulkImportEntry, parseMolarMassBulkImport } from "@/lib/molar-mass-import-parser"

export type { BulkImportEntry }

interface MolarMassBulkImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (entries: BulkImportEntry[]) => void
  atomicWeights?: Record<string, number>
}

export function MolarMassBulkImportDialog({
  open,
  onOpenChange,
  onSubmit,
  atomicWeights,
}: MolarMassBulkImportDialogProps) {
  const [text, setText] = useState("")
  const [errors, setErrors] = useState<string[]>([])

  const handleSubmit = useCallback(() => {
    const { entries, errors: parseErrors } = parseMolarMassBulkImport(text, atomicWeights)
    if (parseErrors.length > 0) {
      setErrors(parseErrors)
      return
    }
    onSubmit(entries)
    setText("")
    setErrors([])
  }, [atomicWeights, onSubmit, text])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setText("")
        setErrors([])
      }
      onOpenChange(open)
    },
    [onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{cs.databaze.atomicWeights.bulkImportTitle}</DialogTitle>
          <DialogDescription>{cs.databaze.atomicWeights.bulkImportDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-import-molar-masses">
              {cs.databaze.atomicWeights.bulkImportTitle}
            </Label>
            <Textarea
              id="bulk-import-molar-masses"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={cs.databaze.atomicWeights.bulkImportPlaceholder}
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          {errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">
                {cs.databaze.atomicWeights.bulkImportErrors}
              </p>
              <ul className="text-sm text-destructive space-y-1 list-disc pl-4">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleSubmit}>{cs.common.import}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
