import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DecimalInput } from "@/components/ui/decimal-input"

describe("DecimalInput", () => {
  it("renders a numeric value with a decimal comma", () => {
    const html = renderToStaticMarkup(<DecimalInput value={7.1} />)
    expect(html).toContain('value="7,1"')
  })

  it("renders a dot-bearing string value with a decimal comma", () => {
    // Callers that hold their state as text (e.g. the answer-SD field) still
    // store a dot, because they parse it back with Number().
    const html = renderToStaticMarkup(<DecimalInput value="0.25" />)
    expect(html).toContain('value="0,25"')
  })

  it("renders empty for a null or blank value rather than '0'", () => {
    expect(renderToStaticMarkup(<DecimalInput value={null} />)).toContain('value=""')
    expect(renderToStaticMarkup(<DecimalInput value="" />)).toContain('value=""')
  })

  it("is a decimal-mode text field, not a locale-validated number field", () => {
    const html = renderToStaticMarkup(<DecimalInput value={1} />)
    expect(html).toContain('type="text"')
    expect(html).toContain('inputMode="decimal"')
  })

  it("keeps an integer free of a stray separator", () => {
    expect(renderToStaticMarkup(<DecimalInput value={42} />)).toContain('value="42"')
  })
})
