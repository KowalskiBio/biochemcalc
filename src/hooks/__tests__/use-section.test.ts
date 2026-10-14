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

  it("treats leaderboard, settings and help as shared", () => {
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
  it("lands teachers on Témata and students on practice for calculations", () => {
    expect(sectionHome("calculations", "teacher")).toBe("/topics")
    expect(sectionHome("calculations", "student")).toBe("/")
  })

  it("lands everyone on the Biomolekuly hub for biomolecules", () => {
    expect(sectionHome("biomolecules", "teacher")).toBe("/biomolekuly")
    expect(sectionHome("biomolecules", "student")).toBe("/biomolekuly")
  })
})
