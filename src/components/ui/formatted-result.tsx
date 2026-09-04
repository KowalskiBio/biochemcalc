import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import {
  formatNumberMaxDecimals,
  formatSignificantDigits,
  scientificNotationToHtml,
} from "@/lib/math-utils"
import { formatChemicalText } from "@/lib/render-question-text"
import type { Notation } from "@/lib/types"
import { cn } from "@/lib/utils"

interface FormattedResultProps {
  value: number | undefined | null
  precision?: number
  significantDigits?: number
  forceScientific?: boolean
  /**
   * Explicit notation choice — takes precedence over `forceScientific`.
   * Pass `"scientific"`/`"normal"` (never leave both this and
   * `forceScientific` unset) whenever the value belongs to a template with
   * its own notation setting, so a teacher's explicit "not scientific"
   * choice is honored outright rather than falling back to the
   * magnitude-based `"auto"` default (which still flips small values like
   * `0.012` to scientific).
   */
  notation?: Notation
  unit?: string | null
  className?: string
}

export function FormattedResult({
  value,
  precision = 2,
  significantDigits,
  forceScientific = false,
  notation,
  unit,
  className,
}: FormattedResultProps) {
  const numeric =
    significantDigits != null
      ? formatSignificantDigits(value, significantDigits, forceScientific, notation)
      : formatNumberMaxDecimals(value, precision, forceScientific, notation)
  if (numeric.length === 0) {
    return null
  }

  const text = unit?.trim() ? `${numeric} ${unit.trim()}` : numeric
  const rendered = formatChemicalText(scientificNotationToHtml(text))

  return (
    <span className={cn("inline", className)}>
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <>{children}</>,
        }}
      >
        {rendered}
      </ReactMarkdown>
    </span>
  )
}
