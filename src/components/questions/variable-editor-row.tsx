import { Pencil, Save, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

import { cs } from "@/i18n/cs"
import { FIRST_THREE_ROWS_ELEMENTS, KNOWN_ELEMENTS } from "@/lib/periodic-table-data"
import type { LocalVariableEdit, Notation, VariableType } from "@/lib/types"
import { formatDecimalComma } from "@/lib/utils"

// X/Y/Z placeholder colors
const PLACEHOLDER_COLORS: Record<string, string> = {
  X: "text-red-600",
  Y: "text-green-600",
  Z: "text-blue-600",
}

function getAutoPlaceholder(index: number): string {
  return ["X", "Y", "Z"][index] || `V${String(index + 1).padStart(2, "0")}`
}

function getDisplayLabel(v: LocalVariableEdit): string {
  const placeholder = v.placeholder || "?"
  return v.symbol ? `${placeholder} (${v.symbol})` : placeholder
}

// Allows typing intermediate states like "0." or "-" without losing them.
function NumericInput({
  value,
  onChange,
  className,
  min,
  max,
  step,
}: {
  value: number
  onChange: (n: number) => void
  className?: string
  min?: number
  max?: number
  step?: number | string
}) {
  const [text, setText] = useState(String(value))
  // Tracks the last value *we* pushed via onChange, so the sync effect below
  // can tell "parent echoed our own edit" apart from "value changed
  // externally" (e.g. a type switch resetting to a default) — without it,
  // every render would re-derive Number(text), and Number("") === 0 would
  // make an in-progress deletion look like a stale/external value and snap
  // the field back before the user could type a replacement.
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setText(String(value))
    }
  }, [value])

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      className={className}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const parsed = Number(raw)
        if (raw !== "" && Number.isFinite(parsed)) {
          lastEmitted.current = parsed
          onChange(parsed)
        }
      }}
      onBlur={() => {
        // Snap display to canonical number on blur (clears trailing dots etc.);
        // an empty or invalid field reverts to the last committed value.
        const parsed = Number(text)
        if (text !== "" && Number.isFinite(parsed)) {
          setText(String(parsed))
        } else {
          setText(String(lastEmitted.current))
        }
      }}
    />
  )
}

interface ComparisonSelectorsProps {
  variable: LocalVariableEdit
  allVariables: LocalVariableEdit[]
  onChange: (
    field: keyof LocalVariableEdit,
    value: string | number | string[] | Array<Record<string, number>>,
  ) => void
}

function ComparisonSelectors({ variable, allVariables, onChange }: ComparisonSelectorsProps) {
  const candidates = allVariables.filter(
    (v) =>
      v.key !== variable.key && !v.isRemoved && v.varType === "numeric" && v.variableId !== null,
  )

  // Another variable may already constrain this one from the other side
  // (e.g. X was set "greater than Y" — opening Y's editor should immediately
  // show "Y must be less than X" without Y having its own field set).
  const impliedLessThan = allVariables.find(
    (v) => !v.isRemoved && v.greaterThanVariableId === variable.variableId,
  )
  const impliedGreaterThan = allVariables.find(
    (v) => !v.isRemoved && v.lessThanVariableId === variable.variableId,
  )

  const handleGreaterThanChange = (value: string) => {
    onChange("greaterThanVariableId", value === "__none__" ? "" : value)
    if (value !== "__none__") {
      onChange("lessThanVariableId", "")
    }
  }

  const handleLessThanChange = (value: string) => {
    onChange("lessThanVariableId", value === "__none__" ? "" : value)
    if (value !== "__none__") {
      onChange("greaterThanVariableId", "")
    }
  }

  return (
    <div className="space-y-2">
      {(impliedLessThan || impliedGreaterThan) && (
        <p className="text-xs text-muted-foreground">
          {impliedLessThan &&
            cs.questions.impliedLessThan.replace("{variable}", getDisplayLabel(impliedLessThan))}
          {impliedGreaterThan &&
            cs.questions.impliedGreaterThan.replace(
              "{variable}",
              getDisplayLabel(impliedGreaterThan),
            )}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{cs.questions.greaterThan}</Label>
          <Select
            value={variable.greaterThanVariableId || "__none__"}
            onValueChange={handleGreaterThanChange}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{cs.questions.noComparison}</SelectItem>
              {candidates.map((v) => (
                <SelectItem key={v.key} value={v.variableId as string}>
                  {getDisplayLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{cs.questions.lessThan}</Label>
          <Select
            value={variable.lessThanVariableId || "__none__"}
            onValueChange={handleLessThanChange}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{cs.questions.noComparison}</SelectItem>
              {candidates.map((v) => (
                <SelectItem key={v.key} value={v.variableId as string}>
                  {getDisplayLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

interface VariableEditorRowProps {
  variable: LocalVariableEdit
  index: number
  isEditing: boolean
  errors: Record<string, string>
  isSaving?: boolean
  allVariables: LocalVariableEdit[]
  onChange: (
    field: keyof LocalVariableEdit,
    value: string | number | string[] | Array<Record<string, number>>,
  ) => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onRemove: () => void
}

export function serializePairedConstants(pc: Array<Record<string, number>> | undefined): string {
  if (!pc || pc.length === 0) return ""
  return pc
    .map((row) =>
      Object.entries(row)
        // Comma decimals on the way out, matching every other numeric field.
        // PAIRED_CONSTANT_REGEX below accepts either separator, and the pair
        // separator is ", " (comma + space) while a decimal comma is always
        // followed by a digit, so the two never collide.
        .map(([k, v]) => `${k}=${formatDecimalComma(String(v))}`)
        .join(", "),
    )
    .join("\n")
}

// Matches each "key=number" pair directly rather than splitting the line on
// "," first — a bare split breaks on a Czech decimal comma inside the number
// itself ("Ka=1,75e-5" turns into "Ka=1" and a dangling "75e-5"), silently
// dropping most of the value. The number group accepts either separator, so
// "1.75e-5" and "1,75e-5" both parse, while "," between pairs on the same
// line ("Ka=1.8e-5, pKa=4.74") still works since it just isn't part of either
// match.
const PAIRED_CONSTANT_REGEX = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)/g

export function parsePairedConstantsText(text: string): Array<Record<string, number>> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const record: Record<string, number> = {}
      for (const match of line.matchAll(PAIRED_CONSTANT_REGEX)) {
        const key = match[1]
        const val = parseFloat(match[2].replace(",", "."))
        if (!Number.isNaN(val)) record[key] = val
      }
      return record
    })
}

export function VariableEditorRow({
  variable,
  index,
  isEditing,
  errors,
  isSaving,
  allVariables,
  onChange,
  onEdit,
  onCancel,
  onSave,
  onRemove,
}: VariableEditorRowProps) {
  const [stringValuesInput, setStringValuesInput] = useState(
    variable.stringValues?.join(", ") || "",
  )
  const [pairedConstantsInput, setPairedConstantsInput] = useState(
    serializePairedConstants(variable.pairedConstants),
  )

  const displayPlaceholder = variable.placeholder || getAutoPlaceholder(index)
  const placeholderColor = PLACEHOLDER_COLORS[displayPlaceholder] || "text-gray-600"

  if (variable.isRemoved) {
    return (
      <div className="p-3 border rounded-lg opacity-50 line-through">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-secondary">
            <span className={`font-semibold ${placeholderColor}`}>{displayPlaceholder}</span> —{" "}
            {variable.name}
          </span>
          <Badge variant="destructive">{cs.questions.removeVariable}</Badge>
        </div>
      </div>
    )
  }

  if (isEditing) {
    const isStringType = variable.varType === "string"

    const handleVarTypeChange = (value: VariableType) => {
      onChange("varType", value)
      if (value === "string") {
        onChange("stringValues", ["", ""])
        onChange("greaterThanVariableId", "")
        onChange("lessThanVariableId", "")
      }
      // Auto-fill sensible defaults for hidden fields
      if (!variable.name || variable.name.trim() === "") {
        onChange(
          "name",
          cs.questions.variableDefaultName.replace("{placeholder}", displayPlaceholder),
        )
      }
      if (!variable.symbol || variable.symbol.trim() === "") {
        onChange("symbol", displayPlaceholder)
      }
      if (!variable.unit) {
        onChange("unit", "")
      }
      if (variable.precision === undefined || variable.precision < 0) {
        onChange("precision", value === "string" ? 0 : 1)
      }
    }

    const handleStepChange = (value: number) => {
      onChange("step", value)
      // Auto-update precision to match the number of decimal places in the step
      const stepStr = String(value)
      const dotIndex = stepStr.indexOf(".")
      const decimalPlaces = dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1
      if (decimalPlaces > (variable.precision ?? 0)) {
        onChange("precision", decimalPlaces)
      }
    }

    const handleStringValuesChange = (value: string) => {
      setStringValuesInput(value)
      const values = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s)
      onChange("stringValues", values)
    }

    return (
      <div className="p-3 border rounded-lg space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">
            <span className={`font-semibold ${placeholderColor}`}>{displayPlaceholder}</span>
          </Label>
          {/* Hidden fields - auto-filled with sensible defaults */}
          <input
            type="hidden"
            value={
              variable.name ||
              cs.questions.variableDefaultName.replace("{placeholder}", displayPlaceholder)
            }
          />
          <input type="hidden" value={variable.symbol || displayPlaceholder} />
          <input type="hidden" value={variable.unit || ""} />
          <input type="hidden" value={variable.precision || (isStringType ? 0 : 1)} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{cs.questions.variableType}</Label>
          <Select value={variable.varType} onValueChange={handleVarTypeChange}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="numeric">{cs.questions.variableTypeNumeric}</SelectItem>
              <SelectItem value="string">{cs.questions.variableTypeString}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isStringType ? (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{cs.questions.stringValuesInput}</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleStringValuesChange(FIRST_THREE_ROWS_ELEMENTS.join(", "))}
                  >
                    {cs.questions.fillFirstThreeRows}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleStringValuesChange(KNOWN_ELEMENTS.join(", "))}
                  >
                    {cs.questions.fillAllElements}
                  </Button>
                </div>
              </div>
              <Textarea
                value={stringValuesInput}
                onChange={(e) => handleStringValuesChange(e.target.value)}
                rows={2}
                placeholder="hodnota1, hodnota2, hodnota3"
                className="min-h-[60px]"
              />
              {errors.stringValues && <p className="text-xs text-red-500">{errors.stringValues}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Párové konstanty</Label>
              <p className="text-xs text-muted-foreground">
                Jedna řada na hodnotu (stejné pořadí). Formát:{" "}
                <code className="text-xs">Ka=1.8e-5, pKa=4.74</code>
              </p>
              <Textarea
                value={pairedConstantsInput}
                onChange={(e) => {
                  setPairedConstantsInput(e.target.value)
                  onChange("pairedConstants", parsePairedConstantsText(e.target.value))
                }}
                rows={3}
                placeholder={"Ka=1.8e-5, pKa=4.74\nKa=7.3e-10, pKa=9.14"}
                className="min-h-[80px] font-mono text-xs"
              />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableMin}</Label>
                <NumericInput
                  value={variable.minValue}
                  onChange={(n) => onChange("minValue", n)}
                  className="h-8"
                />
                {errors.minValue && <p className="text-xs text-red-500">{errors.minValue}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableMax}</Label>
                <NumericInput
                  value={variable.maxValue}
                  onChange={(n) => onChange("maxValue", n)}
                  className="h-8"
                />
                {errors.maxValue && <p className="text-xs text-red-500">{errors.maxValue}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableStep}</Label>
                <NumericInput
                  value={variable.step}
                  onChange={(n) => handleStepChange(n)}
                  className="h-8"
                />
                {errors.step && <p className="text-xs text-red-500">{errors.step}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.significantDigits}</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={variable.significantDigits ?? ""}
                  className="h-8"
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    if (raw === "") {
                      onChange("significantDigits", undefined as unknown as number)
                    } else {
                      const n = Number(raw)
                      if (Number.isFinite(n) && n >= 1 && n <= 10) {
                        onChange("significantDigits", Math.floor(n))
                      }
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.notationLabel}</Label>
                <Select
                  value={variable.notation ?? "auto"}
                  onValueChange={(v) => onChange("notation", v as Notation)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{cs.questions.notationAuto}</SelectItem>
                    <SelectItem value="scientific">{cs.questions.notationScientific}</SelectItem>
                    <SelectItem value="normal">{cs.questions.notationNormal}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ComparisonSelectors
              variable={variable}
              allVariables={allVariables}
              onChange={onChange}
            />
          </>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
            <X className="size-4 mr-1" />
            {cs.questions.cancelEdit}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={onRemove}
            disabled={isSaving}
          >
            <Trash2 className="size-4 mr-1" />
            {cs.questions.removeVariable}
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={isSaving}>
            <Save className="size-4 mr-1" />
            {cs.common.save}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 border rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm flex-1">
          <div>
            <span className="text-foreground-secondary text-xs">
              {cs.questions.variablePlaceholder}
            </span>
            <p className={`font-semibold ${placeholderColor}`}>{displayPlaceholder}</p>
          </div>
          <div>
            <span className="text-foreground-secondary text-xs">{cs.questions.variableType}</span>
            <p className="font-medium">
              {variable.varType === "numeric"
                ? cs.questions.variableTypeNumeric
                : cs.questions.variableTypeString}
            </p>
          </div>
          {variable.varType === "numeric" ? (
            <div>
              <span className="text-foreground-secondary text-xs">{cs.form.range}</span>
              <p>
                {formatDecimalComma(String(variable.minValue))} –{" "}
                {formatDecimalComma(String(variable.maxValue))} (
                {formatDecimalComma(String(variable.step))})
              </p>
            </div>
          ) : (
            <div>
              <span className="text-foreground-secondary text-xs">
                {cs.questions.stringValuesLabel}
              </span>
              <p className="break-words">{(variable.stringValues || []).join(", ")}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          {Object.keys(errors).length > 0 && (
            <Badge variant="destructive" title={cs.questions.validation.checkHighlighted}>
              !
            </Badge>
          )}
          {variable.isShared && (
            <Badge variant="secondary" title={cs.questions.variableSharedTooltip}>
              {cs.questions.variableShared}
            </Badge>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 className="size-4 text-red-500" />
          </Button>
        </div>
      </div>
    </div>
  )
}
