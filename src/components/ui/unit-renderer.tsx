import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"

import { formatChemicalText } from "@/lib/render-question-text"
import { cn } from "@/lib/utils"

interface UnitRendererProps {
  unit: string
  className?: string
}

export function UnitRenderer({ unit, className }: UnitRendererProps) {
  const trimmed = unit?.trim() ?? ""
  if (trimmed.length === 0) {
    return null
  }

  return (
    <span className={cn("inline", className)}>
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => <span>{children}</span>,
        }}
      >
        {formatChemicalText(trimmed)}
      </ReactMarkdown>
    </span>
  )
}
