import "katex/dist/katex.min.css"

import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"

import { cn } from "@/lib/utils"

interface MathRendererProps {
  text: string
  className?: string
}

export function MathRenderer({ text, className }: MathRendererProps) {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return null
  }

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {trimmed}
      </ReactMarkdown>
    </div>
  )
}
