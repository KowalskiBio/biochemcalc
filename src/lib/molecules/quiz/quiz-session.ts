import type { QuizQuestion, QuizQuestionType } from "@/lib/molecules/quiz/question-generator"

export interface QuizSessionState {
  questions: QuizQuestion[]
  /** 0-based index of the current question. */
  index: number
  selectedKey: string | null
  /** Selection locked and feedback shown. */
  answered: boolean
  /** Per-question correctness, in the same order as `questions`. */
  answers: boolean[]
  finished: boolean
}

export type QuizAction =
  | { type: "select"; key: string }
  | { type: "next" }
  | { type: "restart"; questions: QuizQuestion[] }

export interface QuizTypeScore {
  correct: number
  total: number
}

export interface QuizScoreSummary {
  correct: number
  total: number
  byType: Partial<Record<QuizQuestionType, QuizTypeScore>>
}

export function createQuizSession(questions: QuizQuestion[]): QuizSessionState {
  return {
    questions,
    index: 0,
    selectedKey: null,
    answered: false,
    answers: [],
    finished: questions.length === 0,
  }
}

export function quizSessionReducer(state: QuizSessionState, action: QuizAction): QuizSessionState {
  switch (action.type) {
    case "select": {
      if (state.answered || state.finished) {
        return state
      }
      const question = state.questions[state.index]
      if (question === undefined) {
        return state
      }
      const option = question.options.find((candidate) => candidate.key === action.key)
      if (option === undefined) {
        return state
      }
      const answers = [...state.answers]
      answers[state.index] = option.correct
      return { ...state, selectedKey: action.key, answered: true, answers }
    }
    case "next": {
      if (!state.answered || state.finished) {
        return state
      }
      const nextIndex = state.index + 1
      if (nextIndex >= state.questions.length) {
        return { ...state, selectedKey: null, answered: false, finished: true }
      }
      return { ...state, index: nextIndex, selectedKey: null, answered: false }
    }
    case "restart":
      return createQuizSession(action.questions)
  }
}

/** Aggregate correct/total, overall and per question type. Pure. */
export function scoreSummary(state: QuizSessionState): QuizScoreSummary {
  const byType: Partial<Record<QuizQuestionType, QuizTypeScore>> = {}
  let correct = 0

  for (let i = 0; i < state.questions.length; i++) {
    const answeredCorrectly = state.answers[i]
    if (answeredCorrectly === undefined) {
      continue
    }
    const type = state.questions[i].type
    const bucket = byType[type] ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (answeredCorrectly) {
      bucket.correct += 1
      correct += 1
    }
    byType[type] = bucket
  }

  return { correct, total: state.questions.length, byType }
}
