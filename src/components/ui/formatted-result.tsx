import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { formatNumberMaxDecimals } from "@/lib/math-utils"
import { formatChemicalText } from "@/lib/render-question-text"
import { cn } from "@/lib/utils"

interface FormattedResultProps {
  value: number | undefined | null
  precision?: number
  unit?: string | null
  className?: string
}

/**
 * Pre-process scientific notation produced by formatNumberMaxDecimals so the
 * exponent is rendered as a proper superscript. The rest of the text is then
 * passed through the same chemical formatting used for units.
 */
function formatScientificNotation(text: string): string {
  return text.replace(/×10\^([+-]?\d+)/g, "×10<sup>$1</sup>")
}

export function FormattedResult({
  value,
  precision = 2,
  unit,
  className,
}: FormattedResultProps) {
  const numeric = formatNumberMaxDecimals(value, precision)
  if (numeric.length === 0) {
    return null
  }

  const text = unit?.trim() ? `${numeric} ${unit.trim()}` : numeric
  const rendered = formatChemicalText(formatScientificNotation(text))

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
