import { cva } from "class-variance-authority"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

// Import shadcn/ui components
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
// Czech translations
import { cs } from "@/i18n/cs"
import { validateConstantInput } from "@/lib/api"
// Import types
import type { Constant, ConstantInput } from "@/lib/types"
import { cn, required } from "@/lib/utils"

interface ConstantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ConstantInput) => void
  title: string
  confirmText: string
  initialValues?: Partial<Constant>
}

const formInputVariants = cva("w-full")

const unitSuggestions = [
  "g",
  "mg",
  "kg",
  "L",
  "mL",
  "uL",
  "mol",
  "mol/L",
  "L/mol",
  "mmol",
  "M",
  "mM",
  "uM",
  "J",
  "kJ",
  "cal",
  "kcal",
  "s",
  "min",
  "h",
  "C",
  "K",
  "kPa",
  "atm",
  "mmHg",
]

export function ConstantDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  confirmText,
  initialValues,
}: ConstantDialogProps) {
  const [formData, setFormData] = useState<Partial<ConstantInput>>({
    name: "",
    symbol: "",
    value: 0,
    unit: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Initialize form with initial values
  useEffect(() => {
    if (initialValues) {
      setFormData({
        name: initialValues.name ?? "",
        symbol: initialValues.symbol ?? "",
        value: initialValues.value ?? 0,
        unit: initialValues.unit ?? "",
      })
    }
  }, [initialValues])

  // Reset errors when dialog closes
  useEffect(() => {
    if (!open) {
      setErrors({})
    }
  }, [open])

  const handleChange = useCallback(
    <K extends keyof ConstantInput>(key: K, value: ConstantInput[K]) => {
      setFormData((prev) => ({ ...prev, [key]: value }))
      // Clear error when user types
      if (errors[key as string]) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next[key as string]
          return next
        })
      }
    },
    [errors],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      // Validate form using API validation
      const validationErrors = validateConstantInput(formData as ConstantInput)

      if (validationErrors.length > 0) {
        const errorMap: Record<string, string> = {}
        validationErrors.forEach((error) => {
          const field = error.split(" ")[0].toLowerCase()
          errorMap[field] = error
        })
        setErrors(errorMap)
        return
      }

      // Validate required fields
      const newErrors: Record<string, string> = {}
      if (!formData.name?.trim()) {
        newErrors.name = cs.validation.required
      }
      if (!formData.symbol?.trim()) {
        newErrors.symbol = cs.validation.required
      }
      if (formData.value === undefined || Number.isNaN(formData.value)) {
        newErrors.value = cs.validation.required
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      // Submit all required fields
      onSubmit({
        name: required(formData.name, "name"),
        symbol: required(formData.symbol, "symbol"),
        value: required(formData.value, "value"),
        unit: required(formData.unit, "unit"),
      })
    },
    [formData, onSubmit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {title.includes(cs.common.edit)
              ? cs.constants.editConstant
              : cs.constants.createConstant}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">{cs.form.name}</Label>
            <Input
              id="name"
              value={formData.name ?? ""}
              onChange={(e) => handleChange("name", e.target.value)}
              className={cn(formInputVariants())}
              placeholder={cs.form.namePlaceholder}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="symbol">{cs.form.symbol}</Label>
            <Input
              id="symbol"
              value={formData.symbol ?? ""}
              onChange={(e) => handleChange("symbol", e.target.value)}
              className={cn(formInputVariants())}
              placeholder={cs.form.symbolPlaceholder}
            />
            {errors.symbol && <p className="text-sm text-destructive">{errors.symbol}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="value">{cs.form.value}</Label>
            <Input
              id="value"
              type="number"
              value={formData.value ?? 0}
              onChange={(e) => handleChange("value", parseFloat(e.target.value) || 0)}
              className={cn(formInputVariants())}
              placeholder={cs.form.valuePlaceholder}
              step="any"
            />
            {errors.value && <p className="text-sm text-destructive">{errors.value}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit">{cs.form.unit}</Label>
            <Input
              id="unit"
              value={formData.unit ?? ""}
              onChange={(e) => handleChange("unit", e.target.value)}
              className={cn(formInputVariants())}
              placeholder={cs.form.unitPlaceholder}
              list="constant-unit-suggestions"
            />
            <datalist id="constant-unit-suggestions">
              {unitSuggestions.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleSubmit}>{confirmText}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
