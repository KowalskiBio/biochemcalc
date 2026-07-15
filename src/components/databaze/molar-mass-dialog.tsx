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
import { cs } from "@/i18n/cs"
import { parseChemicalFormula } from "@/lib/chemical-formula-parser"
import { formatAtomicWeight } from "@/lib/periodic-table-data"

interface MolarMassEntry {
  id: string
  symbol: string
  name: string
  formula: string
  value: number
}

interface MolarMassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (entry: Omit<MolarMassEntry, "id">) => void
  title: string
  confirmText: string
  initialValues?: Partial<Omit<MolarMassEntry, "id">>
  existingSymbols: string[]
  atomicWeights?: Record<string, number>
  readOnlySymbol?: boolean
}

function valueToDisplay(value: number): string {
  return formatAtomicWeight(value)
}

export function MolarMassDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  confirmText,
  initialValues,
  existingSymbols,
  atomicWeights,
  readOnlySymbol,
}: MolarMassDialogProps) {
  const [formData, setFormData] = useState<Partial<Omit<MolarMassEntry, "id">>>({
    symbol: "",
    name: "",
    formula: "",
    value: undefined,
  })
  const [valueText, setValueText] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (initialValues) {
      setFormData({
        symbol: initialValues.symbol ?? "",
        name: initialValues.name ?? "",
        formula: initialValues.formula ?? "",
        value: initialValues.value ?? undefined,
      })
      setValueText(initialValues.value !== undefined ? valueToDisplay(initialValues.value) : "")
    }
  }, [initialValues])

  useEffect(() => {
    if (!open) {
      setErrors({})
    }
  }, [open])

  const clearError = useCallback((key: string) => {
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const handleSymbolChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({ ...prev, symbol: value }))
      clearError("symbol")
    },
    [clearError],
  )

  const handleNameChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({ ...prev, name: value }))
      clearError("name")
    },
    [clearError],
  )

  const handleFormulaChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({ ...prev, formula: value }))
      clearError("formula")
      clearError("value")
    },
    [clearError],
  )

  const handleValueChange = useCallback(
    (value: string) => {
      setValueText(value)
      const normalized = value.replace(",", ".")
      const parsed = normalized.trim() === "" ? undefined : Number(normalized)
      setFormData((prev) => ({ ...prev, value: Number.isNaN(parsed) ? undefined : parsed }))
      clearError("value")
    },
    [clearError],
  )

  const tryCalculateFromFormula = useCallback(
    (formula: string): number | null => {
      const result = parseChemicalFormula(formula, atomicWeights)
      return result.ok ? result.value : null
    },
    [atomicWeights],
  )

  const applyCalculatedValue = useCallback((value: number) => {
    setValueText(valueToDisplay(value))
    setFormData((prev) => ({ ...prev, value }))
  }, [])

  const handleCalculateClick = useCallback(() => {
    const formula = formData.formula?.trim() ?? ""
    const value = tryCalculateFromFormula(formula)
    if (value === null) {
      setErrors((prev) => ({
        ...prev,
        formula: cs.databaze.atomicWeights.validation.formulaInvalid,
      }))
      return
    }
    applyCalculatedValue(value)
    clearError("formula")
    clearError("value")
  }, [applyCalculatedValue, clearError, formData.formula, tryCalculateFromFormula])

  const validate = useCallback(
    (candidateValue: number | undefined) => {
      const newErrors: Record<string, string> = {}
      const symbol = formData.symbol?.trim() ?? ""
      const formula = formData.formula?.trim() ?? ""

      if (!symbol) {
        newErrors.symbol = cs.databaze.atomicWeights.validation.codeRequired
      } else if (existingSymbols.includes(symbol)) {
        newErrors.symbol = cs.databaze.atomicWeights.validation.codeUnique
      }

      const hasValue = candidateValue !== undefined && !Number.isNaN(candidateValue)
      if (!hasValue) {
        if (!formula) {
          newErrors.formula = cs.databaze.atomicWeights.validation.formulaRequired
          newErrors.value = cs.databaze.atomicWeights.validation.valueRequired
        } else if (tryCalculateFromFormula(formula) === null) {
          newErrors.formula = cs.databaze.atomicWeights.validation.formulaInvalid
        }
      } else if (!Number.isFinite(candidateValue)) {
        newErrors.value = cs.databaze.atomicWeights.validation.valueInvalid
      }

      return newErrors
    },
    [existingSymbols, formData.formula, formData.symbol, tryCalculateFromFormula],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      let candidateValue = formData.value
      if (candidateValue === undefined || Number.isNaN(candidateValue)) {
        const formula = formData.formula?.trim() ?? ""
        const calculated = tryCalculateFromFormula(formula)
        if (calculated !== null) {
          candidateValue = calculated
          applyCalculatedValue(calculated)
        }
      }

      const newErrors = validate(candidateValue)
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      onSubmit({
        symbol: formData.symbol?.trim() ?? "",
        name: formData.name?.trim() ?? "",
        formula: formData.formula?.trim() ?? "",
        value: candidateValue ?? 0,
      })
    },
    [
      applyCalculatedValue,
      formData.formula,
      formData.name,
      formData.symbol,
      formData.value,
      onSubmit,
      tryCalculateFromFormula,
      validate,
    ],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{cs.databaze.atomicWeights.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="molar-mass-symbol">{cs.databaze.atomicWeights.form.code}</Label>
            <Input
              id="molar-mass-symbol"
              value={formData.symbol ?? ""}
              onChange={(e) => handleSymbolChange(e.target.value)}
              className="w-full"
              placeholder={cs.databaze.atomicWeights.form.codePlaceholder}
              readOnly={readOnlySymbol}
            />
            {errors.symbol && <p className="text-sm text-destructive">{errors.symbol}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="molar-mass-name">{cs.databaze.atomicWeights.form.name}</Label>
            <Input
              id="molar-mass-name"
              value={formData.name ?? ""}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full"
              placeholder={cs.databaze.atomicWeights.form.namePlaceholder}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="molar-mass-formula">{cs.databaze.atomicWeights.form.formula}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="molar-mass-formula"
                value={formData.formula ?? ""}
                onChange={(e) => handleFormulaChange(e.target.value)}
                className="w-full"
                placeholder={cs.databaze.atomicWeights.form.formulaPlaceholder}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCalculateClick}
                className="whitespace-nowrap"
              >
                {cs.databaze.atomicWeights.form.calculateFromFormula}
              </Button>
            </div>
            {errors.formula && <p className="text-sm text-destructive">{errors.formula}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="molar-mass-value">{cs.databaze.atomicWeights.form.value}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="molar-mass-value"
                value={valueText}
                onChange={(e) => handleValueChange(e.target.value)}
                className="w-full"
                placeholder={cs.databaze.atomicWeights.form.valuePlaceholder}
                inputMode="decimal"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">g/mol</span>
            </div>
            {errors.value && <p className="text-sm text-destructive">{errors.value}</p>}
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
