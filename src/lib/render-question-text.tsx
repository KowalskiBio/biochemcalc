import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { constantsApi } from "@/lib/api"
import { PLACEHOLDER_REGEX } from "@/lib/utils"
import { useDatabazeEntries } from "@/stores/databaze-store"

import type { DatabazeEntry, VariableWithPlaceholder, Variant } from "./types"

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
  return text
    .replace(/([A-Za-z0-9)(])\^([+-]?\d+[+-]?)/g, (_, base, exponent) => {
      return `${base}<sup>${exponent}</sup>`
    })
    .replace(/([A-Z][a-z]?|\))_(\d+)/g, (_, base, subscript) => {
      return `${base}<sub>${subscript}</sub>`
    })
    .replace(/([A-Za-z0-9)])\*([A-Za-z0-9(])/g, "$1·$2")
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
  const withDots = text.replace(/([A-Za-z0-9)])\./g, (match, before, offset, string) => {
    const nextChar = string[offset + match.length]
    if (nextChar && /[A-Za-z0-9(]/.test(nextChar)) {
      return `${before}·`
    }
    return match
  })
  return formatChemicalText(withDots)
}

function renderConstantValue(value: number): string {
  return `<span class="inline-flex items-center font-semibold text-gray-600">${value}</span>`
}

function renderPlaceholderSpan(
  placeholder: string,
  value: string | undefined,
  variables: VariableWithPlaceholder[],
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
        ? getExampleStringValue(placeholder, variable, databazeEntries)
        : variable.minValue
    return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
  }
  const constantValue = constants[placeholder]
  if (constantValue !== undefined) {
    return renderConstantValue(constantValue)
  }
  return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
}

export function renderQuestionText(
  text: string,
  variables: VariableWithPlaceholder[],
  databazeEntries: DatabazeEntry[] = [],
  constants: Record<string, number> = {},
): string {
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
  variables: VariableWithPlaceholder[]
  variant?: Variant
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
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown rehypePlugins={[rehypeRaw]}>{rendered}</ReactMarkdown>
    </div>
  )
}

export function renderQuestionTextWithVariant(
  text: string,
  variables: VariableWithPlaceholder[],
  variant: Variant,
  databazeEntries: DatabazeEntry[] = [],
  constants: Record<string, number> = {},
): string {
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
  variables: VariableWithPlaceholder[],
  variant: Variant,
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
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${sampledString}</span>`
      } else {
        const sampledValue = variant.assignedValues[placeholder]
        const displayValue = sampledValue !== undefined ? sampledValue : variable.minValue
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
      }
    }

    // Fallback to original behavior
    const displayValue =
      variable.varType === "string"
        ? getExampleStringValue(placeholder, variable, databazeEntries)
        : variable.minValue
    return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
  }

  const constantValue = constants[placeholder]
  if (constantValue !== undefined) {
    return renderConstantValue(constantValue)
  }

  return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
}
