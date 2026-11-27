import { describe, expect, it } from "vitest"

import { pageKeyFor } from "@/hooks/use-page-key"

const slugs = ["aminokyseliny", "steroidy"]

describe("pageKeyFor", () => {
  it("treats the library and every category as one page", () => {
    expect(pageKeyFor("/biomolekuly", slugs)).toBe("/biomolekuly")
    expect(pageKeyFor("/biomolekuly/aminokyseliny", slugs)).toBe("/biomolekuly")
    expect(pageKeyFor("/biomolekuly/steroidy", slugs)).toBe("/biomolekuly")
  })

  it("keeps other pages under /biomolekuly/ separate", () => {
    expect(pageKeyFor("/biomolekuly/test", slugs)).toBe("/biomolekuly/test")
    expect(pageKeyFor("/biomolekuly/procvicovani", slugs)).toBe("/biomolekuly/procvicovani")
    expect(pageKeyFor("/biomolekuly/aminokyseliny/procvicovani", slugs)).toBe(
      "/biomolekuly/aminokyseliny/procvicovani",
    )
  })

  it("leaves every other path as its own page", () => {
    expect(pageKeyFor("/domu", slugs)).toBe("/domu")
    expect(pageKeyFor("/biomolekuly/neznama", slugs)).toBe("/biomolekuly/neznama")
  })
})
