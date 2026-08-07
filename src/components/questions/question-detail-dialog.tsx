import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MathRenderer } from "@/components/ui/math-renderer"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, constantsApi, generationApi, historyApi, templatesApi } from "@/lib/api"
import { normalizeFormulaForEvaluation } from "@/lib/bulk-import-parser"
import { extractTargets } from "@/lib/formula-checker"
import {
  createRandom,
  evaluateExpression,
  extractMolarMassValues,
  renderEquationAsLatex,
  resolveMolarMasses,
  substituteRemainingMolarMasses,
  substituteStringsInMolarMassReferences,
  validateEquationReferences,
} from "@/lib/math-utils"
import { KNOWN_ELEMENTS } from "@/lib/periodic-table-data"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import type {
  HistoryEntry,
  LocalVariableEdit,
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
    greaterThanVariableId: vwp.greaterThanVariableId,
    lessThanVariableId: vwp.lessThanVariableId,
    isNew: false,
    isRemoved: false,
    isDirty: false,
    isShared: vwp.isShared,
  }
}

function getNextPlaceholder(variables: LocalVariableEdit[]): string {
  const placeholders = ["X", "Y", "Z"]
  const used = new Set(variables.map((v) => v.placeholder))
  for (const ph of placeholders) {
    if (!used.has(ph)) return ph
  }
  let index = 1
  while (used.has(`V${String(index).padStart(2, "0")}`)) {
    index++
  }
  return `V${String(index).padStart(2, "0")}`
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
    current.placeholder !== original.placeholder ||
    current.greaterThanVariableId !== original.greaterThanVariableId ||
    current.lessThanVariableId !== original.lessThanVariableId ||
    JSON.stringify(current.stringValues ?? []) !== JSON.stringify(original.stringValues ?? []) ||
    JSON.stringify(current.pairedConstants ?? []) !== JSON.stringify(original.pairedConstants ?? [])
  )
}

export function QuestionDetailDialog({
  templateId,
  open,
  onClose,
  onDelete,
}: QuestionDetailDialogProps) {
  const [templateDetails, setTemplateDetails] = useState<TemplateWithDetails | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditingText, setIsEditingText] = useState(false)
  const [editText, setEditText] = useState("")
  const [localVariables, setLocalVariables] = useState<LocalVariableEdit[]>([])
  const [originalVariables, setOriginalVariables] = useState<LocalVariableEdit[]>([])
  const [editingVariableKey, setEditingVariableKey] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, Record<string, string>>>(
    {},
  )
  const [isSaving, setIsSaving] = useState(false)
  const [sampleVariant, setSampleVariant] = useState<Variant | null>(null)
  const [isEditingAnswer, setIsEditingAnswer] = useState(false)
  const [editEquationText, setEditEquationText] = useState("")
  const [editResultUnit, setEditResultUnit] = useState("")
  const [mockSeed, setMockSeed] = useState(0)
  const [sampleSeed, setSampleSeed] = useState(1)

  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isClearHistoryDialogOpen, setIsClearHistoryDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [constants, setConstants] = useState<Record<string, number>>({})

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
      setIsLoading(true)
      setError(null)
      const details = await templatesApi.getWithDetails(templateId)
      setTemplateDetails(details)
      const locals = details.variables.map(toLocalVariableEdit)
      setLocalVariables(locals)
      setOriginalVariables(locals.map((v) => ({ ...v })))
      setEditText(details.template.questionText)
      setEditEquationText(details.template.equationText ?? "")
      setEditResultUnit(details.template.resultUnit)
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
    return dirtyVariableKeys.size > 0
  }, [editText, editEquationText, editResultUnit, templateDetails, dirtyVariableKeys])

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
          greaterThanVariableId: v.greaterThanVariableId,
          lessThanVariableId: v.lessThanVariableId,
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
              greaterThanVariableId: v.greaterThanVariableId,
              lessThanVariableId: v.lessThanVariableId,
              variable: buildVariableInput(v),
            })
          } else {
            variableMutations.push({
              action: "update",
              variableId: v.variableId,
              placeholder: v.placeholder,
              greaterThanVariableId: v.greaterThanVariableId,
              lessThanVariableId: v.lessThanVariableId,
              variable: buildVariableInput(v),
            })
          }
        } else {
          variableMutations.push({
            action: "keep",
            variableId: v.variableId,
            placeholder: v.placeholder,
            greaterThanVariableId: v.greaterThanVariableId,
            lessThanVariableId: v.lessThanVariableId,
          })
        }
      }
    }

    const payload: UpdateTemplateWithVariablesPayload = {
      id: templateId,
      questionText: editText,
      formula: normalizeFormulaForEvaluation(editEquationText),
      equationText: editEquationText ?? "",
      numericAnswer: templateDetails.template.numericAnswer,
      resultUnit: editResultUnit,
      pointValue: templateDetails.template.pointValue,
      variableMutations,
      constants: templateDetails.constants.map((c) => ({ constantId: c.id })),
      constraint: templateDetails.template.constraint,
    }

    setIsSaving(true)
    try {
      const response = await templatesApi.updateWithVariables(payload)
      setTemplateDetails(response)
      setIsEditingText(false)
      setIsEditingAnswer(false)
      setValidationErrors({})
      await loadTemplateDetails()
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

      const payload: UpdateTemplateWithVariablesPayload = {
        id: templateId,
        questionText: templateDetails.template.questionText,
        formula: normalizeFormulaForEvaluation(editEquationText),
        equationText: editEquationText ?? "",
        numericAnswer: templateDetails.template.numericAnswer,
        resultUnit: editResultUnit,
        pointValue: templateDetails.template.pointValue,
        variableMutations,
        constants: templateDetails.constants.map((c) => ({ constantId: c.id })),
        constraint: templateDetails.template.constraint,
      }

      const response = await templatesApi.updateWithVariables(payload)
      setTemplateDetails(response)
      const updatedLocals = response.variables.map(toLocalVariableEdit)
      setLocalVariables(updatedLocals)
      setOriginalVariables(updatedLocals.map((v) => ({ ...v })))
      setIsEditingAnswer(false)
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

  const handleAddVariable = () => {
    const placeholder = getNextPlaceholder(localVariables)
    const placeholderTag = `[[${placeholder}]]`
    const nextText =
      editText.trim().length > 0 ? `${editText.trimEnd()} ${placeholderTag}` : placeholderTag
    setEditText(nextText)
    syncVariablesFromText(nextText, localVariables)
    setEditingVariableKey(null)
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

  const placeholderHelp = displayTemplateVariables.length > 0 && (
    <div className="text-xs text-foreground-secondary">
      <span className="font-medium">{cs.questions.availablePlaceholders}: </span>
      {displayTemplateVariables.map((vwp, index) => (
        <span key={vwp.variable.id}>
          <code className="bg-muted px-1 rounded">{`[[${vwp.placeholder}]]`}</code>{" "}
          {vwp.variable.unit
            ? `= ${vwp.variable.symbol} (${vwp.variable.unit})`
            : `= ${vwp.variable.symbol}`}
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
      const fixedSources = Array.from(fixedPlaceholderValues.keys()).map((placeholder) => ({
        placeholder,
        symbol: placeholder,
      }))
      const allNumericSources = [...numericSources, ...fixedSources]

      let substituted = text
      for (const v of allNumericSources) {
        const value = assignedValues[v.placeholder]
        if (value === undefined) continue
        substituted = substituted.replace(
          new RegExp(`\\[\\[${escapeRegex(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
          String(value),
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
        substituted = substituted.replace(
          new RegExp(
            `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(v.symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
            "g",
          ),
          String(value),
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
      mockStrings[variable.placeholder] = idx >= 0 ? values![idx] : variable.placeholder
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

    const allNumericSources = [
      ...numericVariables,
      ...Array.from(fixedPlaceholderValues.keys()).map((placeholder) => ({
        placeholder,
        symbol: placeholder,
      })),
    ]

    let substituted = text
    for (const v of allNumericSources) {
      const value = mockValues[v.placeholder]
      if (value === undefined) continue
      substituted = substituted.replace(
        new RegExp(`\\[\\[${escapeRegex(v.placeholder)}(?:=[^\\]]*)?\\]\\]`, "g"),
        String(value),
      )
    }

    const symbolsByLength = [...allNumericSources].sort((a, b) => b.symbol.length - a.symbol.length)
    for (const v of symbolsByLength) {
      const value = mockValues[v.placeholder]
      if (value === undefined) continue
      substituted = substituted.replace(
        new RegExp(
          `(?<![A-Za-z0-9_\u03B1-\u03C9])${escapeRegex(v.symbol)}(?![A-Za-z0-9_\u03B1-\u03C9])`,
          "g",
        ),
        String(value),
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
      const resultPrecision = Math.max(
        2,
        ...referencedVariables.filter((v) => v.varType === "numeric").map((v) => v.precision),
        ...referencedFixedPlaceholders.map(() => 2),
      )
      return {
        type: "numeric" as const,
        value,
        mockValues,
        mockStrings,
        substituted,
        resultPrecision,
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
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-8 animate-spin" />
            <span className="ml-2">{cs.common.loading}...</span>
          </div>
        )}

        {error && (
          <div className="text-red-500 text-center py-4">
            <p>{error}</p>
          </div>
        )}

        {templateDetails && (
          <div className="space-y-6">
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
                    <ReactMarkdown>
                      {stripAnswerTargets(templateDetails.template.questionText)}
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
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditEquationText(templateDetails.template.equationText ?? "")
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
                                    {value.toFixed(unit === "g/mol" ? 2 : 4)}
                                    {unit ? ` ${unit}` : ""}
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
                      <p className="text-sm font-medium text-foreground-secondary mb-1">
                        {cs.questions.computedAnswerLabel}
                      </p>
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
                                      precision={Math.max(
                                        2,
                                        ...displayTemplateVariables.map(
                                          (v) => v.variable.precision,
                                        ),
                                      )}
                                      unit={a.unit}
                                    />
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-2xl font-bold text-primary">
                                <FormattedResult
                                  value={sampleVariant.correctAnswer}
                                  precision={Math.max(
                                    2,
                                    ...displayTemplateVariables.map((v) => v.variable.precision),
                                  )}
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
                              precision={Math.max(
                                2,
                                ...displayTemplateVariables.map((v) => v.variable.precision),
                              )}
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
                                  <p className="text-2xl font-bold text-primary">
                                    <FormattedResult
                                      value={mockResult.value}
                                      precision={mockResult.resultPrecision}
                                      unit={templateDetails.template.resultUnit}
                                    />
                                  </p>
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
                {isLoadingHistory ? (
                  <div className="text-center py-4">
                    <Loader2 className="size-6 animate-spin mx-auto" />
                  </div>
                ) : historyEntries.length === 0 ? (
                  <p className="text-foreground-secondary text-sm text-center py-4">
                    {cs.questions.historyEmpty}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{cs.questions.historyColumns.date}</TableHead>
                        <TableHead>{cs.questions.historyColumns.variable}</TableHead>
                        <TableHead>{cs.questions.historyColumns.field}</TableHead>
                        <TableHead>{cs.questions.historyColumns.oldValue}</TableHead>
                        <TableHead>{cs.questions.historyColumns.newValue}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{new Date(entry.changedAt).toLocaleString("cs-CZ")}</TableCell>
                          <TableCell>
                            {entry.kind === "template"
                              ? cs.questions.historyColumns.template
                              : entry.variableId}
                          </TableCell>
                          <TableCell>
                            {entry.fieldName in cs.questions.historyFields
                              ? cs.questions.historyFields[
                                  entry.fieldName as keyof typeof cs.questions.historyFields
                                ]
                              : entry.fieldName}
                          </TableCell>
                          <TableCell>{entry.oldValue || "—"}</TableCell>
                          <TableCell>{entry.newValue || "—"}</TableCell>
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
