import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import {
  formatNumberMaxDecimals,
  formatSignificantDigits,
  scientificNotationToHtml,
} from "@/lib/math-utils"
import { formatChemicalText } from "@/lib/render-question-text"
import { cn } from "@/lib/utils"

interface FormattedResultProps {
  value: number | undefined | null
  precision?: number
  significantDigits?: number
  forceScientific?: boolean
  unit?: string | null
  className?: string
}

export function FormattedResult({
  value,
  precision = 2,
  significantDigits,
  forceScientific = false,
  unit,
  className,
}: FormattedResultProps) {
  const numeric =
    significantDigits != null
      ? formatSignificantDigits(value, significantDigits, forceScientific)
      : formatNumberMaxDecimals(value, precision, forceScientific)
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
