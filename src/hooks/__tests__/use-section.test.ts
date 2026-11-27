import { describe, expect, it } from "vitest"
import { allowedSections, sectionForPath, sectionHome } from "../use-section"

describe("allowedSections", () => {
  it("expands both into the two sections", () => {
    expect(allowedSections("both")).toEqual(["calculations", "biomolecules"])
  })

  it("keeps a single-section scope as is", () => {
    expect(allowedSections("calculations")).toEqual(["calculations"])
    expect(allowedSections("biomolecules")).toEqual(["biomolecules"])
  })
})

describe("sectionForPath", () => {
  it("puts the Biomolekuly hub and its sub-pages in biomolecules", () => {
    expect(sectionForPath("/biomolekuly")).toBe("biomolecules")
    expect(sectionForPath("/biomolekuly/aminokyseliny")).toBe("biomolecules")
    expect(sectionForPath("/biomolekuly/aminokyseliny/procvicovani")).toBe("biomolecules")
  })

  it("treats home, leaderboard, settings and help as shared", () => {
    expect(sectionForPath("/domu")).toBeNull()
    expect(sectionForPath("/leaderboard")).toBeNull()
    expect(sectionForPath("/settings")).toBeNull()
    expect(sectionForPath("/help")).toBeNull()
  })

  it("puts everything else in calculations", () => {
    expect(sectionForPath("/")).toBe("calculations")
    expect(sectionForPath("/topics")).toBe("calculations")
    expect(sectionForPath("/test/uvodni")).toBe("calculations")
    expect(sectionForPath("/biomolekulyx")).toBe("calculations")
  })
})

describe("sectionHome", () => {
  it("lands teachers on Témata and students on the shared home for calculations", () => {
    expect(sectionHome("calculations", "teacher")).toBe("/topics")
    expect(sectionHome("calculations", "student")).toBe("/domu")
  })

  it("lands teachers on the Biomolekuly hub and students on the shared home for biomolecules", () => {
    expect(sectionHome("biomolecules", "teacher")).toBe("/biomolekuly")
    expect(sectionHome("biomolecules", "student")).toBe("/domu")
  })
})
