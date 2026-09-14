import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { FormattedResult } from "@/components/ui/formatted-result"

describe("FormattedResult with significantDigits", () => {
  it("formats the value with the given significant figures, ignoring precision", () => {
    // precision defaults to 2 ("0,12"), so seeing "0,123" proves the
    // significant-figures branch at formatted-result.tsx:29-31 was taken.
    const html = renderToStaticMarkup(
      <FormattedResult value={0.123456} precision={2} significantDigits={3} />,
    )
    expect(html).toContain("0,123")
    expect(html).not.toContain("0,12 ")
  })

  it("falls back to precision-based formatting when significantDigits is undefined", () => {
    const html = renderToStaticMarkup(<FormattedResult value={0.123456} precision={2} />)
    expect(html).toContain("0,12")
    expect(html).not.toContain("0,123")
  })

  it("appends the unit after the significant-figures value", () => {
    const html = renderToStaticMarkup(
      <FormattedResult value={111554} significantDigits={3} unit="g" />,
    )
    expect(html).toContain("112000")
    expect(html).toContain("g")
  })
})
