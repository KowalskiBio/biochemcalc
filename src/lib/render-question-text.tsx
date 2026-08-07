import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { constantsApi } from "@/lib/api"
import { formatNumberMaxDecimals, scientificNotationToHtml } from "@/lib/math-utils"
import { PLACEHOLDER_REGEX, stripAnswerTargets } from "@/lib/utils"
import { useDatabazeEntries } from "@/stores/databaze-store"

import type { DatabazeEntry, VariableWithPlaceholder, Variant } from "./types"

/**
 * All this renderer needs of a variable: which placeholder it fills and how
 * to format it. A full `VariableWithPlaceholder` still satisfies it — the
 * `Partial` half is what keeps the extra authoring fields (sharing,
 * comparison links) permitted rather than rejected as excess properties, so
 * the student practice generator, whose payload deliberately omits them, can
 * reuse this renderer unchanged.
 */
export type RenderableVariable = Partial<VariableWithPlaceholder> &
  Pick<VariableWithPlaceholder, "variable" | "placeholder">

/** Likewise: only the sampled values are ever read off a variant. */
export type RenderableVariant = Partial<Variant> &
  Pick<Variant, "assignedValues" | "assignedStrings">

// Tailwind text color classes for X/Y/Z placeholders.
// X = red, Y = green, Z = blue, then cycle through other colors.
export const VARIABLE_COLORS = [
  "text-red-600",
  "text-green-600",
  "text-blue-600",
  "text-purple-600",
  "text-orange-600",
  "text-cyan-600",
] as const

export function formatChemicalText(text: string): string {
  return (
    text
      // Hydrate separators → × BEFORE sub/sup so H_2O is still raw text.
      .replace(/([A-Za-z0-9)])[*·.](\d*)(H[₂2_]?[_₂2]?O)\b/gu, "$1×$2$3")
      .replace(/([A-Za-z0-9)(])\^([+-]?\d+[+-]?)/g, (_, base, exponent) => {
        return `${base}<sup>${exponent}</sup>`
      })
      .replace(/([A-Z][a-z]?|\))_(\d+)/g, (_, base, subscript) => {
        return `${base}<sub>${subscript}</sub>`
      })
      // Remaining . as multiplication → ×, but keep digit.digit as a decimal point.
      .replace(/([A-Za-z)])\.(?=[A-Za-z0-9(])/gu, "$1×")
      // Remaining * / · between formula characters → ×.
      .replace(/([A-Za-z0-9)])[*·]([A-Za-z0-9(])/gu, "$1×$2")
  )
}

function getExampleStringValue(
  placeholder: string,
  variable: VariableWithPlaceholder["variable"],
  databazeEntries: DatabazeEntry[],
): string {
  const entry = databazeEntries.find((e) => e.code === placeholder)
  if (entry && entry.values.length > 0) {
    return entry.values[0]
  }
  if (variable.stringValues && variable.stringValues.length > 0) {
    return variable.stringValues[0]
  }
  return placeholder
}

function formatTextSegment(text: string): string {
  // Hydrate dots → × first, then remaining multiplication dots → ×,
  // while leaving digit.digit as a decimal point.
  const withHydrateDots = text.replace(/([A-Za-z0-9)])\.(\d*)(H[₂2_]?[_₂2]?O)\b/gu, "$1×$2$3")
  const withDots = withHydrateDots.replace(/([A-Za-z)])\.(?=[A-Za-z0-9(])/gu, "$1×")
  return formatChemicalText(withDots)
}

function renderConstantValue(value: number): string {
  const display = scientificNotationToHtml(formatNumberMaxDecimals(value, 4))
  return `<span class="inline-flex items-center font-semibold text-gray-600">${display}</span>`
}

function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  }
  return h
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Builds a fake variant for preview purposes: each placeholder gets a random
 * value drawn from its configured range, seeded by the template ID so the
 * same template always shows the same preview values (no flicker on
 * re-render), but different templates show different values.
 */
export function buildPreviewVariant(
  templateId: string,
  variables: RenderableVariable[],
): RenderableVariant {
  const rng = seededRandom(hashString(templateId))
  const assignedValues: Record<string, number> = {}
  const assignedStrings: Record<string, string> = {}

  for (const { placeholder, variable } of variables) {
    if (!variable) continue
    if (variable.varType === "string") {
      const options = variable.stringValues ?? []
      if (options.length > 0) {
        assignedStrings[placeholder] = options[Math.floor(rng() * options.length)]
      }
    } else {
      const { minValue, maxValue, step } = variable
      if (step > 0 && Number.isFinite(minValue) && Number.isFinite(maxValue) && maxValue > minValue) {
        const steps = Math.floor((maxValue - minValue) / step)
        assignedValues[placeholder] = minValue + Math.floor(rng() * (steps + 1)) * step
      } else {
        assignedValues[placeholder] = previewValueForVariable(variable)
      }
    }
  }

  return { assignedValues, assignedStrings }
}

/**
 * A representative value to preview a variable with when no variant has been
 * generated yet. The midpoint of the configured range (snapped to `step`) is
 * far more informative than the bare minimum — a template whose mass runs
 * 1–1000 g previewing as "1 g" reads like a broken question rather than a
 * sample of what students will actually be asked.
 */
export function previewValueForVariable(variable: {
  minValue: number
  maxValue: number
  step: number
}): number {
  const { minValue, maxValue, step } = variable
  if (!Number.isFinite(minValue)) return 0
  if (!Number.isFinite(maxValue) || maxValue <= minValue) return minValue

  const midpoint = (minValue + maxValue) / 2
  if (!Number.isFinite(step) || step <= 0) return midpoint

  const snapped = minValue + Math.round((midpoint - minValue) / step) * step
  return Math.min(maxValue, Math.max(minValue, snapped))
}

function renderPlaceholderSpan(
  placeholder: string,
  value: string | undefined,
  variables: RenderableVariable[],
  databazeEntries: DatabazeEntry[],
  constants: Record<string, number> = {},
): string {
  const fixedValue = value?.trim()
  if (fixedValue !== undefined && fixedValue !== "") {
    return `<span class="inline-flex items-center font-semibold text-gray-600">${fixedValue}</span>`
  }
  const idx = variables.findIndex((v) => v.placeholder === placeholder)
  if (idx !== -1) {
    const colorClass = VARIABLE_COLORS[idx % VARIABLE_COLORS.length]
    const variable = variables[idx].variable
    const displayValue =
      variable.varType === "string"
        ? formatChemicalText(getExampleStringValue(placeholder, variable, databazeEntries))
        : scientificNotationToHtml(
            formatNumberMaxDecimals(previewValueForVariable(variable), variable.precision),
          )
    return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
  }
  const constantValue = constants[placeholder]
  if (constantValue !== undefined) {
    return renderConstantValue(constantValue)
  }
  return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
}

export function renderQuestionText(
  rawText: string,
  variables: RenderableVariable[],
  databazeEntries: DatabazeEntry[] = [],
  constants: Record<string, number> = {},
): string {
  const text = stripAnswerTargets(rawText)
  const segments: string[] = []
  let lastIndex = 0
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const [fullMatch, placeholder, value] = match
    segments.push(formatTextSegment(text.slice(lastIndex, match.index)))
    segments.push(renderPlaceholderSpan(placeholder, value, variables, databazeEntries, constants))
    lastIndex = match.index + fullMatch.length
  }
  segments.push(formatTextSegment(text.slice(lastIndex)))
  return segments.join("")
}

interface QuestionTextRendererProps {
  text: string
  variables: RenderableVariable[]
  variant?: RenderableVariant
  constants?: Record<string, number>
}

/**
 * Renders question text with ReactMarkdown while preserving inline HTML spans.
 * When a variant is provided, replaces placeholders with actual sampled values.
 */
export const QuestionTextRenderer: React.FC<QuestionTextRendererProps> = ({
  text,
  variables,
  variant,
  constants: constantsProp,
}) => {
  const databazeEntries = useDatabazeEntries()
  const [loadedConstants, setLoadedConstants] = useState<Record<string, number>>({})

  useEffect(() => {
    if (constantsProp !== undefined) {
      setLoadedConstants(constantsProp)
      return
    }

    let cancelled = false
    constantsApi
      .list()
      .then((allConstants) => {
        if (cancelled) return
        const map: Record<string, number> = {}
        for (const c of allConstants) {
          map[c.symbol] = c.value
        }
        setLoadedConstants(map)
      })
      .catch(() => {
        // Fail silently; the caller can pass constants explicitly if needed.
      })

    return () => {
      cancelled = true
    }
  }, [constantsProp])

  const rendered = variant
    ? renderQuestionTextWithVariant(text, variables, variant, databazeEntries, loadedConstants)
    : renderQuestionText(text, variables, databazeEntries, loadedConstants)
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
      <ReactMarkdown rehypePlugins={[rehypeRaw]}>{rendered}</ReactMarkdown>
    </div>
  )
}

export function renderQuestionTextWithVariant(
  rawText: string,
  variables: RenderableVariable[],
  variant: RenderableVariant,
  databazeEntries: DatabazeEntry[] = [],
  constants: Record<string, number> = {},
): string {
  const text = stripAnswerTargets(rawText)
  const segments: string[] = []
  let lastIndex = 0
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const [fullMatch, placeholder, value] = match
    segments.push(formatTextSegment(text.slice(lastIndex, match.index)))
    segments.push(
      renderPlaceholderSpanWithVariant(
        placeholder,
        value,
        variables,
        variant,
        databazeEntries,
        constants,
      ),
    )
    lastIndex = match.index + fullMatch.length
  }
  segments.push(formatTextSegment(text.slice(lastIndex)))
  return segments.join("")
}

function renderPlaceholderSpanWithVariant(
  placeholder: string,
  value: string | undefined,
  variables: RenderableVariable[],
  variant: RenderableVariant,
  databazeEntries: DatabazeEntry[],
  constants: Record<string, number> = {},
): string {
  const fixedValue = value?.trim()
  if (fixedValue !== undefined && fixedValue !== "") {
    return `<span class="inline-flex items-center font-semibold text-gray-600">${fixedValue}</span>`
  }

  const idx = variables.findIndex((v) => v.placeholder === placeholder)
  if (idx !== -1) {
    const colorClass = VARIABLE_COLORS[idx % VARIABLE_COLORS.length]
    const variable = variables[idx].variable

    // Use actual sampled values from variant if available
    if (variant) {
      if (variable.varType === "string") {
        const sampledString =
          variant.assignedStrings?.[placeholder] ||
          getExampleStringValue(placeholder, variable, databazeEntries)
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${formatChemicalText(sampledString)}</span>`
      } else {
        const sampledValue = variant.assignedValues[placeholder]
        const rawValue =
          sampledValue !== undefined ? sampledValue : previewValueForVariable(variable)
        const displayValue = scientificNotationToHtml(
          formatNumberMaxDecimals(rawValue, variable.precision),
        )
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
      }
    }

    // Fallback to original behavior
    const displayValue =
      variable.varType === "string"
        ? formatChemicalText(getExampleStringValue(placeholder, variable, databazeEntries))
        : scientificNotationToHtml(
            formatNumberMaxDecimals(previewValueForVariable(variable), variable.precision),
          )
    return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
  }

  const constantValue = constants[placeholder]
  if (constantValue !== undefined) {
    return renderConstantValue(constantValue)
  }

  return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
}
