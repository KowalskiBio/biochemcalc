import { cva } from "class-variance-authority"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DecimalInput } from "@/components/ui/decimal-input"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// Czech translations
import { cs } from "@/i18n/cs"
import { validateVariableInput } from "@/lib/api"
// Import types
import type { Variable, VariableInput } from "@/lib/types"
import { cn, required } from "@/lib/utils"

interface VariableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: VariableInput) => void
  title: string
  confirmText: string
  initialValues?: Partial<Variable>
}

const formInputVariants = cva("w-full")

export function VariableDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  confirmText,
  initialValues,
}: VariableDialogProps) {
  const [formData, setFormData] = useState<Partial<VariableInput>>({
    name: "",
    symbol: "",
    minValue: 0,
    maxValue: 100,
    step: 1,
    unit: "",
    precision: 2,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Units for selection
  const units = [
    "",
    "g",
    "mg",
    "ug",
    "ng",
    "L",
    "mL",
    "uL",
    "mol",
    "mmol",
    "umol",
    "M",
    "mM",
    "uM",
    "pH",
    "C",
    "K",
    "kPa",
    "J",
    "kJ",
    "s",
    "min",
    "h",
  ]

  // Initialize form with initial values
  useEffect(() => {
    if (initialValues) {
      setFormData({
        name: initialValues.name ?? "",
        symbol: initialValues.symbol ?? "",
        minValue: initialValues.minValue ?? 0,
        maxValue: initialValues.maxValue ?? 100,
        step: initialValues.step ?? 1,
        unit: initialValues.unit ?? "",
        precision: initialValues.precision ?? 2,
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
    <K extends keyof VariableInput>(key: K, value: VariableInput[K]) => {
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

      // Validate form
      const validationErrors = validateVariableInput(formData as VariableInput)

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
      if (!formData.unit?.trim()) {
        newErrors.unit = cs.validation.required
      }
      if (formData.minValue === undefined || formData.maxValue === undefined) {
        newErrors.minValue = cs.validation.required
      } else if (formData.minValue > formData.maxValue) {
        newErrors.minValue = cs.variables.validation.rangeInvalid
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      // Submit all required fields
      onSubmit({
        name: required(formData.name, "name"),
        symbol: required(formData.symbol, "symbol"),
        minValue: required(formData.minValue, "minValue"),
        maxValue: required(formData.maxValue, "maxValue"),
        step: required(formData.step, "step"),
        unit: required(formData.unit, "unit"),
        precision: required(formData.precision, "precision"),
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
              ? cs.variables.editVariable
              : cs.variables.createVariable}
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="minValue">{cs.form.min}</Label>
              <DecimalInput
                id="minValue"
                value={formData.minValue ?? 0}
                onValueChange={(v) => handleChange("minValue", v ?? 0)}
                className={cn(formInputVariants())}
                placeholder={cs.form.minPlaceholder}
              />
              {errors.minValue && <p className="text-sm text-destructive">{errors.minValue}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxValue">{cs.form.max}</Label>
              <DecimalInput
                id="maxValue"
                value={formData.maxValue ?? 100}
                onValueChange={(v) => handleChange("maxValue", v ?? 100)}
                className={cn(formInputVariants())}
                placeholder={cs.form.maxPlaceholder}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="step">{cs.variables.validation.step}</Label>
              <DecimalInput
                id="step"
                value={formData.step ?? 1}
                onValueChange={(v) => handleChange("step", v ?? 1)}
                className={cn(formInputVariants())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="precision">{cs.form.precision}</Label>
              <Input
                id="precision"
                type="number"
                value={formData.precision ?? 2}
                onChange={(e) => handleChange("precision", parseInt(e.target.value, 10) || 2)}
                className={cn(formInputVariants(), "no-spinner")}
                min={0}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit">{cs.form.unit}</Label>
            <Select
              value={formData.unit ?? ""}
              onValueChange={(value) => handleChange("unit", value)}
            >
              <SelectTrigger className={cn(formInputVariants())}>
                <SelectValue placeholder={cs.form.unitPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit || cs.form.unitPlaceholder}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.unit && <p className="text-sm text-destructive">{errors.unit}</p>}
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
