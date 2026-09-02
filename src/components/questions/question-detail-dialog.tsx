import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MathRenderer } from "@/components/ui/math-renderer"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { UnitRenderer } from "@/components/ui/unit-renderer"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, constantsApi, generationApi, historyApi, templatesApi } from "@/lib/api"
import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import { applyResultUnits, extractTargets } from "@/lib/formula-checker"
import {
  createRandom,
  evaluateAllAssignments,
  evaluateExpression,
  extractMolarMassValues,
  formatNumberForText,
  formatValueForSubstitution,
  renderEquationAsLatex,
  resolveMolarMasses,
  substituteRemainingMolarMasses,
  substituteStringsInMolarMassReferences,
  validateEquationReferences,
} from "@/lib/math-utils"
import { KNOWN_ELEMENTS } from "@/lib/periodic-table-data"
import { formatChemicalText, QuestionTextRenderer } from "@/lib/render-question-text"
import type {
  ConstraintInput,
  HistoryEntry,
  LocalVariableEdit,
  Notation,
  TemplateDecoy,
  TemplateDecoyInput,
  TemplateWithDetails,
  UpdateTemplateWithVariablesPayload,
  VariableInput,
  VariableMutation,
  VariableWithPlaceholder,
  Variant,
} from "@/lib/types"
import {
  extractPlaceholders,
  extractPlaceholderValues,
  generateId,
  isAtomPlaceholder,
  parseCzechNumber,
  replacePlaceholder,
  stripAnswerTargets,
} from "@/lib/utils"
import { useDatabazeEntries } from "@/stores/databaze-store"

import { VariableEditorRow } from "./variable-editor-row"

interface QuestionDetailDialogProps {
  templateId: string
  open: boolean
  onClose: () => void
  onDelete?: (templateId: string) => void
  /**
   * Fired after every successful save (question text/variables, answer
   * settings, or the force-scientific toggle). The parent uses this to
   * refresh its own template list so the change is visible without a
   * full page reload.
   */
  onSaved?: () => void
  initialTemplateDetails?: TemplateWithDetails
  initialConstants?: Record<string, number>
}

function toLocalVariableEdit(vwp: VariableWithPlaceholder): LocalVariableEdit {
  return {
    key: vwp.variable.id,
    variableId: vwp.variable.id,
    placeholder: vwp.placeholder,
    name: vwp.variable.name,
    symbol: vwp.variable.symbol,
    varType: vwp.variable.varType,
    minValue: vwp.variable.minValue,
    maxValue: vwp.variable.maxValue,
    step: vwp.variable.step,
    unit: vwp.variable.unit,
    precision: vwp.variable.precision,
    stringValues: vwp.variable.stringValues,
    pairedConstants: vwp.variable.pairedConstants,
    significantDigits: vwp.variable.significantDigits,
    notation: vwp.variable.notation,
    greaterThanVariableId: vwp.greaterThanVariableId,
    lessThanVariableId: vwp.lessThanVariableId,
    isNew: false,
    isRemoved: false,
    isDirty: false,
    isShared: vwp.isShared,
  }
}

function validateVariable(v: LocalVariableEdit): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!v.name.trim()) {
    errors.name = cs.questions.validation.nameRequired
  }
  if (!v.symbol.trim()) {
    errors.symbol = cs.questions.validation.symbolRequired
  } else if (v.symbol.length > 50) {
    errors.symbol = cs.questions.validation.symbolLength
  } else if (!/^\w+$/.test(v.symbol)) {
    errors.symbol = cs.questions.validation.symbolAlphanumeric
  }
  if (!v.placeholder.trim()) {
    errors.placeholder = cs.questions.validation.symbolRequired
  }

  if (v.varType === "string") {
    if (!v.stringValues || v.stringValues.length < 2 || v.stringValues.some((s) => !s.trim())) {
      errors.stringValues = cs.questions.validation.stringValuesRequired
    }
    return errors
  }

  if (v.minValue >= v.maxValue) {
    errors.minValue = cs.questions.validation.minLessThanMax
    errors.maxValue = cs.questions.validation.minLessThanMax
  }
  if (v.step <= 0) {
    errors.step = cs.questions.validation.stepPositive
  }
  if (v.precision < 0 || v.precision > 10) {
    errors.precision = cs.questions.validation.precisionMax
  }
  return errors
}

function validateComparisonConstraints(
  variables: LocalVariableEdit[],
): Record<string, Record<string, string>> {
  const errors: Record<string, Record<string, string>> = {}
  const variableById = new Map(variables.map((v) => [v.variableId, v]))

  for (const v of variables) {
    if (v.isRemoved || v.varType !== "numeric") continue

    const check = (field: "greaterThanVariableId" | "lessThanVariableId", label: string) => {
      const targetId = v[field]
      if (!targetId) return

      if (targetId === v.variableId) {
        errors[v.key] = {
          ...errors[v.key],
          [field]: `${label}: proměnná nemůže odkazovat sama na sebe`,
        }
        return
      }

      const target = variableById.get(targetId)
      if (!target || target.isRemoved) {
        errors[v.key] = { ...errors[v.key], [field]: `${label}: cílová proměnná neexistuje` }
        return
      }
      if (target.varType !== "numeric") {
        errors[v.key] = {
          ...errors[v.key],
          [field]: `${label}: cílová proměnná musí být numerická`,
        }
        return
      }
    }

    check("greaterThanVariableId", cs.questions.greaterThan)
    check("lessThanVariableId", cs.questions.lessThan)

    if (v.greaterThanVariableId && v.lessThanVariableId) {
      errors[v.key] = {
        ...errors[v.key],
        comparison: "Proměnná nemůže být současně větší i menší než jiná proměnná",
      }
    }
  }

  const adj = new Map<string, string>()
  for (const v of variables) {
    if (v.isRemoved || v.varType !== "numeric") continue
    if (v.greaterThanVariableId) {
      adj.set(v.variableId as string, v.greaterThanVariableId)
    } else if (v.lessThanVariableId) {
      adj.set(v.lessThanVariableId, v.variableId as string)
    }
  }

  function hasCycleFrom(start: string): boolean {
    const visited = new Set<string>()
    let current: string | undefined = start
    while (current) {
      if (current === start && visited.size > 0) return true
      if (visited.has(current)) return false
      visited.add(current)
      current = adj.get(current)
    }
    return false
  }

  for (const v of variables) {
    if (v.isRemoved || v.varType !== "numeric") continue
    if (hasCycleFrom(v.variableId as string)) {
      errors[v.key] = {
        ...errors[v.key],
        comparison: "Cyklický vztah mezi proměnnými",
      }
    }
  }

  return errors
}

// The editor UI stores "no comparison" as "" (the Select's sentinel-cleared
// state), but the backend's Option<Uuid> rejects "" outright — it only
// accepts a valid UUID or an absent/null field. Sending "" through fails
// deserialization for the whole request, silently dropping the entire save.
function emptyToUndefined(id: string | undefined): string | undefined {
  return id ? id : undefined
}

function buildVariableInput(v: LocalVariableEdit): VariableInput {
  return {
    name: v.name,
    symbol: v.symbol,
    varType: v.varType,
    minValue: v.minValue,
    maxValue: v.maxValue,
    step: v.step,
    unit: v.unit,
    precision: v.precision,
    stringValues: v.stringValues,
    pairedConstants: v.pairedConstants,
    significantDigits: v.significantDigits,
    notation: v.notation,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function variableChanged(
  current: LocalVariableEdit,
  original: LocalVariableEdit | undefined,
): boolean {
  if (!original) return true
  return (
    current.name !== original.name ||
    current.symbol !== original.symbol ||
    current.varType !== original.varType ||
    current.minValue !== original.minValue ||
    current.maxValue !== original.maxValue ||
    current.step !== original.step ||
    current.unit !== original.unit ||
    current.precision !== original.precision ||
    current.significantDigits !== original.significantDigits ||
    current.notation !== original.notation ||
    current.placeholder !== original.placeholder ||
    current.greaterThanVariableId !== original.greaterThanVariableId ||
    current.lessThanVariableId !== original.lessThanVariableId ||
    JSON.stringify(current.stringValues ?? []) !== JSON.stringify(original.stringValues ?? []) ||
    JSON.stringify(current.pairedConstants ?? []) !== JSON.stringify(original.pairedConstants ?? [])
  )
}

interface DecoyRow {
  key: string
  formula: string
  optionCount: number
}

function toDecoyRow(d: TemplateDecoy): DecoyRow {
  return { key: d.id, formula: d.formula, optionCount: d.optionCount }
}

function decoyRowsChanged(current: DecoyRow[], original: TemplateDecoy[]): boolean {
  if (current.length !== original.length) return true
  return current.some(
    (row, i) => row.formula !== original[i].formula || row.optionCount !== original[i].optionCount,
  )
}

function buildDecoyInputs(rows: DecoyRow[]): TemplateDecoyInput[] {
  return rows
    .filter((r) => r.formula.trim() !== "")
    .map((r) => ({
      formula: normalizeFormulaForEvaluation(r.formula),
      optionCount: r.optionCount,
    }))
}

function buildAlternativeFormulaInput(formula: string): string | undefined {
  return formula.trim() === "" ? undefined : normalizeFormulaForEvaluation(formula)
}

export function QuestionDetailDialog({
  templateId,
  open,
  onClose,
  onDelete,
  onSaved,
  initialTemplateDetails,
  initialConstants,
}: QuestionDetailDialogProps) {
  const [templateDetails, setTemplateDetails] = useState<TemplateWithDetails | null>(
    initialTemplateDetails ?? null,
  )
  const [isLoading, setIsLoading] = useState(!initialTemplateDetails)
  const hasDataRef = useRef(!!initialTemplateDetails)
  const [error, setError] = useState<string | null>(null)
  const [isEditingText, setIsEditingText] = useState(false)
  const [editText, setEditText] = useState(initialTemplateDetails?.template.questionText ?? "")
  const [localVariables, setLocalVariables] = useState<LocalVariableEdit[]>(
    initialTemplateDetails ? initialTemplateDetails.variables.map(toLocalVariableEdit) : [],
  )
  const [originalVariables, setOriginalVariables] = useState<LocalVariableEdit[]>(
    initialTemplateDetails
      ? initialTemplateDetails.variables.map(toLocalVariableEdit).map((v) => ({ ...v }))
      : [],
  )
  const [editingVariableKey, setEditingVariableKey] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, Record<string, string>>>(
    {},
  )
  const [isSaving, setIsSaving] = useState(false)
  const [sampleVariant, setSampleVariant] = useState<Variant | null>(null)
  const [isEditingAnswer, setIsEditingAnswer] = useState(false)
  const [editEquationText, setEditEquationText] = useState(
    initialTemplateDetails?.template.equationText ?? "",
  )
  const [editResultUnit, setEditResultUnit] = useState(
    initialTemplateDetails?.template.resultUnit ?? "",
  )
  const [editSignificantDigits, setEditSignificantDigits] = useState<string>(
    initialTemplateDetails?.template.significantDigits != null
      ? String(initialTemplateDetails.template.significantDigits)
      : "",
  )
  const [sdText, setSdText] = useState<string>(
    initialTemplateDetails?.template.constraint?.sdAllowed != null
      ? String(initialTemplateDetails.template.constraint.sdAllowed)
      : "",
  )
  const [forceScientific, setForceScientific] = useState(
    initialTemplateDetails?.template.forceScientific ?? false,
  )
  const [decoyRows, setDecoyRows] = useState<DecoyRow[]>(
    (initialTemplateDetails?.decoys ?? []).map(toDecoyRow),
  )
  const [alternativeFormula, setAlternativeFormula] = useState(
    initialTemplateDetails?.template.alternativeFormula ?? "",
  )
  const [showAlternativeFormulaInput, setShowAlternativeFormulaInput] = useState(
    !!initialTemplateDetails?.template.alternativeFormula,
  )
  const [mockSeed, setMockSeed] = useState(0)
  const [sampleSeed, setSampleSeed] = useState(1)

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(!!initialTemplateDetails)
  const [isClearHistoryDialogOpen, setIsClearHistoryDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [constants, setConstants] = useState<Record<string, number>>(initialConstants ?? {})

  const { toast } = useToast()
  const databazeEntries = useDatabazeEntries()

  const loadConstants = useCallback(async () => {
    try {
      const allConstants = await constantsApi.list()
      const map: Record<string, number> = {}
      for (const c of allConstants) {
        map[c.symbol] = c.value
      }
      setConstants(map)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.questions.detailTitle,
        description: message,
        variant: "destructive",
      })
    }
  }, [toast])

  useEffect(() => {
    if (open) {
      loadConstants()
    }
  }, [open, loadConstants])

  const loadTemplateDetails = useCallback(async () => {
    if (!templateId) return

    try {
      setIsLoading(!hasDataRef.current)
      setError(null)
      const details = await templatesApi.getWithDetails(templateId)
      hasDataRef.current = true
      setTemplateDetails(details)
      const locals = details.variables.map(toLocalVariableEdit)
      setLocalVariables(locals)
      setOriginalVariables(locals.map((v) => ({ ...v })))
      setEditText(details.template.questionText)
      setEditEquationText(details.template.equationText ?? "")
      setEditResultUnit(details.template.resultUnit)
      setEditSignificantDigits(
        details.template.significantDigits != null
          ? String(details.template.significantDigits)
          : "",
      )
      setSdText(
        details.template.constraint?.sdAllowed != null
          ? String(details.template.constraint.sdAllowed)
          : "",
      )
      setForceScientific(details.template.forceScientific ?? false)
      setDecoyRows(details.decoys.map(toDecoyRow))
      setAlternativeFormula(details.template.alternativeFormula ?? "")
      setShowAlternativeFormulaInput(!!details.template.alternativeFormula)
      setIsEditingAnswer(false)
      setEditingVariableKey(null)
      setValidationErrors({})

      if (details.template.formula.trim()) {
        try {
          const variant = await generationApi.regenerateVariant({
            templateId,
            mode: "closed",
            seed: sampleSeed,
            difficulty: "medium",
            optionCount: 5,
          })
          setSampleVariant(variant)
        } catch (err) {
          const message = err instanceof ApiError ? err.message : String(err)
          toast({
            title: cs.questions.regenerateError,
            description: message,
            variant: "destructive",
          })
          setSampleVariant(null)
        }
      } else {
        setSampleVariant(null)
      }

      setIsLoadingHistory(true)
      try {
        const history = await historyApi.listByTemplate(templateId, 20, 0)
        setHistoryEntries(history)
      } catch (historyErr) {
        const historyMessage =
          historyErr instanceof ApiError ? historyErr.message : String(historyErr)
        toast({
          title: cs.questions.historyError,
          description: historyMessage,
          variant: "destructive",
        })
      } finally {
        setIsLoadingHistory(false)
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [templateId, toast, sampleSeed])

  const handleClearHistoryClick = useCallback(() => {
    if (!templateId) return
    setIsClearHistoryDialogOpen(true)
  }, [templateId])

  const handleClearHistoryConfirm = useCallback(async () => {
    if (!templateId) return
    setIsClearHistoryDialogOpen(false)

    try {
      await historyApi.clearByTemplate(templateId)
      setHistoryEntries([])
      toast({
        title: cs.questions.clearHistorySuccess,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.questions.clearHistoryError,
        description: message,
        variant: "destructive",
      })
    }
  }, [templateId, toast])

  const handleDeleteConfirm = useCallback(async () => {
    if (!templateId) return
    setIsDeleting(true)

    try {
      await templatesApi.delete(templateId)
      toast({
        title: cs.sets.deleteSuccess,
        description: cs.sets.deleteSuccessDescription.replace(
          "{name}",
          templateDetails?.template.questionText.slice(0, 50) ?? "",
        ),
      })
      onDelete?.(templateId)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.sets.deleteError,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
    }
  }, [templateId, templateDetails, onDelete, toast])

  useEffect(() => {
    if (open && templateId) {
      loadTemplateDetails()
    }
  }, [open, templateId, loadTemplateDetails])

  const dirtyVariableKeys = useMemo(() => {
    const dirty = new Set<string>()
    for (const v of localVariables) {
      if (v.isRemoved) {
        if (v.variableId) dirty.add(v.key)
        continue
      }
      const original = originalVariables.find((o) => o.key === v.key)
      if (v.isNew || variableChanged(v, original)) {
        dirty.add(v.key)
      }
    }
    return dirty
  }, [localVariables, originalVariables])

  const hasChanges = useMemo(() => {
    if (editText !== (templateDetails?.template.questionText ?? "")) return true
    if (editEquationText !== (templateDetails?.template.equationText ?? "")) return true
    if (editResultUnit !== (templateDetails?.template.resultUnit ?? "")) return true
    const currentSigDigits = templateDetails?.template.significantDigits
    const newSigDigits =
      editSignificantDigits.trim() === "" ? undefined : Number(editSignificantDigits)
    if (newSigDigits !== currentSigDigits) return true
    const currentSd = templateDetails?.template.constraint?.sdAllowed
    const parsedSd = Number(sdText)
    const newSd =
      sdText.trim() === "" || Number.isNaN(parsedSd) || parsedSd <= 0 ? undefined : parsedSd
    if (newSd !== currentSd) return true
    if (forceScientific !== (templateDetails?.template.forceScientific ?? false)) return true
    if (decoyRowsChanged(decoyRows, templateDetails?.decoys ?? [])) return true
    if (alternativeFormula !== (templateDetails?.template.alternativeFormula ?? "")) return true
    return dirtyVariableKeys.size > 0
  }, [
    editText,
    editEquationText,
    editResultUnit,
    editSignificantDigits,
    sdText,
    forceScientific,
    decoyRows,
    alternativeFormula,
    templateDetails,
    dirtyVariableKeys,
  ])

  // The engine keys on sd_allowed presence, not constraintType; stale wizard
  // data may carry an sd with type "range", so read the effective SD regardless.
  const buildAnswerConstraint = (): ConstraintInput | undefined => {
    const existing = templateDetails?.template.constraint
    const parsed = Number(sdText)
    const hasMinMax = existing?.minResult != null || existing?.maxResult != null
    if (sdText.trim() === "" || Number.isNaN(parsed) || parsed <= 0) {
      if (hasMinMax) {
        return {
          minResult: existing?.minResult,
          maxResult: existing?.maxResult,
          sdAllowed: undefined,
          constraintType: "range",
        }
      }
      return undefined
    }
    return {
      minResult: existing?.minResult,
      maxResult: existing?.maxResult,
      sdAllowed: parsed,
      constraintType: hasMinMax ? "both" : "sd",
    }
  }

  const handleSave = async () => {
    if (!templateDetails) return

    const allErrors: Record<string, Record<string, string>> = {}
    let hasError = false
    for (const v of localVariables) {
      if (v.isRemoved) continue
      if (!v.isDirty && !v.isNew) continue
      const errs = validateVariable(v)
      if (Object.keys(errs).length > 0) {
        allErrors[v.key] = errs
        hasError = true
      }
    }
    const comparisonErrors = validateComparisonConstraints(localVariables)
    for (const [key, errs] of Object.entries(comparisonErrors)) {
      allErrors[key] = { ...allErrors[key], ...errs }
      hasError = true
    }
    setValidationErrors(allErrors)
    if (hasError) {
      toast({
        title: cs.questions.validation.nameRequired,
        description: cs.questions.validation.checkHighlighted,
        variant: "destructive",
      })
      return
    }

    setEditingVariableKey(null)

    const variableMutations: VariableMutation[] = []
    for (const v of localVariables) {
      if (v.isRemoved && v.variableId) {
        variableMutations.push({ action: "remove", variableId: v.variableId })
      } else if (v.isNew) {
        variableMutations.push({
          action: "create",
          placeholder: v.placeholder,
          greaterThanVariableId: emptyToUndefined(v.greaterThanVariableId),
          lessThanVariableId: emptyToUndefined(v.lessThanVariableId),
          variable: buildVariableInput(v),
        })
      } else if (v.variableId) {
        const original = originalVariables.find((o) => o.key === v.key)
        if (variableChanged(v, original)) {
          if (v.isShared) {
            variableMutations.push({
              action: "clone",
              oldVariableId: v.variableId,
              placeholder: v.placeholder,
              greaterThanVariableId: emptyToUndefined(v.greaterThanVariableId),
              lessThanVariableId: emptyToUndefined(v.lessThanVariableId),
              variable: buildVariableInput(v),
            })
          } else {
            variableMutations.push({
              action: "update",
              variableId: v.variableId,
              placeholder: v.placeholder,
              greaterThanVariableId: emptyToUndefined(v.greaterThanVariableId),
              lessThanVariableId: emptyToUndefined(v.lessThanVariableId),
              variable: buildVariableInput(v),
            })
          }
        } else {
          variableMutations.push({
            action: "keep",
            variableId: v.variableId,
            placeholder: v.placeholder,
            greaterThanVariableId: emptyToUndefined(v.greaterThanVariableId),
            lessThanVariableId: emptyToUndefined(v.lessThanVariableId),
          })
        }
      }
    }

    const sigDigits =
      editSignificantDigits.trim() === "" ? undefined : Number(editSignificantDigits)

    const payload: UpdateTemplateWithVariablesPayload = {
      id: templateId,
      questionText: editText,
      formula: normalizeFormulaForEvaluation(editEquationText),
      equationText: editEquationText ?? "",
      numericAnswer: templateDetails.template.numericAnswer,
      resultUnit: editResultUnit,
      pointValue: templateDetails.template.pointValue,
      significantDigits: sigDigits,
      forceScientific,
      decoys: buildDecoyInputs(decoyRows),
      alternativeFormula: buildAlternativeFormulaInput(alternativeFormula),
      variableMutations,
      constants: templateDetails.constants.map((c) => ({ constantId: c.id })),
      constraint: buildAnswerConstraint(),
    }

    setIsSaving(true)
    try {
      const response = await templatesApi.updateWithVariables(payload)
      setTemplateDetails(response)
      setIsEditingText(false)
      setIsEditingAnswer(false)
      setValidationErrors({})
      await loadTemplateDetails()
      onSaved?.()
      toast({
        title: cs.questions.saveSuccess,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.questions.saveError,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditText(templateDetails?.template.questionText ?? "")
    setEditEquationText(templateDetails?.template.equationText ?? "")
    setEditResultUnit(templateDetails?.template.resultUnit ?? "")
    setEditSignificantDigits(
      templateDetails?.template.significantDigits != null
        ? String(templateDetails.template.significantDigits)
        : "",
    )
    setSdText(
      templateDetails?.template.constraint?.sdAllowed != null
        ? String(templateDetails.template.constraint.sdAllowed)
        : "",
    )
    setForceScientific(templateDetails?.template.forceScientific ?? false)
    setDecoyRows((templateDetails?.decoys ?? []).map(toDecoyRow))
    setAlternativeFormula(templateDetails?.template.alternativeFormula ?? "")
    setShowAlternativeFormulaInput(!!templateDetails?.template.alternativeFormula)
    setIsEditingAnswer(false)
    setLocalVariables(originalVariables.map((v) => ({ ...v })))
    setIsEditingText(false)
    setEditingVariableKey(null)
    setValidationErrors({})
  }

  const handleSaveAnswer = async () => {
    if (!templateDetails) return

    setIsSaving(true)
    try {
      const variableMutations: VariableMutation[] = templateDetails.variables.map((vwp) => ({
        action: "keep",
        variableId: vwp.variable.id,
        placeholder: vwp.placeholder,
      }))

      const sigDigits =
        editSignificantDigits.trim() === "" ? undefined : Number(editSignificantDigits)

      const payload: UpdateTemplateWithVariablesPayload = {
        id: templateId,
        questionText: editText,
        formula: normalizeFormulaForEvaluation(editEquationText),
        equationText: editEquationText ?? "",
        numericAnswer: templateDetails.template.numericAnswer,
        resultUnit: editResultUnit,
        pointValue: templateDetails.template.pointValue,
        significantDigits: sigDigits,
        forceScientific,
        decoys: buildDecoyInputs(decoyRows),
        alternativeFormula: buildAlternativeFormulaInput(alternativeFormula),
        variableMutations,
        constants: templateDetails.constants.map((c) => ({ constantId: c.id })),
        constraint: buildAnswerConstraint(),
      }

      const response = await templatesApi.updateWithVariables(payload)
      setTemplateDetails(response)
      const updatedLocals = response.variables.map(toLocalVariableEdit)
      setLocalVariables(updatedLocals)
      setOriginalVariables(updatedLocals.map((v) => ({ ...v })))
      setIsEditingAnswer(false)
      onSaved?.()
      toast({
        title: cs.questions.saveSuccess,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.questions.saveError,
        description: message,
        variant: "destructive",
      })
      setIsEditingAnswer(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleForceScientific = async () => {
    if (!templateDetails) return
    const newValue = !forceScientific
    setForceScientific(newValue)
    const sigDigits =
      editSignificantDigits.trim() === "" ? undefined : Number(editSignificantDigits)
    const payload: UpdateTemplateWithVariablesPayload = {
      id: templateId,
      questionText: editText,
      formula: normalizeFormulaForEvaluation(editEquationText),
      equationText: editEquationText ?? "",
      numericAnswer: templateDetails.template.numericAnswer,
      resultUnit: editResultUnit,
      pointValue: templateDetails.template.pointValue,
      significantDigits: sigDigits,
      forceScientific: newValue,
      decoys: buildDecoyInputs(decoyRows),
      alternativeFormula: buildAlternativeFormulaInput(alternativeFormula),
      variableMutations: templateDetails.variables.map((vwp) => ({
        action: "keep" as const,
        variableId: vwp.variable.id,
        placeholder: vwp.placeholder,
      })),
      constants: templateDetails.constants.map((c) => ({ constantId: c.id })),
      constraint: buildAnswerConstraint(),
    }
    try {
      const response = await templatesApi.updateWithVariables(payload)
      setTemplateDetails(response)
      onSaved?.()
    } catch (err) {
      setForceScientific(!newValue)
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.questions.saveError,
        description: message,
        variant: "destructive",
      })
    }
  }

  const handleAddVariable = () => {
    syncVariablesFromText(editText, localVariables)
  }

  const syncVariablesFromText = useCallback(
    (text: string, currentVariables: LocalVariableEdit[]) => {
      const placeholders = extractPlaceholders(text)
      const existingByPlaceholder = new Map(currentVariables.map((v) => [v.placeholder, v]))
      const nextVariables: LocalVariableEdit[] = []
      const seen = new Set<string>()

      for (const placeholder of placeholders) {
        if (seen.has(placeholder)) continue
        seen.add(placeholder)
        const existing = existingByPlaceholder.get(placeholder)
        if (existing && !existing.isRemoved) {
          nextVariables.push(existing)
        } else {
          const isElement = isAtomPlaceholder(placeholder)
          nextVariables.push({
            key: `new-${placeholder}-${Date.now()}`,
            variableId: null,
            placeholder,
            name: cs.questions.variableDefaultName.replace("{placeholder}", placeholder),
            symbol: placeholder,
            varType: isElement ? "string" : "numeric",
            minValue: 0,
            maxValue: 100,
            step: 1,
            unit: "",
            precision: isElement ? 0 : 1,
            stringValues: isElement ? [...KNOWN_ELEMENTS] : [],
            greaterThanVariableId: undefined,
            lessThanVariableId: undefined,
            isNew: true,
            isRemoved: false,
            isDirty: true,
            isShared: false,
          })
        }
      }

      // Mark variables no longer present in text as removed rather than deleting
      // them immediately, so their ranges/units are preserved if the user
      // re-typing the placeholder is only temporary.
      for (const variable of currentVariables) {
        if (!seen.has(variable.placeholder) && !variable.isRemoved) {
          nextVariables.push({ ...variable, isRemoved: true, isDirty: true })
        }
      }

      setLocalVariables(nextVariables)
    },
    [],
  )

  const handleVariableChange = (
    key: string,
    field: keyof LocalVariableEdit,
    value: string | number | string[] | Array<Record<string, number>>,
  ) => {
    setLocalVariables((prev) => {
      const index = prev.findIndex((v) => v.key === key)
      if (index === -1) return prev
      const updated = [...prev]
      const current = { ...updated[index] }
      const oldPlaceholder = current.placeholder

      if (
        field === "minValue" ||
        field === "maxValue" ||
        field === "step" ||
        field === "precision"
      ) {
        current[field] = typeof value === "number" ? value : Number(value)
      } else if (field === "stringValues") {
        current[field] = Array.isArray(value) ? (value as string[]) : ([String(value)] as string[])
      } else if (field === "pairedConstants") {
        current[field] = value as Array<Record<string, number>>
      } else {
        ;(current as Record<string, unknown>)[field] = value
      }
      current.isDirty = true
      updated[index] = current

      if (field === "placeholder" && typeof value === "string" && value !== oldPlaceholder) {
        setEditText((text) => replacePlaceholder(text, oldPlaceholder, value))
        current.symbol = value
        current.name = cs.questions.variableDefaultName.replace("{placeholder}", value)
      }

      return updated
    })
  }

  const handleVariableRemove = (key: string) => {
    setLocalVariables((prev) => {
      const index = prev.findIndex((v) => v.key === key)
      if (index === -1) return prev
      const updated = [...prev]
      const current = { ...updated[index] }
      current.isRemoved = !current.isRemoved
      updated[index] = current
      return updated
    })
  }

  const visibleVariables = localVariables.filter((v) => !v.isRemoved && v.placeholder !== "ANS")
  const displayTemplateVariables = templateDetails
    ? templateDetails.variables.filter((vwp) => vwp.placeholder !== "ANS")
    : []
  const displayPrecision =
    templateDetails?.template.significantDigits ??
    Math.max(2, ...displayTemplateVariables.map((v) => v.variable.precision))

  const placeholderHelp = displayTemplateVariables.length > 0 && (
    <div className="text-xs text-foreground-secondary">
      <span className="font-medium">{cs.questions.availablePlaceholders}: </span>
      {displayTemplateVariables.map((vwp, index) => (
        <span key={vwp.variable.id}>
          <code className="bg-muted px-1 rounded">{`[[${vwp.placeholder}]]`}</code>{" "}
          {vwp.variable.unit ? (
            <>
              = {vwp.variable.symbol} (<UnitRenderer unit={vwp.variable.unit} />)
            </>
          ) : (
            `= ${vwp.variable.symbol}`
          )}
          {index < displayTemplateVariables.length - 1 ? ", " : ""}
        </span>
      ))}
    </div>
  )

  const activeEquationText = isEditingAnswer
    ? editEquationText
    : templateDetails?.template.equationText?.trim() || templateDetails?.template.formula || ""

  const fixedPlaceholderValues = useMemo(() => {
    if (!templateDetails) return new Map<string, number>()
    const map = new Map<string, number>()
    for (const { symbol, value } of extractPlaceholderValues(
      templateDetails.template.questionText,
    )) {
      if (value === undefined) continue
      const numeric = parseCzechNumber(value)
      if (numeric !== undefined) {
        map.set(symbol, numeric)
      }
    }
    return map
  }, [templateDetails])

  const equationValidationVariables = useMemo(() => {
    const source = isEditingAnswer ? visibleVariables : displayTemplateVariables
    const variables = source.map((item) => {
      const variable = "variable" in item ? item.variable : item
      return {
        placeholder: item.placeholder,
        symbol: variable.symbol,
        varType: variable.varType,
      }
    })
    for (const placeholder of fixedPlaceholderValues.keys()) {
      variables.push({ placeholder, symbol: placeholder, varType: "numeric" as const })
    }
    // Add symbols that come from string variable paired constants (e.g. Ka from wac)
    for (const item of source) {
      const variable = "variable" in item ? item.variable : item
      if (variable.varType !== "string" || !variable.pairedConstants?.length) continue
      for (const sym of Object.keys(variable.pairedConstants[0])) {
        variables.push({ placeholder: sym, symbol: sym, varType: "numeric" as const })
      }
    }
    return variables
  }, [isEditingAnswer, visibleVariables, displayTemplateVariables, fixedPlaceholderValues])

  const missingReferences = useMemo(
    () => validateEquationReferences(activeEquationText, equationValidationVariables, constants),
    [activeEquationText, equationValidationVariables, constants],
  )

  const questionTargetCount = useMemo(() => extractTargets(editText).length, [editText])

  const decoyMissingReferences = useMemo(() => {
    const byRow: Record<string, string[]> = {}
    for (const row of decoyRows) {
      byRow[row.key] = validateEquationReferences(
        row.formula,
        equationValidationVariables,
        constants,
      )
    }
    return byRow
  }, [decoyRows, equationValidationVariables, constants])

  const alternativeFormulaMissingReferences = useMemo(
    () => validateEquationReferences(alternativeFormula, equationValidationVariables, constants),
    [alternativeFormula, equationValidationVariables, constants],
  )

  const usedConstants = useMemo(() => {
    if (!templateDetails || activeEquationText.trim().length === 0) return []
    const items: { name: string; value: number; unit?: string }[] = []
    const seen = new Set<string>()

    // Exclude variable symbols, placeholders, and answer targets so that
    // placeholders like N or V are not mistaken for element constants.
    const variableSymbols = new Set(
      displayTemplateVariables
        .flatMap((vwp) => [vwp.placeholder, vwp.variable.symbol])
        .filter(Boolean),
    )
    const targets = templateDetails ? extractTargets(templateDetails.template.questionText) : []
    const targetSymbols = targets.map((t) => t.symbol)
    const excludedSymbols = new Set([...variableSymbols, ...targetSymbols])
    const equationWithoutComment = activeEquationText.split("—")[0] ?? activeEquationText

    const molarMassValues = extractMolarMassValues(equationWithoutComment, constants)
    for (const [name, value] of Object.entries(molarMassValues)) {
      if (seen.has(name)) continue
      seen.add(name)
      items.push({ name, value, unit: "g/mol" })
    }

    for (const [symbol, value] of Object.entries(constants)) {
      if (seen.has(symbol) || excludedSymbols.has(symbol)) continue
      const symbolRegex = new RegExp(
        `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
      )
      if (symbolRegex.test(equationWithoutComment)) {
        seen.add(symbol)
        items.push({ name: symbol, value })
      }
    }

    return items
  }, [activeEquationText, constants, templateDetails, displayTemplateVariables])

  const buildSubstitutedEquation = useCallback(
    (
      equationText: string,
      assignedValues: Record<string, number>,
      assignedStrings: Record<string, string>,
    ): string => {
      const text = equationText.trim()
      if (text.length === 0) return ""

      const numericSources = displayTemplateVariables
        .filter((vwp) => vwp.variable.varType === "numeric")
        .map((vwp) => ({ placeholder: vwp.placeholder, symbol: vwp.variable.symbol }))
      const stringSources = displayTemplateVariables
        .filter((vwp) => vwp.variable.varType === "string")
        .map((vwp) => ({ placeholder: vwp.placeholder, symbol: vwp.variable.symbol }))

      const varFormat = new Map<
        string,
        { significantDigits?: number; precision?: number; notation?: Notation }
      >()
      for (const vwp of displayTemplateVariables) {
        if (vwp.placeholder === "ANS") continue
        const fmt = {
          significantDigits: vwp.variable.significantDigits,
          precision: vwp.variable.precision,
          notation: vwp.variable.notation,
        }
        varFormat.set(vwp.placeholder, fmt)
        varFormat.set(vwp.variable.symbol, fmt)
      }
      const fixedSources = Array.from(fixedPlaceholderValues.keys()).map((placeholder) => ({
        placeholder,
        symbol: placeholder,
      }))
      // Symbols injected by string variable paired constants (e.g. Ka from
      // wac, referenced in the text as [[Ka=wac]]) — without these, neither
      // the bracket form nor the bare symbol in the formula ever substitutes.
      const pairedConstantSources = displayTemplateVariables.flatMap((vwp) => {
        if (vwp.variable.varType !== "string" || !vwp.variable.pairedConstants?.length) return []
        return Object.keys(vwp.variable.pairedConstants[0]).map((sym) => ({
          placeholder: sym,
          symbol: sym,
        }))
      })
      const allNumericSources = [...numericSources, ...fixedSources, ...pairedConstantSources]

      let substituted = text
      for (const v of allNumericSources) {
        const value = assignedValues[v.placeholder]
        if (value === undefined) continue
        const fmt = varFormat.get(v.placeholder) ?? varFormat.get(v.symbol)
        substituted = substituted.replace(
          new RegExp(`\\[\\[${escapeRegex(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
          formatValueForSubstitution(value, fmt?.significantDigits, fmt?.precision, fmt?.notation),
        )
      }
      for (const v of stringSources) {
        const value = assignedStrings[v.placeholder]
        if (value === undefined) continue
        substituted = substituted.replace(
          new RegExp(`\\[\\[${escapeRegex(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
          value,
        )
      }

      const symbolsByLength = [...allNumericSources, ...stringSources].sort(
        (a, b) => b.symbol.length - a.symbol.length,
      )
      for (const v of symbolsByLength) {
        const value = assignedValues[v.placeholder] ?? assignedStrings[v.placeholder]
        if (value === undefined) continue
        const fmt = varFormat.get(v.placeholder) ?? varFormat.get(v.symbol)
        const formatted =
          typeof value === "number"
            ? formatValueForSubstitution(
                value,
                fmt?.significantDigits,
                fmt?.precision,
                fmt?.notation,
              )
            : value
        substituted = substituted.replace(
          new RegExp(
            `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(v.symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
            "g",
          ),
          formatted,
        )
      }

      substituted = substituteStringsInMolarMassReferences(
        substituted,
        stringSources,
        assignedStrings,
      )
      substituted = resolveMolarMasses(substituted, constants)
      substituted = substituteRemainingMolarMasses(substituted)

      return substituted
    },
    [displayTemplateVariables, fixedPlaceholderValues, constants],
  )

  const undefinedTextPlaceholders = useMemo(() => {
    if (!templateDetails) return []
    const defined = new Set(displayTemplateVariables.map((vwp) => vwp.placeholder))
    for (const placeholder of fixedPlaceholderValues.keys()) {
      defined.add(placeholder)
    }
    // Symbols injected by string variable paired constants (e.g. Ka from wac)
    for (const vwp of displayTemplateVariables) {
      if (vwp.variable.varType !== "string" || !vwp.variable.pairedConstants?.length) continue
      for (const sym of Object.keys(vwp.variable.pairedConstants[0])) {
        defined.add(sym)
      }
    }
    return extractPlaceholders(templateDetails.template.questionText).filter(
      (placeholder) => !defined.has(placeholder),
    )
  }, [templateDetails, displayTemplateVariables, fixedPlaceholderValues])

  const mockResult = useMemo(() => {
    const text = activeEquationText.trim()
    const hasFixedValues = fixedPlaceholderValues.size > 0
    if (!text || (visibleVariables.length === 0 && !hasFixedValues)) {
      return null
    }

    const rng = createRandom(mockSeed)
    const numericVariables = visibleVariables.filter((v) => v.varType === "numeric")
    const mockValues: Record<string, number> = {}
    for (const variable of numericVariables) {
      const { minValue, maxValue, step, placeholder } = variable
      if (step <= 0 || maxValue <= minValue) {
        mockValues[placeholder] = minValue
        continue
      }
      const totalSteps = Math.floor((maxValue - minValue) / step)
      const randomStep = Math.floor(rng() * (totalSteps + 1))
      const raw = minValue + randomStep * step
      const stepStr = String(step)
      const dec = stepStr.includes(".") ? stepStr.split(".")[1].length : 0
      mockValues[placeholder] = dec > 0 ? parseFloat(raw.toFixed(dec)) : Math.round(raw)
    }
    for (const [placeholder, value] of fixedPlaceholderValues.entries()) {
      mockValues[placeholder] = value
    }

    const mockStrings: Record<string, string> = {}
    for (const variable of visibleVariables) {
      if (variable.varType !== "string") continue
      const entry = databazeEntries.find(
        (e) => e.code === variable.placeholder || e.code === variable.symbol,
      )
      const values = entry?.values ?? variable.stringValues
      const idx = values && values.length > 0 ? Math.floor(rng() * values.length) : -1
      mockStrings[variable.placeholder] = idx >= 0 && values ? values[idx] : variable.placeholder
      // Inject paired constants for the sampled value index
      const pc = variable.pairedConstants?.[idx]
      if (pc) {
        for (const [sym, val] of Object.entries(pc)) {
          if (!(sym in mockValues)) mockValues[sym] = val
        }
      }
    }

    const usedPlaceholders = new Set(extractPlaceholders(text))
    const referencedVariables = visibleVariables.filter((v) => {
      if (usedPlaceholders.has(v.placeholder)) return true
      const symbolRegex = new RegExp(
        `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(v.symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
      )
      return symbolRegex.test(text)
    })
    const referencedFixedPlaceholders = Array.from(fixedPlaceholderValues.keys()).filter(
      (placeholder) => {
        if (usedPlaceholders.has(placeholder)) return true
        const symbolRegex = new RegExp(
          `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(placeholder)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
        )
        return symbolRegex.test(text)
      },
    )

    if (referencedVariables.some((v) => v.varType === "string")) {
      return { type: "string" as const, mockValues, mockStrings }
    }

    // String variables referenced via M_symbol (e.g. `M_plyn` where plyn is a
    // string variable like "N_2"). The word-boundary regex above won't detect
    // these because the underscore prefix blocks it; detect them separately and
    // substitute their molar mass just as the backend does.
    const molarMassStringSources = visibleVariables
      .filter((v) => {
        if (v.varType !== "string") return false
        const molarMassRegex = new RegExp(`M_${escapeRegex(v.symbol)}(?![A-Za-z0-9_(])`)
        return molarMassRegex.test(text)
      })
      .map((v) => ({ placeholder: v.placeholder, symbol: v.symbol }))

    if (
      numericVariables.length === 0 &&
      fixedPlaceholderValues.size === 0 &&
      molarMassStringSources.length === 0
    ) {
      return null
    }

    const pairedConstantSources = visibleVariables.flatMap((v) => {
      if (v.varType !== "string" || !v.pairedConstants?.length) return []
      return Object.keys(v.pairedConstants[0]).map((sym) => ({ placeholder: sym, symbol: sym }))
    })
    const allNumericSources = [
      ...numericVariables,
      ...Array.from(fixedPlaceholderValues.keys()).map((placeholder) => ({
        placeholder,
        symbol: placeholder,
      })),
      ...pairedConstantSources,
    ]

    const mockVarFormat = new Map<string, { significantDigits?: number; precision?: number }>()
    for (const v of visibleVariables) {
      if (v.placeholder === "ANS") continue
      const fmt = { significantDigits: v.significantDigits, precision: v.precision }
      mockVarFormat.set(v.placeholder, fmt)
      mockVarFormat.set(v.symbol, fmt)
    }

    let substituted = text
    for (const v of allNumericSources) {
      const value = mockValues[v.placeholder]
      if (value === undefined) continue
      const fmt = mockVarFormat.get(v.placeholder) ?? mockVarFormat.get(v.symbol)
      substituted = substituted.replace(
        new RegExp(`\\[\\[${escapeRegex(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
        formatValueForSubstitution(value, fmt?.significantDigits, fmt?.precision),
      )
    }

    const symbolsByLength = [...allNumericSources].sort((a, b) => b.symbol.length - a.symbol.length)
    for (const v of symbolsByLength) {
      const value = mockValues[v.placeholder]
      if (value === undefined) continue
      const fmt = mockVarFormat.get(v.placeholder) ?? mockVarFormat.get(v.symbol)
      substituted = substituted.replace(
        new RegExp(
          `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(v.symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
          "g",
        ),
        formatValueForSubstitution(value, fmt?.significantDigits, fmt?.precision),
      )
    }

    substituted = substituteStringsInMolarMassReferences(
      substituted,
      molarMassStringSources,
      mockStrings,
    )
    substituted = resolveMolarMasses(substituted, constants)
    substituted = substituteRemainingMolarMasses(substituted)

    const normalized = normalizeFormulaForEvaluation(substituted)

    try {
      const value = evaluateExpression(normalized, {}, constants)
      const resultPrecision =
        templateDetails?.template.significantDigits ??
        Math.max(
          2,
          ...referencedVariables.filter((v) => v.varType === "numeric").map((v) => v.precision),
          ...referencedFixedPlaceholders.map(() => 2),
        )
      // Multiple semicolon-separated targets (e.g. "c = ...; wDsc = ...")
      // each get their own answer line — evaluateExpression alone only
      // surfaces the last one.
      const allTargets = evaluateAllAssignments(normalized, {}, constants)
      const targetUnits = templateDetails
        ? applyResultUnits(extractTargets(templateDetails.template.questionText), editResultUnit)
        : []
      const answersData =
        allTargets.length > 1
          ? allTargets.map((t) => ({
              ...t,
              unit: targetUnits.find((target) => target.symbol === t.symbol)?.unit,
            }))
          : undefined
      return {
        type: "numeric" as const,
        value,
        mockValues,
        mockStrings,
        substituted,
        resultPrecision,
        answersData,
      }
    } catch (err) {
      return {
        type: "error" as const,
        error: err instanceof Error ? err.message : String(err),
        mockValues,
        mockStrings,
      }
    }
  }, [
    activeEquationText,
    visibleVariables,
    databazeEntries,
    mockSeed,
    constants,
    fixedPlaceholderValues,
    templateDetails,
    editResultUnit,
  ])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>{cs.questions.detailTitle}</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isLoading || isDeleting}
          >
            <Trash2 className="size-4 mr-2" />
            {cs.common.delete}
          </Button>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-4 py-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-36" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          </div>
        )}

        {error && (
          <div className="text-red-500 text-center py-4">
            <p>{error}</p>
          </div>
        )}

        {templateDetails && (
          <div className="space-y-6 min-w-0">
            {/* Question Text */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">{cs.questions.questionText}</CardTitle>
                {isEditingText ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleSave} disabled={isSaving || !hasChanges}>
                      {isSaving ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="size-4 mr-2" />
                      )}
                      {cs.questions.saveQuestion}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
                      <X className="size-4 mr-2" />
                      {cs.questions.cancelEdit}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setIsEditingText(true)}>
                    <Pencil className="size-4 mr-2" />
                    {cs.questions.editQuestion}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {isEditingText ? (
                  <Textarea
                    value={editText}
                    onChange={(e) => {
                      const nextText = e.target.value
                      setEditText(nextText)
                      syncVariablesFromText(nextText, localVariables)
                    }}
                    rows={6}
                    disabled={isSaving}
                  />
                ) : (
                  <div className="max-w-none prose prose-sm dark:prose-invert break-words">
                    <ReactMarkdown
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        // A stray "*" left over from formula notation (e.g. an
                        // unspaced multiplication sign formatChemicalText didn't
                        // catch) must never read as markdown emphasis here.
                        em: ({ children }) => <>{children}</>,
                      }}
                    >
                      {formatChemicalText(
                        stripAnswerTargets(templateDetails.template.questionText),
                      )}
                    </ReactMarkdown>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Variable Settings */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{cs.questions.variables}</CardTitle>
                  <CardDescription>{cs.questions.variablesDescription}</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={handleAddVariable} disabled={isSaving}>
                  <Plus className="size-4 mr-2" />
                  {cs.questions.addVariable}
                </Button>
              </CardHeader>
              <CardContent>
                {visibleVariables.length === 0 ? (
                  <p className="text-foreground-secondary text-sm">{cs.sets.noQuestions}</p>
                ) : (
                  <div className="space-y-3">
                    {visibleVariables.map((v, index) => (
                      <VariableEditorRow
                        key={v.key}
                        variable={v}
                        index={index}
                        isEditing={editingVariableKey === v.key}
                        errors={validationErrors[v.key] ?? {}}
                        isSaving={isSaving}
                        allVariables={localVariables}
                        onChange={(field, value) => handleVariableChange(v.key, field, value)}
                        onEdit={() => setEditingVariableKey(v.key)}
                        onCancel={() => setEditingVariableKey(null)}
                        onSave={handleSave}
                        onRemove={() => handleVariableRemove(v.key)}
                      />
                    ))}
                  </div>
                )}

                {dirtyVariableKeys.size > 0 && (
                  <div className="mt-4 flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="size-4 mr-2" />
                      )}
                      {cs.questions.saveAll}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ukázka */}
            {sampleVariant && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{cs.questions.sampleTitle}</CardTitle>
                  <CardDescription>{cs.questions.sampleDescription}</CardDescription>
                </CardHeader>
                <CardContent>
                  <QuestionTextRenderer
                    text={templateDetails.template.questionText}
                    variables={displayTemplateVariables}
                    variant={sampleVariant}
                    constants={constants}
                  />
                </CardContent>
              </Card>
            )}

            {/* Odpověď */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{cs.questions.answerTitle}</CardTitle>
                  <CardDescription>{cs.questions.answerDescription}</CardDescription>
                </div>
                {!isEditingAnswer && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingAnswer(true)}
                    disabled={isSaving}
                  >
                    <Pencil className="size-4 mr-2" />
                    {cs.common.edit}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditingAnswer ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="equationText">{cs.questions.equationLabel}</Label>
                      <Input
                        id="equationText"
                        value={editEquationText}
                        onChange={(e) => {
                          setEditEquationText(e.target.value)
                        }}
                        placeholder="w = m(KOH) / (m(KOH) + m(vody)) × 100 %"
                        disabled={isSaving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="resultUnit">{cs.questions.resultUnit}</Label>
                      <Input
                        id="resultUnit"
                        value={editResultUnit}
                        onChange={(e) => setEditResultUnit(e.target.value)}
                        placeholder="%"
                        disabled={isSaving}
                      />
                      <p className="text-xs text-muted-foreground">{cs.form.unitFormatHint}</p>
                      {questionTargetCount > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {cs.questions.multiTargetUnitHint}
                        </p>
                      )}
                      {editResultUnit.trim() && (
                        <p className="text-xs text-muted-foreground">
                          Náhled:{" "}
                          <UnitRenderer
                            unit={editResultUnit}
                            className="font-medium text-foreground"
                          />
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="significantDigits">{cs.questions.significantDigits}</Label>
                      <Input
                        id="significantDigits"
                        type="number"
                        value={editSignificantDigits}
                        onChange={(e) => setEditSignificantDigits(e.target.value)}
                        placeholder="např. 4"
                        min={1}
                        max={10}
                        disabled={isSaving}
                        className="max-w-[120px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        {cs.questions.significantDigitsHelp}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="answerSd">{cs.questions.sdAnswerLabel}</Label>
                      <Input
                        id="answerSd"
                        type="number"
                        step="any"
                        value={sdText}
                        onChange={(e) => setSdText(e.target.value)}
                        placeholder="např. 0.2"
                        disabled={isSaving}
                        className="max-w-[120px]"
                      />
                      <p className="text-xs text-muted-foreground">{cs.questions.sdAnswerHelp}</p>
                    </div>
                    {editEquationText.trim().length > 0 && (
                      <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                        <p className="text-sm font-medium text-foreground-secondary">
                          {cs.questions.equationPreview}
                        </p>
                        <MathRenderer text={renderEquationAsLatex(editEquationText)} />
                        {missingReferences.length > 0 && (
                          <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                            <p className="font-medium">{cs.questions.missingVariables}</p>
                            <p className="text-xs opacity-90 mb-1">
                              {cs.questions.missingVariablesDescription}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {missingReferences.map((name) => (
                                <code
                                  key={name}
                                  className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded"
                                >
                                  [[{name}]]
                                </code>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="space-y-2">
                      {showAlternativeFormulaInput ? (
                        <>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="alternativeFormula">
                              {cs.questions.alternativeEquationLabel}
                            </Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setAlternativeFormula("")
                                setShowAlternativeFormulaInput(false)
                              }}
                              disabled={isSaving}
                            >
                              <X className="size-4 mr-2" />
                              {cs.questions.removeAlternative}
                            </Button>
                          </div>
                          <Input
                            id="alternativeFormula"
                            value={alternativeFormula}
                            onChange={(e) => setAlternativeFormula(e.target.value)}
                            placeholder="X * 3 + Y"
                            disabled={isSaving}
                          />
                          {alternativeFormula.trim().length > 0 && (
                            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                              <p className="text-sm font-medium text-foreground-secondary">
                                {cs.questions.equationPreview}
                              </p>
                              <MathRenderer text={renderEquationAsLatex(alternativeFormula)} />
                              {alternativeFormulaMissingReferences.length > 0 && (
                                <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                                  <p className="font-medium">{cs.questions.missingVariables}</p>
                                  <p className="text-xs opacity-90 mb-1">
                                    {cs.questions.missingVariablesDescription}
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {alternativeFormulaMissingReferences.map((name) => (
                                      <code
                                        key={name}
                                        className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded"
                                      >
                                        [[{name}]]
                                      </code>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAlternativeFormulaInput(true)}
                          disabled={isSaving}
                        >
                          <Plus className="size-4 mr-2" />
                          {cs.questions.addAlternative}
                        </Button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {decoyRows.map((row, index) => {
                        const rowMissingReferences = decoyMissingReferences[row.key] ?? []
                        return (
                          <div key={row.key} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label htmlFor={`decoyFormula-${row.key}`}>
                                {cs.questions.decoyEquationLabel}
                                {decoyRows.length > 1 ? ` #${index + 1}` : ""}
                              </Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setDecoyRows((rows) => rows.filter((r) => r.key !== row.key))
                                }
                                disabled={isSaving}
                              >
                                <X className="size-4 mr-2" />
                                {cs.questions.removeDecoy}
                              </Button>
                            </div>
                            <div className="flex items-start gap-3">
                              <Input
                                id={`decoyFormula-${row.key}`}
                                value={row.formula}
                                onChange={(e) =>
                                  setDecoyRows((rows) =>
                                    rows.map((r) =>
                                      r.key === row.key ? { ...r, formula: e.target.value } : r,
                                    ),
                                  )
                                }
                                placeholder="X * 3"
                                disabled={isSaving}
                                className="flex-1"
                              />
                              <div className="flex items-center gap-2">
                                <Label
                                  htmlFor={`decoyOptionCount-${row.key}`}
                                  className="text-xs text-muted-foreground whitespace-nowrap"
                                >
                                  {cs.questions.decoyOptionCountLabel}
                                </Label>
                                <Input
                                  id={`decoyOptionCount-${row.key}`}
                                  type="number"
                                  min={1}
                                  value={row.optionCount}
                                  onChange={(e) => {
                                    const parsed = Number.parseInt(e.target.value, 10)
                                    const optionCount =
                                      Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
                                    setDecoyRows((rows) =>
                                      rows.map((r) =>
                                        r.key === row.key ? { ...r, optionCount } : r,
                                      ),
                                    )
                                  }}
                                  disabled={isSaving}
                                  className="w-20"
                                />
                              </div>
                            </div>
                            {row.formula.trim().length > 0 && (
                              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                                <p className="text-sm font-medium text-foreground-secondary">
                                  {cs.questions.equationPreview}
                                </p>
                                <MathRenderer text={renderEquationAsLatex(row.formula)} />
                                {rowMissingReferences.length > 0 && (
                                  <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                                    <p className="font-medium">{cs.questions.missingVariables}</p>
                                    <p className="text-xs opacity-90 mb-1">
                                      {cs.questions.missingVariablesDescription}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                      {rowMissingReferences.map((name) => (
                                        <code
                                          key={name}
                                          className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded"
                                        >
                                          [[{name}]]
                                        </code>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDecoyRows((rows) => [
                            ...rows,
                            { key: generateId(), formula: "", optionCount: 1 },
                          ])
                        }
                        disabled={isSaving}
                      >
                        <Plus className="size-4 mr-2" />
                        {cs.questions.addDecoy}
                      </Button>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditEquationText(templateDetails.template.equationText ?? "")
                          setDecoyRows(templateDetails.decoys.map(toDecoyRow))
                          setIsEditingAnswer(false)
                        }}
                        disabled={isSaving}
                      >
                        <X className="size-4 mr-2" />
                        {cs.common.cancel}
                      </Button>
                      <Button size="sm" onClick={handleSaveAnswer} disabled={isSaving}>
                        {isSaving ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="size-4 mr-2" />
                        )}
                        {cs.common.save}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Equation text */}
                    <div className="rounded-lg bg-muted/50 p-4">
                      <p className="text-sm font-medium text-foreground-secondary mb-1">
                        {cs.questions.equationLabel}
                      </p>
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        {templateDetails.template.equationText ? (
                          <MathRenderer
                            text={renderEquationAsLatex(templateDetails.template.equationText)}
                            className="[&_.katex-display]:!my-0 [&_p]:!my-0"
                          />
                        ) : templateDetails.template.formula ? (
                          <MathRenderer
                            text={renderEquationAsLatex(templateDetails.template.formula)}
                            className="[&_.katex-display]:!my-0 [&_p]:!my-0"
                          />
                        ) : (
                          <div className="space-y-1">
                            <p className="text-base text-foreground-secondary">
                              {cs.questions.equationNotSet}
                            </p>
                            {placeholderHelp}
                          </div>
                        )}
                        {usedConstants.length > 0 && (
                          <div className="-mt-5 rounded-md bg-muted/70 p-3">
                            <p className="text-xs font-medium text-foreground-secondary mb-2">
                              {cs.questions.usedConstants}
                            </p>
                            <div className="space-y-1">
                              {usedConstants.map(({ name, value, unit }) => (
                                <div
                                  key={name}
                                  className="flex items-center justify-between gap-4 text-sm"
                                >
                                  <code className="text-foreground-secondary">{name}</code>
                                  <span className="font-medium whitespace-nowrap">
                                    {formatNumberForText(value, unit === "g/mol" ? 2 : 4)}
                                    {unit ? " " : ""}
                                    {unit ? <UnitRenderer unit={unit} /> : null}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {missingReferences.length > 0 && (
                        <div className="mt-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                          <p className="font-medium">{cs.questions.missingVariables}</p>
                          <p className="text-xs opacity-90 mb-1">
                            {cs.questions.missingVariablesDescription}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {missingReferences.map((name) => (
                              <code
                                key={name}
                                className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded"
                              >
                                [[{name}]]
                              </code>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Computed answer */}
                    <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <p className="text-sm font-medium text-foreground-secondary">
                          {cs.questions.computedAnswerLabel}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant={forceScientific ? "secondary" : "outline"}
                          onClick={handleToggleForceScientific}
                        >
                          {forceScientific ? "1.23×10⁴" : "12300"}
                        </Button>
                      </div>
                      {templateDetails.template.formula && sampleVariant ? (
                        <div className="space-y-3">
                          {(() => {
                            const substituted = buildSubstitutedEquation(
                              activeEquationText,
                              sampleVariant.assignedValues,
                              sampleVariant.assignedStrings ?? {},
                            )
                            return substituted.trim().length > 0 ? (
                              <div className="rounded-lg bg-muted/30 p-3">
                                <p className="text-xs font-medium text-foreground-secondary mb-1">
                                  {cs.questions.equationLabel}
                                </p>
                                <MathRenderer text={renderEquationAsLatex(substituted)} />
                              </div>
                            ) : null
                          })()}
                          <div className="flex items-center justify-between gap-4">
                            {sampleVariant.answersData && sampleVariant.answersData.length > 1 ? (
                              <div className="space-y-1">
                                {sampleVariant.answersData.map((a) => (
                                  <p key={a.symbol} className="text-xl font-bold text-primary">
                                    {a.symbol} ={" "}
                                    <FormattedResult
                                      value={a.value}
                                      precision={displayPrecision}
                                      forceScientific={forceScientific}
                                      significantDigits={
                                        templateDetails?.template.significantDigits
                                      }
                                      unit={a.unit}
                                    />
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-2xl font-bold text-primary">
                                <FormattedResult
                                  value={sampleVariant.correctAnswer}
                                  precision={displayPrecision}
                                  forceScientific={forceScientific}
                                  significantDigits={templateDetails?.template.significantDigits}
                                  unit={templateDetails.template.resultUnit}
                                />
                              </p>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setSampleSeed((s) => s + 1)}
                            >
                              {cs.questions.regenerateMock}
                            </Button>
                          </div>
                        </div>
                      ) : templateDetails.template.numericAnswer != null ? (
                        <div className="space-y-1">
                          <p className="text-2xl font-bold text-primary">
                            <FormattedResult
                              value={templateDetails.template.numericAnswer}
                              precision={displayPrecision}
                              forceScientific={forceScientific}
                              significantDigits={templateDetails?.template.significantDigits}
                              unit={templateDetails.template.resultUnit}
                            />
                          </p>
                          <p className="text-xs text-foreground-secondary">
                            {cs.questions.importedAnswer}
                          </p>
                        </div>
                      ) : mockResult?.type === "error" ? (
                        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
                          <p className="font-medium">{cs.questions.equationError}</p>
                          <p className="text-xs opacity-90 mb-1">
                            {cs.questions.equationErrorDescription}
                          </p>
                          <p className="text-sm font-mono break-words">{mockResult.error}</p>
                        </div>
                      ) : mockResult ? (
                        <div className="space-y-3">
                          <div>
                            <p className="text-sm font-medium text-foreground-secondary mb-1">
                              {cs.questions.mockResult}
                            </p>
                            <p className="text-xs text-foreground-secondary">
                              {cs.questions.mockResultDescription}
                            </p>
                          </div>
                          {mockResult.type === "string" ? (
                            <p className="text-base font-medium text-amber-600">
                              {cs.questions.cannotComputeString}
                            </p>
                          ) : (
                            <>
                              <div className="rounded-lg bg-muted/30 p-3">
                                <p className="text-xs font-medium text-foreground-secondary mb-1">
                                  {cs.questions.mockQuestionTitle}
                                </p>
                                <QuestionTextRenderer
                                  text={templateDetails.template.questionText}
                                  variables={displayTemplateVariables}
                                  variant={{
                                    id: "",
                                    templateId: templateDetails.template.id,
                                    assignedValues: mockResult.mockValues,
                                    assignedStrings: mockResult.mockStrings,
                                    correctAnswer: mockResult.value,
                                    seed: 0,
                                    createdAt: "",
                                  }}
                                  constants={constants}
                                />
                              </div>
                              {mockResult.substituted.trim().length > 0 && (
                                <div className="rounded-lg bg-muted/30 p-3">
                                  <p className="text-xs font-medium text-foreground-secondary mb-1">
                                    {cs.questions.equationLabel}
                                  </p>
                                  <MathRenderer
                                    text={renderEquationAsLatex(mockResult.substituted)}
                                  />
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="text-xs font-medium text-foreground-secondary mb-1">
                                    {cs.questions.computedAnswerLabel}
                                  </p>
                                  {mockResult.answersData ? (
                                    <div className="space-y-1">
                                      {mockResult.answersData.map((a) => (
                                        <p
                                          key={a.symbol}
                                          className="text-xl font-bold text-primary"
                                        >
                                          {a.symbol} ={" "}
                                          <FormattedResult
                                            value={a.value}
                                            precision={mockResult.resultPrecision}
                                            forceScientific={forceScientific}
                                            significantDigits={
                                              templateDetails?.template.significantDigits
                                            }
                                            unit={a.unit ?? templateDetails.template.resultUnit}
                                          />
                                        </p>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-2xl font-bold text-primary">
                                      <FormattedResult
                                        value={mockResult.value}
                                        precision={mockResult.resultPrecision}
                                        forceScientific={forceScientific}
                                        significantDigits={
                                          templateDetails?.template.significantDigits
                                        }
                                        unit={templateDetails.template.resultUnit}
                                      />
                                    </p>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setMockSeed((s) => s + 1)}
                                >
                                  {cs.questions.regenerateMock}
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <p className="text-lg font-semibold text-foreground-secondary">
                              {cs.questions.formulaNotSet}
                            </p>
                            <p className="text-sm text-foreground-secondary">
                              {cs.questions.formulaNotSetDescription}
                            </p>
                          </div>
                          {missingReferences.length > 0 && (
                            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                              <p className="font-medium">{cs.questions.missingVariables}</p>
                              <p className="text-xs opacity-90 mb-1">
                                {cs.questions.missingVariablesDescription}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {missingReferences.map((name) => (
                                  <code
                                    key={name}
                                    className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded"
                                  >
                                    [[{name}]]
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}
                          {undefinedTextPlaceholders.length > 0 && (
                            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
                              <p className="font-medium">{cs.questions.undefinedPlaceholders}</p>
                              <p className="text-xs opacity-90 mb-1">
                                {cs.questions.undefinedPlaceholdersDescription}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {undefinedTextPlaceholders.map((name) => (
                                  <code
                                    key={name}
                                    className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded"
                                  >
                                    [[{name}]]
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Alternace (read-only) */}
                    {templateDetails.template.alternativeFormula &&
                      templateDetails.template.alternativeFormula.trim() !== "" && (
                        <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                          <p className="text-sm font-medium text-foreground-secondary">
                            {cs.questions.alternativeEquationLabel}
                          </p>
                          <MathRenderer
                            text={renderEquationAsLatex(
                              templateDetails.template.alternativeFormula,
                            )}
                            className="[&_.katex-display]:!my-0 [&_p]:!my-0"
                          />
                        </div>
                      )}

                    {/* Decoys (read-only) */}
                    {templateDetails.decoys.length > 0 && (
                      <div className="space-y-3">
                        {templateDetails.decoys.map((decoy, index) => (
                          <div key={decoy.id} className="rounded-lg bg-muted/50 p-4 space-y-2">
                            <p className="text-sm font-medium text-foreground-secondary">
                              {cs.questions.decoyEquationLabel}
                              {templateDetails.decoys.length > 1 ? ` #${index + 1}` : ""}
                            </p>
                            <MathRenderer
                              text={renderEquationAsLatex(decoy.formula)}
                              className="[&_.katex-display]:!my-0 [&_p]:!my-0"
                            />
                            <p className="text-xs text-muted-foreground">
                              {cs.questions.decoyOptionCountLabel}: {decoy.optionCount}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* History */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{cs.questions.historyTitle}</CardTitle>
                  <CardDescription>{cs.questions.historyDescription}</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearHistoryClick}
                  disabled={historyEntries.length === 0}
                >
                  <Trash2 className="size-4 mr-2" />
                  {cs.questions.clearHistory}
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingHistory && historyEntries.length === 0 ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : historyEntries.length === 0 ? (
                  <p className="text-foreground-secondary text-sm text-center py-4">
                    {cs.questions.historyEmpty}
                  </p>
                ) : (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">
                          {cs.questions.historyColumns.date}
                        </TableHead>
                        <TableHead className="w-[100px]">
                          {cs.questions.historyColumns.variable}
                        </TableHead>
                        <TableHead className="w-[100px]">
                          {cs.questions.historyColumns.field}
                        </TableHead>
                        <TableHead className="break-words">
                          {cs.questions.historyColumns.oldValue}
                        </TableHead>
                        <TableHead className="break-words">
                          {cs.questions.historyColumns.newValue}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(entry.changedAt).toLocaleString("cs-CZ")}
                          </TableCell>
                          <TableCell className="break-words">
                            {entry.kind === "template"
                              ? cs.questions.historyColumns.template
                              : entry.variableId}
                          </TableCell>
                          <TableCell className="break-words">
                            {entry.fieldName in cs.questions.historyFields
                              ? cs.questions.historyFields[
                                  entry.fieldName as keyof typeof cs.questions.historyFields
                                ]
                              : entry.fieldName}
                          </TableCell>
                          <TableCell className="break-words align-top">
                            {entry.oldValue || "—"}
                          </TableCell>
                          <TableCell className="break-words align-top">
                            {entry.newValue || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
      <ConfirmDialog
        open={isClearHistoryDialogOpen}
        onOpenChange={setIsClearHistoryDialogOpen}
        title={cs.questions.clearHistory}
        description={cs.questions.clearHistoryConfirm}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={handleClearHistoryConfirm}
      />
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={cs.sets.deleteQuestion}
        description={cs.sets.deleteQuestionConfirm.replace(
          "{name}",
          templateDetails?.template.questionText ?? "",
        )}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={handleDeleteConfirm}
      />
    </Dialog>
  )
}
