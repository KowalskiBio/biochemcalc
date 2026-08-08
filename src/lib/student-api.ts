import { httpRequest } from "./http"
import type {
  LeaderboardEntry,
  NextQuestionInput,
  PracticeAnswerResult,
  PracticeQuestion,
  PracticeTopic,
  ReportQuestionInput,
  SubmitAnswerInput,
} from "./types"

/**
 * `/api/student/*` — the practice generator and leaderboard, the only API
 * surface a student account can reach (`/api/cmd/*` is teacher-only). The
 * acting user comes from the session cookie, never from a request body.
 */
export const studentApi = {
  /** Topics that have questions, each with the difficulties it can serve. */
  topics: (): Promise<PracticeTopic[]> => httpRequest<PracticeTopic[]>("/api/student/topics"),

  /**
   * A fresh question — new random values every call, so a topic never runs
   * out. Open or closed is chosen at random per question.
   */
  nextQuestion: (input: NextQuestionInput): Promise<PracticeQuestion> =>
    httpRequest<PracticeQuestion>("/api/student/next-question", input),

  /**
   * Grade an answer. An attempt can be submitted only once — the server
   * refuses a second submission rather than re-grading it.
   */
  submitAnswer: (input: SubmitAnswerInput): Promise<PracticeAnswerResult> =>
    httpRequest<PracticeAnswerResult>("/api/student/submit-answer", input),

  /** Report the currently displayed question as broken ("Co je s otázkou špatně?"). */
  reportQuestion: (input: ReportQuestionInput): Promise<void> =>
    httpRequest<void>("/api/student/report-question", input),

  leaderboard: (): Promise<LeaderboardEntry[]> =>
    httpRequest<LeaderboardEntry[]>("/api/student/leaderboard"),
}
