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
import { Textarea } from "@/components/ui/textarea"

import { cs } from "@/i18n/cs"
import type { DatabazeEntry } from "@/lib/types"

interface DatabazeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (entry: Omit<DatabazeEntry, "id" | "createdAt">) => void
  title: string
  confirmText: string
  initialValues?: Partial<Omit<DatabazeEntry, "id" | "createdAt">>
  existingCodes: string[]
}

export function DatabazeDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  confirmText,
  initialValues,
  existingCodes,
}: DatabazeDialogProps) {
  const [formData, setFormData] = useState<Partial<Omit<DatabazeEntry, "id" | "createdAt">>>({
    code: "",
    values: [],
  })
  const [valuesText, setValuesText] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setFormData({
        code: initialValues?.code ?? "",
        values: initialValues?.values ?? [],
      })
      setValuesText((initialValues?.values ?? []).join(", "))
      setErrors({})
    }
  }, [open, initialValues])

  const handleChange = useCallback(
    (key: "code", value: string) => {
      setFormData((prev) => ({ ...prev, [key]: value }))
      if (errors[key]) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    },
    [errors],
  )

  const handleValuesChange = useCallback(
    (value: string) => {
      setValuesText(value)
      const parsed = value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
      setFormData((prev) => ({ ...prev, values: parsed }))
      if (errors.values) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next.values
          return next
        })
      }
    },
    [errors],
  )

  const validate = useCallback(() => {
    const newErrors: Record<string, string> = {}
    const code = formData.code?.trim() ?? ""

    if (!code) {
      newErrors.code = cs.databaze.validation.codeRequired
    } else if (existingCodes.includes(code)) {
      newErrors.code = cs.databaze.validation.codeUnique
    }

    if (!formData.values || formData.values.length === 0) {
      newErrors.values = cs.databaze.validation.valuesRequired
    }

    return newErrors
  }, [formData.code, formData.values, existingCodes])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      const newErrors = validate()
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      onSubmit({
        code: formData.code?.trim() ?? "",
        values: formData.values ?? [],
      })
    },
    [formData, onSubmit, validate],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{cs.databaze.pageDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="code">{cs.databaze.form.code}</Label>
            <Input
              id="code"
              value={formData.code ?? ""}
              onChange={(e) => handleChange("code", e.target.value)}
              className="w-full"
              placeholder={cs.databaze.form.codePlaceholder}
            />
            {errors.code && <p className="text-sm text-destructive">{errors.code}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="values">{cs.databaze.form.values}</Label>
            <Textarea
              id="values"
              value={valuesText}
              onChange={(e) => handleValuesChange(e.target.value)}
              className="w-full min-h-[100px]"
              placeholder={cs.databaze.form.valuesPlaceholder}
            />
            <p className="text-xs text-muted-foreground">{cs.databaze.form.valuesHelp}</p>
            {errors.values && <p className="text-sm text-destructive">{errors.values}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {cs.common.cancel}
            </Button>
            <Button type="submit">{confirmText}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
