import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/http", () => ({ httpRequest: vi.fn() }))

import { httpRequest } from "@/lib/http"
import {
  biomoleculeReportsApi,
  type BiomoleculeQuestionReportSnapshot,
  type BiomoleculeReportQuestionInput,
  snapshotOfQuestion,
} from "@/lib/biomolecule-reports-api"
import type { QuizMolecule, QuizQuestion } from "@/lib/molecules/quiz"
import type { ProjectionSpec } from "@/lib/molecules/render/projection"

const mockedHttpRequest = vi.mocked(httpRequest)

const HAWORTH: ProjectionSpec = {
  type: "haworth",
  ringSize: 6,
  anomericCarbon: 1,
  substituents: [
    { atom: "C1", group: "OH", side: "down" },
    { atom: "C4", group: "OH", side: "up" },
    { atom: "C5", group: "CH₂OH", side: "up" },
  ],
}

const MOLECULES: QuizMolecule[] = [
  {
    id: "glukoza-a",
    name: "α-D-glukóza",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O",
    projection: HAWORTH,
    haworth: true,
  },
  {
    id: "galaktoza-b",
    name: "β-D-galaktóza",
    smiles: "C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O",
    projection: HAWORTH,
    haworth: true,
  },
  {
    id: "manoza-a",
    name: "α-D-manóza",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@@H]([C@H](O1)O)O)O)O)O",
  },
]

const QUESTION: QuizQuestion = {
  type: "structureToName",
  targetId: "glukoza-a",
  uid: "1712345678901-3",
  prompt: {
    kind: "structure",
    text: "",
    smiles: MOLECULES[0].smiles,
    haworth: true,
    projection: HAWORTH,
  },
  options: [
    { key: "glukoza-a", display: "name", moleculeId: "glukoza-a", correct: true },
    { key: "galaktoza-b", display: "name", moleculeId: "galaktoza-b", correct: false },
  ],
  openAnswer: { kind: "name", acceptedAnswers: ["α-D-glukóza", "glukóza", "Glc"] },
}

describe("snapshotOfQuestion", () => {
  it("freezes the question type, scope and resolved target molecule", () => {
    const snapshot = snapshotOfQuestion(QUESTION, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: null,
    })

    expect(snapshot.questionType).toBe("structureToName")
    expect(snapshot.scopeSlug).toBe("sacharidy")
    expect(snapshot.target).toEqual({
      name: "α-D-glukóza",
      smiles: MOLECULES[0].smiles,
    })
  })

  it("copies the prompt fields, passing the projection through opaquely", () => {
    const snapshot = snapshotOfQuestion(QUESTION, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: null,
    })

    expect(snapshot.prompt).toEqual({
      kind: "structure",
      text: "",
      smiles: MOLECULES[0].smiles,
      haworth: true,
      projection: HAWORTH,
    })
  })

  it("resolves each option's name and smiles from the molecule list", () => {
    const snapshot = snapshotOfQuestion(QUESTION, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: null,
    })

    expect(snapshot.options).toEqual([
      {
        key: "glukoza-a",
        display: "name",
        name: "α-D-glukóza",
        smiles: MOLECULES[0].smiles,
        haworth: true,
        projection: HAWORTH,
        correct: true,
      },
      {
        key: "galaktoza-b",
        display: "name",
        name: "β-D-galaktóza",
        smiles: MOLECULES[1].smiles,
        haworth: true,
        projection: HAWORTH,
        correct: false,
      },
    ])
  })

  it("preserves option-display data when the molecule carries none", () => {
    const question: QuizQuestion = {
      type: "nameToStructure",
      targetId: "manoza-a",
      prompt: { kind: "name", text: "α-D-manóza" },
      options: [
        {
          key: "manoza-a",
          display: "structure",
          moleculeId: "manoza-a",
          correct: true,
          smiles: "CCO",
          orientationDeg: 90,
        },
      ],
    }

    const snapshot = snapshotOfQuestion(question, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: true,
    })

    expect(snapshot.options[0]).toEqual({
      key: "manoza-a",
      display: "structure",
      name: "α-D-manóza",
      smiles: "CCO",
      correct: true,
    })
    // orientationDeg is deliberately not part of the frozen contract.
    expect(snapshot.prompt).toEqual({ kind: "name", text: "α-D-manóza", projection: null })
  })

  it("encodes answeredCorrect as null, true or false", () => {
    const make = (answeredCorrect: boolean | null): BiomoleculeQuestionReportSnapshot =>
      snapshotOfQuestion(QUESTION, {
        scopeSlug: "sacharidy",
        molecules: MOLECULES,
        answeredCorrect,
      })

    expect(make(null).answeredCorrect).toBeNull()
    expect(make(true).answeredCorrect).toBe(true)
    expect(make(false).answeredCorrect).toBe(false)
  })

  it("copies accepted open answers as a fresh array, or null when absent", () => {
    const withOpen = snapshotOfQuestion(QUESTION, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: false,
    })
    expect(withOpen.openAnswer).toEqual({
      acceptedAnswers: ["α-D-glukóza", "glukóza", "Glc"],
    })

    // Mutating the live question must not leak into the frozen snapshot.
    QUESTION.openAnswer?.acceptedAnswers.push("cukr")
    expect(withOpen.openAnswer?.acceptedAnswers).not.toContain("cukr")
    QUESTION.openAnswer?.acceptedAnswers.pop()

    const easyQuestion: QuizQuestion = { ...QUESTION, openAnswer: undefined }
    const withoutOpen = snapshotOfQuestion(easyQuestion, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: null,
    })
    expect(withoutOpen.openAnswer).toBeNull()
  })

  it("falls back safely when a molecule is missing from the lookup", () => {
    const question: QuizQuestion = {
      ...QUESTION,
      targetId: "missing",
      options: [{ key: "ghost", display: "letter", moleculeId: "missing", correct: true }],
    }

    const snapshot = snapshotOfQuestion(question, {
      scopeSlug: "aminokyseliny",
      molecules: MOLECULES,
      answeredCorrect: null,
    })

    expect(snapshot.target).toEqual({ name: "", smiles: "" })
    expect(snapshot.options[0]).toMatchObject({
      key: "ghost",
      display: "letter",
      name: "ghost",
      correct: true,
    })
  })
})

describe("biomoleculeReportsApi", () => {
  const input: BiomoleculeReportQuestionInput = {
    questionUid: "1712345678901-3",
    scopeSlug: "sacharidy",
    message: "Špatně vykreslená Haworthova projekce.",
    snapshot: snapshotOfQuestion(QUESTION, {
      scopeSlug: "sacharidy",
      molecules: MOLECULES,
      answeredCorrect: null,
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("posts a student report to its endpoint", async () => {
    mockedHttpRequest.mockResolvedValue(undefined)

    await biomoleculeReportsApi.reportQuestion(input)

    expect(mockedHttpRequest).toHaveBeenCalledWith("/api/biomolecules/report-question", input)
  })

  it("lists teacher reports without a body", async () => {
    mockedHttpRequest.mockResolvedValue([])

    await biomoleculeReportsApi.listQuestionReports()

    expect(mockedHttpRequest).toHaveBeenCalledWith("/api/biomolecules/list-question-reports")
  })

  it("gets and deletes a report by id", async () => {
    mockedHttpRequest.mockResolvedValue(undefined)

    await biomoleculeReportsApi.getQuestionReport("report-1")
    await biomoleculeReportsApi.deleteQuestionReport("report-1")

    expect(mockedHttpRequest).toHaveBeenNthCalledWith(1, "/api/biomolecules/get-question-report", {
      id: "report-1",
    })
    expect(mockedHttpRequest).toHaveBeenNthCalledWith(
      2,
      "/api/biomolecules/delete-question-report",
      { id: "report-1" },
    )
  })
})
