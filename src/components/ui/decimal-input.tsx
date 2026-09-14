import * as React from "react"

import { Input } from "@/components/ui/input"
import { formatDecimalComma, parseCzechNumber } from "@/lib/utils"

interface DecimalInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: number | string | null | undefined
  /** Called with the parsed number, or `undefined` while the field is empty
   * or holds something that is not yet a number. */
  onValueChange?: (value: number | undefined) => void
}

/**
 * A numeric field that reads and writes the Czech decimal comma.
 *
 * Deliberately `type="text"` rather than `type="number"`: a number input
 * validates against the *browser's* locale, so on an en-US profile (the
 * default in this app's webview) typing `7,1` leaves `input.value` an empty
 * string and the digits vanish as they are typed. `inputMode="decimal"` still
 * brings up the numeric keypad on touch devices; the trade-off is losing the
 * spinner arrows, which these fields did not rely on.
 *
 * Both separators are accepted on input, so a teacher pasting `7.1` from a
 * datasheet is not corrected mid-keystroke; the value is re-rendered with a
 * comma once the field loses focus.
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onValueChange, onBlur, onFocus, ...props }, ref) => {
    // While the field has focus its raw text is authoritative. Formatting the
    // committed number on every keystroke would fight the user mid-entry:
    // a half-typed "1," parses to 1 and would snap back to "1", making the
    // separator impossible to type.
    const [draft, setDraft] = React.useState<string | null>(null)

    const display =
      draft ?? (value == null || value === "" ? "" : formatDecimalComma(String(value)))

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          onValueChange?.(raw.trim() === "" ? undefined : parseCzechNumber(raw))
        }}
        onFocus={(event) => {
          setDraft(event.target.value)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          // Drop the draft so the next render shows the committed value in
          // canonical form: "7." and "7,0" both settle to "7".
          setDraft(null)
          onBlur?.(event)
        }}
      />
    )
  },
)
DecimalInput.displayName = "DecimalInput"
