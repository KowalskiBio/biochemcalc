import { Pencil, Save, Trash2, X } from "lucide-react"
import { useState } from "react"

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
import type { LocalVariableEdit, VariableType } from "@/lib/types"

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

interface ComparisonSelectorsProps {
  variable: LocalVariableEdit
  allVariables: LocalVariableEdit[]
  onChange: (field: keyof LocalVariableEdit, value: string | number | string[]) => void
}

function ComparisonSelectors({ variable, allVariables, onChange }: ComparisonSelectorsProps) {
  const candidates = allVariables.filter(
    (v) =>
      v.key !== variable.key && !v.isRemoved && v.varType === "numeric" && v.variableId !== null,
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
  )
}

interface VariableEditorRowProps {
  variable: LocalVariableEdit
  index: number
  isEditing: boolean
  errors: Record<string, string>
  isSaving?: boolean
  allVariables: LocalVariableEdit[]
  onChange: (field: keyof LocalVariableEdit, value: string | number | string[]) => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onRemove: () => void
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
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableMin}</Label>
                <Input
                  type="number"
                  value={String(variable.minValue)}
                  onChange={(e) => onChange("minValue", Number(e.target.value))}
                  className="h-8"
                />
                {errors.minValue && <p className="text-xs text-red-500">{errors.minValue}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableMax}</Label>
                <Input
                  type="number"
                  value={String(variable.maxValue)}
                  onChange={(e) => onChange("maxValue", Number(e.target.value))}
                  className="h-8"
                />
                {errors.maxValue && <p className="text-xs text-red-500">{errors.maxValue}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{cs.questions.variableStep}</Label>
                <Input
                  type="number"
                  value={String(variable.step)}
                  onChange={(e) => onChange("step", Number(e.target.value))}
                  className="h-8"
                />
                {errors.step && <p className="text-xs text-red-500">{errors.step}</p>}
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
                {variable.minValue} – {variable.maxValue} ({variable.step})
              </p>
            </div>
          ) : (
            <div>
              <span className="text-foreground-secondary text-xs">
                {cs.questions.stringValuesLabel}
              </span>
              <p>{(variable.stringValues || []).join(", ")}</p>
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
