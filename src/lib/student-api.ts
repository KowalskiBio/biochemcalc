import { httpRequest } from "./http"
import type {
  FinishTestInput,
  LeaderboardEntry,
  NextQuestionInput,
  NextStreakQuestionInput,
  PracticeAnswerResult,
  PracticeQuestion,
  PracticeTopic,
  ReportQuestionInput,
  StartStreakRunInput,
  StartTestInput,
  StreakLeaderboardEntry,
  StreakLeaderboardInput,
  StreakRunSummary,
  StreakRunSummaryInput,
  StreakRunView,
  SubmitAnswerInput,
  TestKind,
  TestResults,
  TestSessionView,
  TestTopicOption,
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
   * Topics offered as timed tests: flagged by the teacher and holding at
   * least 4 questions at each of 2/3/4 points.
   */
  /** The tests of `kind` a student can sit right now. */
  testTopics: (kind: TestKind): Promise<TestTopicOption[]> =>
    httpRequest<TestTopicOption[]>("/api/student/test-topics", { kind }),

  /**
   * A fresh question — new random values every call, so a topic never runs
   * out. Open or closed is chosen at random per question, unless `mode` is
   * given to restrict it to just one.
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

  /**
   * Generate a 12-question test session (4 questions at each of 2/3/4
   * points, drawn from all of the topic's sets) at once, timed or not.
   */
  startTest: (input: StartTestInput): Promise<TestSessionView> =>
    httpRequest<TestSessionView>("/api/student/start-test", input),

  /**
   * Mark a test session finished and get its score summary. Safe to call
   * more than once (e.g. a reloaded results page): only the first call
   * freezes the elapsed time, later calls just re-read the same summary.
   */
  finishTest: (input: FinishTestInput): Promise<TestResults> =>
    httpRequest<TestResults>("/api/student/finish-test", input),

  /** Start an endless streak run: "apprentice" (scoped, like practice) or "master" (everything). */
  startStreakRun: (input: StartStreakRunInput): Promise<StreakRunView> =>
    httpRequest<StreakRunView>("/api/student/start-streak-run", input),

  /** A fresh question for a run still in progress. Refused once it has already failed. */
  nextStreakQuestion: (input: NextStreakQuestionInput): Promise<PracticeQuestion> =>
    httpRequest<PracticeQuestion>("/api/student/next-streak-question", input),

  /** The frozen score of a run that has already ended. */
  streakRunSummary: (input: StreakRunSummaryInput): Promise<StreakRunSummary> =>
    httpRequest<StreakRunSummary>("/api/student/streak-run-summary", input),

  streakLeaderboard: (input: StreakLeaderboardInput): Promise<StreakLeaderboardEntry[]> =>
    httpRequest<StreakLeaderboardEntry[]>("/api/student/streak-leaderboard", input),
}
