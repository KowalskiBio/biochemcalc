import { describe, expect, it } from "vitest"
import { getCategoryQuizConfig } from "@/lib/molecules/quiz/category-quiz"
import {
  ALL_QUIZ_TYPES,
  generateQuizSession,
  type QuizQuestion,
} from "@/lib/molecules/quiz/question-generator"
import {
  createQuizSession,
  quizSessionReducer,
  scoreSummary,
} from "@/lib/molecules/quiz/quiz-session"
import { TEST_AMINO_ACIDS } from "./fixtures"

const aminoAcidsConfig = getCategoryQuizConfig(TEST_AMINO_ACIDS[0].categorySlug, TEST_AMINO_ACIDS)
if (aminoAcidsConfig === undefined) {
  throw new Error("expected a quiz config for the fixture amino acids")
}

const questions = generateQuizSession(aminoAcidsConfig.molecules, {
  types: [...ALL_QUIZ_TYPES],
  questionCount: 3,
  seed: 7,
  characteristics: aminoAcidsConfig.characteristics,
})

function correctKey(question: QuizQuestion): string {
  const option = question.options.find((candidate) => candidate.correct)
  if (option === undefined) {
    throw new Error("question has no correct option")
  }
  return option.key
}

function wrongKey(question: QuizQuestion): string {
  const option = question.options.find((candidate) => !candidate.correct)
  if (option === undefined) {
    throw new Error("question has no wrong option")
  }
  return option.key
}

describe("createQuizSession", () => {
  it("starts at the first question, unanswered", () => {
    const session = createQuizSession(questions)
    expect(session.index).toBe(0)
    expect(session.selectedKey).toBeNull()
    expect(session.answered).toBe(false)
    expect(session.answers).toEqual([])
    expect(session.finished).toBe(false)
  })

  it("marks an empty session as finished", () => {
    expect(createQuizSession([]).finished).toBe(true)
  })
})

describe("quizSessionReducer select", () => {
  it("records correctness and locks the answer", () => {
    const session = createQuizSession(questions)
    const key = correctKey(session.questions[0])
    const next = quizSessionReducer(session, { type: "select", key })

    expect(next.selectedKey).toBe(key)
    expect(next.answered).toBe(true)
    expect(next.answers[0]).toBe(true)
  })

  it("records an incorrect answer as false", () => {
    const session = createQuizSession(questions)
    const next = quizSessionReducer(session, {
      type: "select",
      key: wrongKey(session.questions[0]),
    })
    expect(next.answers[0]).toBe(false)
  })

  it("ignores a second select after answering", () => {
    const answered = quizSessionReducer(createQuizSession(questions), {
      type: "select",
      key: correctKey(questions[0]),
    })
    const again = quizSessionReducer(answered, {
      type: "select",
      key: wrongKey(questions[0]),
    })
    expect(again.selectedKey).toBe(answered.selectedKey)
    expect(again.answers[0]).toBe(true)
    expect(again).toBe(answered)
  })
})

describe("quizSessionReducer next", () => {
  it("is ignored before answering", () => {
    const session = createQuizSession(questions)
    expect(quizSessionReducer(session, { type: "next" })).toBe(session)
  })

  it("advances and clears the selection", () => {
    let session = createQuizSession(questions)
    session = quizSessionReducer(session, {
      type: "select",
      key: correctKey(session.questions[0]),
    })
    session = quizSessionReducer(session, { type: "next" })

    expect(session.index).toBe(1)
    expect(session.selectedKey).toBeNull()
    expect(session.answered).toBe(false)
    expect(session.finished).toBe(false)
  })

  it("finishes after the last question", () => {
    let session = createQuizSession(questions)
    for (let i = 0; i < questions.length; i++) {
      session = quizSessionReducer(session, {
        type: "select",
        key: correctKey(session.questions[session.index]),
      })
      session = quizSessionReducer(session, { type: "next" })
    }
    expect(session.finished).toBe(true)
  })
})

describe("quizSessionReducer restart", () => {
  it("resets to a fresh session", () => {
    let session = createQuizSession(questions)
    session = quizSessionReducer(session, {
      type: "select",
      key: correctKey(session.questions[0]),
    })
    const fresh = generateQuizSession(aminoAcidsConfig.molecules, {
      types: [...ALL_QUIZ_TYPES],
      questionCount: 2,
      seed: 42,
      characteristics: aminoAcidsConfig.characteristics,
    })
    session = quizSessionReducer(session, { type: "restart", questions: fresh })

    expect(session.questions).toEqual(fresh)
    expect(session.index).toBe(0)
    expect(session.selectedKey).toBeNull()
    expect(session.answered).toBe(false)
    expect(session.answers).toEqual([])
    expect(session.finished).toBe(false)
  })
})

describe("scoreSummary", () => {
  it("summarizes overall and per-type results", () => {
    let session = createQuizSession(questions)
    session = quizSessionReducer(session, {
      type: "select",
      key: correctKey(session.questions[0]),
    })
    session = quizSessionReducer(session, { type: "next" })
    session = quizSessionReducer(session, {
      type: "select",
      key: wrongKey(session.questions[1]),
    })
    session = quizSessionReducer(session, { type: "next" })
    session = quizSessionReducer(session, {
      type: "select",
      key: correctKey(session.questions[2]),
    })
    session = quizSessionReducer(session, { type: "next" })

    const summary = scoreSummary(session)
    expect(summary.correct).toBe(2)
    expect(summary.total).toBe(3)

    const perTypeTotal = Object.values(summary.byType).reduce(
      (sum, bucket) => sum + (bucket?.total ?? 0),
      0,
    )
    expect(perTypeTotal).toBe(3)
  })
})
