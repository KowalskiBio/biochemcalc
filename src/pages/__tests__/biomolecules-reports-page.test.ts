import { describe, expect, it } from "vitest"
import { cs } from "@/i18n/cs"
import {
  answeredStatusLabel,
  formatReportedAt,
  normalizeSnapshot,
  parseSnapshotProjection,
  questionTypeLabel,
  truncateMessage,
} from "../biomolecules-reports-page"

const reports = cs.biomolekuly.reports

describe("questionTypeLabel", () => {
  it("maps every engine question type to its Czech label", () => {
    expect(questionTypeLabel("nameToLetter")).toBe(reports.questionTypes.nameToLetter)
    expect(questionTypeLabel("letterToName")).toBe(reports.questionTypes.letterToName)
    expect(questionTypeLabel("nameToStructure")).toBe(reports.questionTypes.nameToStructure)
    expect(questionTypeLabel("structureToName")).toBe(reports.questionTypes.structureToName)
    expect(questionTypeLabel("letterToStructure")).toBe(reports.questionTypes.letterToStructure)
    expect(questionTypeLabel("structureToLetter")).toBe(reports.questionTypes.structureToLetter)
    expect(questionTypeLabel("characteristic")).toBe(reports.questionTypes.characteristic)
  })

  it("keeps an unknown type raw", () => {
    expect(questionTypeLabel("futureType")).toBe("futureType")
    expect(questionTypeLabel("")).toBe("")
  })
})

describe("truncateMessage", () => {
  it("leaves a short message untouched", () => {
    expect(truncateMessage("Krátká zpráva")).toBe("Krátká zpráva")
    expect(truncateMessage("a".repeat(80))).toBe("a".repeat(80))
  })

  it("cuts a long message at 80 characters and appends an ellipsis", () => {
    const result = truncateMessage("a".repeat(81))
    expect(result).toBe(`${"a".repeat(80)}...`)
  })

  it("honours a custom limit", () => {
    expect(truncateMessage("abcdef", 3)).toBe("abc...")
  })
})

describe("formatReportedAt", () => {
  it("falls back to the raw value when the date is invalid", () => {
    expect(formatReportedAt("not-a-date")).toBe("not-a-date")
  })

  it("formats a valid ISO timestamp", () => {
    expect(formatReportedAt("2026-10-20T10:30:00.000Z")).not.toBe("2026-10-20T10:30:00.000Z")
    expect(formatReportedAt("2026-10-20T10:30:00.000Z")).toContain("2026")
  })
})

describe("answeredStatusLabel", () => {
  it("labels every answer state", () => {
    expect(answeredStatusLabel(true)).toBe(reports.statusCorrect)
    expect(answeredStatusLabel(false)).toBe(reports.statusIncorrect)
    expect(answeredStatusLabel(null)).toBe(reports.statusPending)
  })
})

describe("parseSnapshotProjection", () => {
  const validSpec = {
    type: "haworth",
    ringSize: 6,
    substituents: [{ atom: "C1", group: "OH", side: "down" }],
  }

  it("accepts an already-parsed projection object", () => {
    expect(parseSnapshotProjection(validSpec)).toEqual({ ...validSpec, anomericCarbon: 1 })
  })

  it("accepts a raw JSON projection string", () => {
    expect(parseSnapshotProjection(JSON.stringify(validSpec))).toEqual({
      ...validSpec,
      anomericCarbon: 1,
    })
  })

  it("returns null for missing or malformed data", () => {
    expect(parseSnapshotProjection(null)).toBeNull()
    expect(parseSnapshotProjection(undefined)).toBeNull()
    expect(parseSnapshotProjection("")).toBeNull()
    expect(parseSnapshotProjection("not json")).toBeNull()
    expect(parseSnapshotProjection({ type: "unknown" })).toBeNull()
  })
})

describe("normalizeSnapshot", () => {
  it("produces a renderable empty snapshot from malformed input", () => {
    expect(normalizeSnapshot(null)).toEqual({
      questionType: "",
      scopeSlug: "",
      target: { name: "", smiles: "" },
      prompt: { kind: "", text: "", projection: null },
      options: [],
      openAnswer: null,
      answeredCorrect: null,
    })
  })

  it("sanitizes option fields and the open-answer list", () => {
    const snapshot = normalizeSnapshot({
      questionType: "letterToName",
      scopeSlug: "aminokyseliny",
      target: { name: "Alanin", smiles: "C[C@@H](C(=O)O)N" },
      prompt: { kind: "letter", text: "A" },
      options: [
        { key: "a", display: "letter", correct: true },
        { key: "b", display: "weird", name: "Glukóza", correct: "yes" },
      ],
      openAnswer: { acceptedAnswers: ["alanin", 42, null] },
      answeredCorrect: false,
    })

    expect(snapshot.questionType).toBe("letterToName")
    expect(snapshot.options).toHaveLength(2)
    expect(snapshot.options[0]).toMatchObject({
      key: "a",
      display: "letter",
      name: "a",
      correct: true,
      projection: null,
    })
    expect(snapshot.options[1]).toMatchObject({
      key: "b",
      display: "name",
      name: "Glukóza",
      correct: false,
    })
    expect(snapshot.openAnswer).toEqual({ acceptedAnswers: ["alanin"] })
    expect(snapshot.answeredCorrect).toBe(false)
  })

  it("keeps a valid snapshot intact", () => {
    const projection = {
      type: "haworth",
      ringSize: 5,
      substituents: [{ atom: "C1", group: "OH", side: "up" }],
    }
    const raw = {
      questionType: "structureToName",
      scopeSlug: "sacharidy",
      target: { name: "Ribóza", smiles: "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O" },
      prompt: {
        kind: "structure",
        text: "",
        smiles: "OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O",
        haworth: true,
        projection,
      },
      options: [
        { key: "a", display: "name", name: "Ribóza", projection: null, correct: true },
        { key: "b", display: "name", name: "Glukóza", projection: null, correct: false },
      ],
      openAnswer: null,
      answeredCorrect: null,
    }

    expect(normalizeSnapshot(raw)).toEqual(raw)
  })
})
