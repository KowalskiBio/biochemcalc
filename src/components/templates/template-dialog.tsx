import { cva } from "class-variance-authority"
import { Plus, X } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { UnitRenderer } from "@/components/ui/unit-renderer"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { constantsApi, validateTemplateInput, variablesApi } from "@/lib/api"
// Import types
import type {
  Constant,
  ConstraintInput,
  ConstraintType,
  Template,
  TemplateConstantInput,
  TemplateInput,
  TemplateMode,
  TemplateVariableInput,
  Variable,
} from "@/lib/types"
import { cn, formatDecimalComma, required } from "@/lib/utils"

interface TemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: TemplateInput) => void
  title: string
  confirmText: string
  initialValues?: Partial<Template>
}

const formInputVariants = cva("w-full")

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
  "atm",
  "mmHg",
  "J",
  "kJ",
  "cal",
  "kcal",
  "s",
  "min",
  "h",
]

// Point values
const pointValues = [2, 3, 4]

// Mode options
const modeOptions: { value: TemplateMode; label: string }[] = [
  { value: "closed", label: cs.templates.mode.closed },
  { value: "open", label: cs.templates.mode.open },
]

// Constraint types
const constraintTypes: { value: ConstraintType; label: string }[] = [
  { value: "range", label: "Range" },
  { value: "sd", label: "Standard Deviation" },
  { value: "both", label: "Range + SD" },
]

export function TemplateDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  confirmText,
  initialValues,
}: TemplateDialogProps) {
  const [formData, setFormData] = useState<Partial<TemplateInput>>({
    questionText: "",
    formula: "",
    equationText: "",
    resultUnit: "",
    pointValue: 2,
    mode: "closed",
    variables: [],
    constants: [],
    constraint: undefined,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Available variables and constants
  const [availableVariables, setAvailableVariables] = useState<Variable[]>([])
  const [availableConstants, setAvailableConstants] = useState<Constant[]>([])
  const [isLoadingData, setIsLoadingData] = useState(false)

  // Selected items for multi-select
  const [selectedVariableId, setSelectedVariableId] = useState<string>("")
  const [selectedConstantId, setSelectedConstantId] = useState<string>("")
  const [newVariablePlaceholder, setNewVariablePlaceholder] = useState("")

  // Load available variables and constants
  useEffect(() => {
    if (open) {
      const loadData = async () => {
        setIsLoadingData(true)
        try {
          const [variables, constants] = await Promise.all([
            variablesApi.list(),
            constantsApi.list(),
          ])
          setAvailableVariables(variables)
          setAvailableConstants(constants)
        } catch {
          // Handle error silently, will show empty lists
        } finally {
          setIsLoadingData(false)
        }
      }
      loadData()
    }
  }, [open])

  // Initialize form with initial values
  useEffect(() => {
    if (initialValues) {
      setFormData({
        questionText: initialValues.questionText ?? "",
        formula: initialValues.formula ?? "",
        equationText: initialValues.equationText ?? "",
        resultUnit: initialValues.resultUnit ?? "",
        pointValue: initialValues.pointValue ?? 2,
        mode: initialValues.mode ?? "closed",
        variables: initialValues.variables ?? [],
        constants: initialValues.constants ?? [],
        constraint: initialValues.constraint,
      })
    }
  }, [initialValues])

  // Reset errors when dialog closes
  useEffect(() => {
    if (!open) {
      setErrors({})
      setNewVariablePlaceholder("")
    }
  }, [open])

  const handleChange = useCallback(
    <K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) => {
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

  // Add variable to template
  const handleAddVariable = useCallback(() => {
    if (!selectedVariableId || !newVariablePlaceholder) return

    const existing = formData.variables?.find((v) => v.variableId === selectedVariableId)
    if (existing) return

    const variable = availableVariables.find((v) => v.id === selectedVariableId)
    if (!variable) return

    const newVariable: TemplateVariableInput = {
      variableId: selectedVariableId,
      placeholder: newVariablePlaceholder,
    }

    handleChange("variables", [...(formData.variables ?? []), newVariable])
    setSelectedVariableId("")
    setNewVariablePlaceholder("")
  }, [
    formData.variables,
    selectedVariableId,
    newVariablePlaceholder,
    availableVariables,
    handleChange,
  ])

  // Remove variable from template
  const handleRemoveVariable = useCallback(
    (index: number) => {
      const updated = [...(formData.variables ?? [])]
      updated.splice(index, 1)
      handleChange("variables", updated)
    },
    [formData.variables, handleChange],
  )

  // Add constant to template
  const handleAddConstant = useCallback(() => {
    if (!selectedConstantId) return

    const existing = formData.constants?.find((c) => c.constantId === selectedConstantId)
    if (existing) return

    const newConstant: TemplateConstantInput = {
      constantId: selectedConstantId,
    }

    handleChange("constants", [...(formData.constants ?? []), newConstant])
    setSelectedConstantId("")
  }, [formData.constants, selectedConstantId, handleChange])

  // Remove constant from template
  const handleRemoveConstant = useCallback(
    (index: number) => {
      const updated = [...(formData.constants ?? [])]
      updated.splice(index, 1)
      handleChange("constants", updated)
    },
    [formData.constants, handleChange],
  )

  // Update constraint
  const handleConstraintChange = useCallback(
    (field: keyof ConstraintInput, value: string | number | undefined) => {
      const currentConstraint = formData.constraint ?? {
        constraintType: "range" as ConstraintType,
      }
      const newConstraint: ConstraintInput = {
        ...currentConstraint,
        [field]: value,
      }
      // If all fields are undefined, set to undefined
      if (Object.values(newConstraint).every((v) => v === undefined)) {
        handleChange("constraint", undefined)
      } else {
        handleChange("constraint", newConstraint)
      }
    },
    [formData.constraint, handleChange],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      // Validate form
      const validationErrors = validateTemplateInput(formData as TemplateInput)

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
      if (!formData.questionText?.trim()) {
        newErrors.questionText = cs.validation.required
      }
      if (!formData.formula?.trim()) {
        newErrors.formula = cs.validation.required
      }
      if (!formData.resultUnit?.trim()) {
        newErrors.resultUnit = cs.validation.required
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors)
        return
      }

      // Submit form
      onSubmit({
        questionText: required(formData.questionText, "questionText"),
        formula: required(formData.formula, "formula"),
        equationText: formData.equationText ?? "",
        resultUnit: required(formData.resultUnit, "resultUnit"),
        pointValue: required(formData.pointValue, "pointValue"),
        mode: required(formData.mode, "mode"),
        variables: formData.variables ?? [],
        constants: formData.constants ?? [],
        constraint: formData.constraint,
      })
    },
    [formData, onSubmit],
  )

  // Get variable name by ID
  const getVariableName = useCallback(
    (id: string) => {
      return availableVariables.find((v) => v.id === id)?.name ?? "Unknown"
    },
    [availableVariables],
  )

  // Get constant name by ID
  const getConstantName = useCallback(
    (id: string) => {
      return availableConstants.find((c) => c.id === id)?.name ?? "Unknown"
    },
    [availableConstants],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {title.includes(cs.common.edit)
              ? cs.templates.editTemplate
              : cs.templates.createTemplate}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="questionText">{cs.form.description}</Label>
            <Textarea
              id="questionText"
              value={formData.questionText ?? ""}
              onChange={(e) => handleChange("questionText", e.target.value)}
              className={cn(formInputVariants(), "min-h-[100px]")}
              placeholder={cs.templates.createTemplate}
            />
            {errors.questionText && (
              <p className="text-sm text-destructive">{errors.questionText}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="formula">{cs.templates.expressionRequired} (Formula)</Label>
            <Input
              id="formula"
              value={formData.formula ?? ""}
              onChange={(e) => handleChange("formula", e.target.value)}
              className={cn(formInputVariants())}
              placeholder="e.g., concentration * volume"
            />
            {errors.formula && <p className="text-sm text-destructive">{errors.formula}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="equationText">{cs.templates.equationText}</Label>
            <Input
              id="equationText"
              value={formData.equationText ?? ""}
              onChange={(e) => handleChange("equationText", e.target.value)}
              className={cn(formInputVariants())}
              placeholder={cs.templates.equationTextPlaceholder}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="resultUnit">{cs.templates.resultUnit}</Label>
              <Select
                value={formData.resultUnit ?? ""}
                onValueChange={(value) => handleChange("resultUnit", value)}
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="pointValue">{cs.templates.pointValue}</Label>
              <Select
                value={String(formData.pointValue ?? 2)}
                onValueChange={(value) =>
                  handleChange("pointValue", parseInt(value, 10) as 2 | 3 | 4)
                }
              >
                <SelectTrigger className={cn(formInputVariants())}>
                  <SelectValue placeholder="Select points" />
                </SelectTrigger>
                <SelectContent>
                  {pointValues.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} points
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mode">
              {cs.templates.mode.closed} / {cs.templates.mode.open}
            </Label>
            <Select
              value={formData.mode ?? "closed"}
              onValueChange={(value) => handleChange("mode", value as TemplateMode)}
            >
              <SelectTrigger className={cn(formInputVariants())}>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                {modeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Variables Section */}
          <div className="space-y-4 border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold">Linked Variables</h3>

            <div className="space-y-3">
              {formData.variables?.length === 0 && (
                <p className="text-sm text-foreground-muted">No variables added yet</p>
              )}

              {formData.variables?.map((variable, index) => (
                <div
                  key={variable.variableId}
                  className="flex items-center gap-3 p-2 bg-muted rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{getVariableName(variable.variableId)}</p>
                    <p className="text-sm text-foreground-muted">
                      Placeholder: [[{variable.placeholder}]]
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => handleRemoveVariable(index)}
                    className="size-8 p-0"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Select
                value={selectedVariableId}
                onValueChange={setSelectedVariableId}
                disabled={isLoadingData}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={isLoadingData ? "Loading..." : "Select variable"} />
                </SelectTrigger>
                <SelectContent>
                  {availableVariables.map((variable) => (
                    <SelectItem key={variable.id} value={variable.id}>
                      {variable.name} ({variable.symbol}) - {variable.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                placeholder="Placeholder"
                value={newVariablePlaceholder}
                onChange={(e) => setNewVariablePlaceholder(e.target.value)}
                className="flex-1"
              />

              <Button
                type="button"
                size="sm"
                onClick={handleAddVariable}
                disabled={!selectedVariableId || !newVariablePlaceholder}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {/* Constants Section */}
          <div className="space-y-4 border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold">Linked Constants</h3>

            <div className="space-y-3">
              {formData.constants?.length === 0 && (
                <p className="text-sm text-foreground-muted">No constants added yet</p>
              )}

              {formData.constants?.map((constant, index) => (
                <div
                  key={constant.constantId}
                  className="flex items-center gap-3 p-2 bg-muted rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{getConstantName(constant.constantId)}</p>
                    <p className="text-sm text-foreground-muted">
                      {availableConstants.find((c) => c.id === constant.constantId)?.symbol} ={" "}
                      {formatDecimalComma(
                        String(
                          availableConstants.find((c) => c.id === constant.constantId)?.value ?? "",
                        ),
                      )}{" "}
                      <UnitRenderer
                        unit={
                          availableConstants.find((c) => c.id === constant.constantId)?.unit ?? ""
                        }
                      />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => handleRemoveConstant(index)}
                    className="size-8 p-0"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Select
                value={selectedConstantId}
                onValueChange={setSelectedConstantId}
                disabled={isLoadingData}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={isLoadingData ? "Loading..." : "Select constant"} />
                </SelectTrigger>
                <SelectContent>
                  {availableConstants.map((constant) => (
                    <SelectItem key={constant.id} value={constant.id}>
                      {constant.name} ({constant.symbol}) ={" "}
                      {formatDecimalComma(String(constant.value))} {constant.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                onClick={handleAddConstant}
                disabled={!selectedConstantId}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {/* Constraint Section */}
          <div className="space-y-4 border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold">Result Constraint (Optional)</h3>

            <div className="grid grid-cols-2 gap-4">
              <Select
                value={formData.constraint?.constraintType ?? ""}
                onValueChange={(value) =>
                  handleConstraintChange("constraintType", value as ConstraintType | undefined)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Constraint type" />
                </SelectTrigger>
                <SelectContent>
                  {constraintTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {formData.constraint?.constraintType === "range" && (
                <>
                  <div className="space-y-2">
                    <Label>Min Result</Label>
                    <DecimalInput
                      value={formData.constraint?.minResult ?? ""}
                      onValueChange={(v) => handleConstraintChange("minResult", v)}
                      placeholder="Min value"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Result</Label>
                    <DecimalInput
                      value={formData.constraint?.maxResult ?? ""}
                      onValueChange={(v) => handleConstraintChange("maxResult", v)}
                      placeholder="Max value"
                    />
                  </div>
                </>
              )}

              {formData.constraint?.constraintType === "sd" && (
                <div className="space-y-2 col-span-2">
                  <Label>SD Allowed</Label>
                  <DecimalInput
                    value={formData.constraint?.sdAllowed ?? ""}
                    onValueChange={(v) => handleConstraintChange("sdAllowed", v)}
                    placeholder="Standard deviation"
                  />
                </div>
              )}

              {formData.constraint?.constraintType === "both" && (
                <>
                  <div className="space-y-2">
                    <Label>Min Result</Label>
                    <DecimalInput
                      value={formData.constraint?.minResult ?? ""}
                      onValueChange={(v) => handleConstraintChange("minResult", v)}
                      placeholder="Min value"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Result</Label>
                    <DecimalInput
                      value={formData.constraint?.maxResult ?? ""}
                      onValueChange={(v) => handleConstraintChange("maxResult", v)}
                      placeholder="Max value"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>SD Allowed</Label>
                    <DecimalInput
                      value={formData.constraint?.sdAllowed ?? ""}
                      onValueChange={(v) => handleConstraintChange("sdAllowed", v)}
                      placeholder="Standard deviation"
                    />
                  </div>
                </>
              )}
            </div>
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
