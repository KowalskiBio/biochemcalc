import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { constantsApi } from "@/lib/api"
import {
  formatNumberMaxDecimals,
  formatSignificantDigits,
  scientificNotationToHtml,
} from "@/lib/math-utils"
import { normalizeDecimalCommasInText, PLACEHOLDER_REGEX, stripAnswerTargets } from "@/lib/utils"
import { useDatabazeEntries } from "@/stores/databaze-store"

import type { DatabazeEntry, Notation, VariableWithPlaceholder, Variant } from "./types"

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

/**
 * Stands in for a hydrate separator while the multiplication passes run.
 *
 * `FeSO4.7H2O` is iron(II) sulfate heptahydrate, not "4 times 7", so its
 * separator must not be rewritten as `×` along with the genuine
 * multiplication dots. Parking it on a character no rule matches is simpler
 * than teaching every later rule to recognise a hydrate; it is swapped back
 * to a plain dot on the way out.
 */
const HYDRATE_SEPARATOR = "\u0001"

export function formatChemicalText(text: string): string {
  return (
    text
      // A hydrate separator written as a DOT is not multiplication, so park
      // it before the multiplication passes (and before sub/sup, so H_2O is
      // still raw text). An asterisk is deliberately excluded: a teacher who
      // types `*` always means multiplication, so `FeSO_4*7H_2O` renders as
      // `FeSO₄×7H₂O` while `FeSO4.7H2O` keeps its dot.
      .replace(/([A-Za-z0-9)])[·.](\d*)(H[₂2_]?[_₂2]?O)\b/gu, `$1${HYDRATE_SEPARATOR}$2$3`)
      // Czech scientific notation writes the power of ten as `3,53.10^-4` or
      // `1,8*10^-5`. That separator is multiplication, so it renders as `×`
      // like every other product. Runs while `^` is still present, which is
      // what identifies the `10` as a power rather than a bare number.
      .replace(/[*·.](?=10\^)/g, "×")
      // Remaining `*` / `·` between formula characters is multiplication:
      // `mol*dm^-3` renders as `mol×dm⁻³`.
      .replace(/([A-Za-z0-9)])[*·]([A-Za-z0-9(])/gu, "$1×$2")
      // A dot is multiplication only between two letters, which is what tells
      // a unit product (`g.cm^-3`) apart from the two things that look like
      // it: a sentence period, which is always followed by a space or the end
      // of the text (`...této látky. Vypočítejte`), and a decimal, which has
      // digits on both sides.
      .replace(/([A-Za-z])\.([A-Za-z])/gu, "$1×$2")
      // Superscripts: 10^-5, x^2, Ca^2+, PO4^3-, etc.
      // Handles: digits with optional sign prefix/suffix, or bare sign (^- / ^+).
      .replace(/([A-Za-z0-9)(])\^([+-]?\d+[+-]?|[+-])/g, (_, base, exponent) => {
        return `${base}<sup>${exponent}</sup>`
      })
      // Subscripts: numeric (H_2, SO_4) AND letter (K_a, K_b, pK_a, n_e), plus
      // chained compound subscripts (K_a_1 → Ka1, one symbol, one subscript).
      // Each individual "_xxx" segment is non-greedy so H_2SO_4 splits into
      // two subscripts instead of swallowing "SO"; adjacent segments with no
      // separator between them merge into a single subscript.
      .replace(/([A-Za-z0-9)]|\))((?:_[A-Za-z0-9]+?)+)/g, (_, base, subscript) => {
        return `${base}<sub>${subscript.replace(/_/g, "")}</sub>`
      })
      .replace(new RegExp(HYDRATE_SEPARATOR, "g"), ".")
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

/**
 * The in-app form of a piece of literal question prose — chemical notation
 * (`K_a`, `H_2SO_4`, `Ca^2+`) typed directly into the question text renders
 * as real subscripts/superscripts, same as substituted placeholder values.
 * Only the raw editable text field and the exported question keep the
 * authored `_`/`^` characters as plain text.
 */
function formatTextSegment(text: string): string {
  // Decimal commas first: `formatChemicalText` turns `·`/`*` hydrate
  // separators into dots, and normalising afterwards would have to tell those
  // freshly created dots apart from decimal points.
  return formatChemicalText(normalizeDecimalCommasInText(text))
}

function formatNumberSegment(
  value: number,
  precision: number,
  significantDigits?: number,
  notation?: Notation,
): string {
  const formatted = significantDigits
    ? formatSignificantDigits(value, significantDigits, false, notation)
    : formatNumberMaxDecimals(value, precision, false, notation)
  return scientificNotationToHtml(formatted)
}

function renderConstantValue(value: number): string {
  const display = formatNumberSegment(value, 4)
  return `<span class="inline-flex items-center font-semibold text-gray-600">${display}</span>`
}

function decimalPlacesInStep(step: number): number {
  const s = String(step)
  const dot = s.indexOf(".")
  return dot === -1 ? 0 : s.length - dot - 1
}

function effectivePrecision(variable: { precision: number; step: number }): number {
  return Math.max(variable.precision, decimalPlacesInStep(variable.step))
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
        const idx = Math.floor(rng() * options.length)
        assignedStrings[placeholder] = options[idx]
        const pc = variable.pairedConstants?.[idx]
        if (pc) {
          for (const [sym, val] of Object.entries(pc)) {
            if (!(sym in assignedValues)) assignedValues[sym] = val
          }
        }
      }
    } else {
      const { minValue, maxValue, step } = variable
      if (
        step > 0 &&
        Number.isFinite(minValue) &&
        Number.isFinite(maxValue) &&
        maxValue > minValue
      ) {
        const steps = Math.floor((maxValue - minValue) / step)
        const raw = minValue + Math.floor(rng() * (steps + 1)) * step
        const stepStr = String(step)
        const dec = stepStr.includes(".") ? stepStr.split(".")[1].length : 0
        assignedValues[placeholder] = dec > 0 ? parseFloat(raw.toFixed(dec)) : Math.round(raw)
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
    // Check if fixedValue is a string variable placeholder — a linked constant
    // like [[Ka=wac]] where Ka comes from wac's pairedConstants.
    const linkedVar = variables.find(
      (v) => v.placeholder === fixedValue && v.variable.varType === "string",
    )
    if (linkedVar) {
      const pairedConstants = linkedVar.variable.pairedConstants
      if (pairedConstants && pairedConstants.length > 0) {
        const val = pairedConstants[0][placeholder]
        if (val !== undefined) return renderConstantValue(val)
      }
      return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
    }
    return `<span class="inline-flex items-center font-semibold text-gray-600">${formatTextSegment(fixedValue)}</span>`
  }
  const idx = variables.findIndex((v) => v.placeholder === placeholder)
  if (idx !== -1) {
    const colorClass = VARIABLE_COLORS[idx % VARIABLE_COLORS.length]
    const variable = variables[idx].variable
    const displayValue =
      variable.varType === "string"
        ? formatTextSegment(getExampleStringValue(placeholder, variable, databazeEntries))
        : formatNumberSegment(
            previewValueForVariable(variable),
            effectivePrecision(variable),
            variable.significantDigits,
            variable.notation,
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
    // Check if fixedValue is a string variable placeholder — [[Ka=wac]] form.
    const linkedVar = variables.find(
      (v) => v.placeholder === fixedValue && v.variable.varType === "string",
    )
    if (linkedVar) {
      const linkedValue = variant.assignedValues[placeholder]
      if (linkedValue !== undefined) return renderConstantValue(linkedValue)
      return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
    }
    return `<span class="inline-flex items-center font-semibold text-gray-600">${formatTextSegment(fixedValue)}</span>`
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
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${formatTextSegment(sampledString)}</span>`
      } else {
        const sampledValue = variant.assignedValues[placeholder]
        const rawValue =
          sampledValue !== undefined ? sampledValue : previewValueForVariable(variable)
        const displayValue = formatNumberSegment(
          rawValue,
          effectivePrecision(variable),
          variable.significantDigits,
          variable.notation,
        )
        return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
      }
    }

    // Fallback to original behavior
    const displayValue =
      variable.varType === "string"
        ? formatTextSegment(getExampleStringValue(placeholder, variable, databazeEntries))
        : formatNumberSegment(
            previewValueForVariable(variable),
            effectivePrecision(variable),
            variable.significantDigits,
            variable.notation,
          )
    return `<span class="inline-flex items-center font-semibold ${colorClass}">${displayValue}</span>`
  }

  const constantValue = constants[placeholder]
  if (constantValue !== undefined) {
    return renderConstantValue(constantValue)
  }

  return `<span class="inline-flex items-center font-semibold text-gray-600">[[${placeholder}]]</span>`
}
