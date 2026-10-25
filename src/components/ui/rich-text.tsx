import { Fragment } from "react"

import { splitRichText } from "@/lib/rich-text"

/**
 * Renders teacher-authored text with explicit script markup as real
 * sub/superscripts: `_{...}` → <sub>, `^{...}` → <sup> (see
 * `@/lib/rich-text` for the full grammar and its literal fallbacks).
 * Plain strings render as one bare text node — the no-markup fast path
 * adds no elements.
 */
export function RichText({ text }: { text: string }) {
  const parts = splitRichText(text)
  if (parts.length === 1 && parts[0].style === "normal") {
    return <>{text}</>
  }
  return (
    <>
      {parts.map((part, index) =>
        part.style === "normal" ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : part.style === "sub" ? (
          <sub key={index}>{part.text}</sub>
        ) : (
          <sup key={index}>{part.text}</sup>
        ),
      )}
    </>
  )
}
