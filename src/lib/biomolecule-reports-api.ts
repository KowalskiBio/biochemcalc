import { httpRequest } from "./http"
import type { QuizMolecule, QuizQuestion } from "./molecules/quiz/question-generator"

/**
 * A frozen option of a reported Biomolecule quiz question. Mirrors what the
 * student saw, including the molecule's display data and projection, so a
 * teacher can review the report long after the underlying question changed.
 */
export interface BiomoleculeReportOptionSnapshot {
  key: string
  display: "name" | "letter" | "structure"
  name: string
  smiles?: string
  haworth?: boolean
  /** Passed through opaquely — the frontend's `ProjectionSpec` union. */
  projection?: unknown | null
  correct: boolean
}

/** The self-contained frozen JSON of a reported question, stored verbatim. */
export interface BiomoleculeQuestionReportSnapshot {
  /** One of the engine's `QuizQuestionType` values. */
  questionType: string
  scopeSlug: string
  target: { name: string; smiles: string }
  prompt: {
    kind: string
    text: string
    smiles?: string
    haworth?: boolean
    projection?: unknown | null
  }
  options: BiomoleculeReportOptionSnapshot[]
  openAnswer?: { acceptedAnswers: string[] } | null
  /** null when the question was reported before the student answered it. */
  answeredCorrect: boolean | null
}

/** A student's "this question is broken" report. */
export interface BiomoleculeReportQuestionInput {
  /** The page-tagged `QuizQuestion.uid` of the reported question. */
  questionUid: string
  /** The category slug (or topic-wide scope) the run was played in. */
  scopeSlug: string
  message: string
  snapshot: BiomoleculeQuestionReportSnapshot
}

/** One report row in the teacher's Biomolecule inbox. */
export interface BiomoleculeQuestionReportSummary {
  id: string
  studentUsername: string
  scopeSlug: string
  message: string
  createdAt: string
}

/** A teacher's full view of one report, including the frozen snapshot. */
export interface BiomoleculeQuestionReportDetail extends BiomoleculeQuestionReportSummary {
  questionUid: string
  snapshot: BiomoleculeQuestionReportSnapshot
}

/**
 * Freeze a generated question exactly as the student saw it: resolve the
 * target and option molecules to their display names/SMILES, copy the prompt
 * (including its opaque projection) and the accepted open answers, and record
 * whether the answer was correct at report time (`null` when unanswered).
 */
export function snapshotOfQuestion(
  question: QuizQuestion,
  ctx: {
    scopeSlug: string
    /** The run's quiz molecules (`CategoryQuizConfig.molecules`). */
    molecules: QuizMolecule[]
    answeredCorrect: boolean | null
  },
): BiomoleculeQuestionReportSnapshot {
  const byId = new Map(ctx.molecules.map((molecule) => [molecule.id, molecule]))
  const target = byId.get(question.targetId)
  const prompt = question.prompt

  return {
    questionType: question.type,
    scopeSlug: ctx.scopeSlug,
    target: {
      name: target?.name ?? "",
      smiles: target?.smiles ?? "",
    },
    prompt: {
      kind: prompt.kind,
      text: prompt.text,
      ...(prompt.smiles !== undefined ? { smiles: prompt.smiles } : {}),
      ...(prompt.haworth !== undefined ? { haworth: prompt.haworth } : {}),
      projection: prompt.projection ?? null,
    },
    options: question.options.map((option) => {
      const molecule = byId.get(option.moleculeId)
      const smiles = option.smiles ?? molecule?.smiles
      const haworth = option.haworth ?? molecule?.haworth
      const projection = option.projection ?? molecule?.projection
      return {
        key: option.key,
        display: option.display,
        name: molecule?.name ?? option.key,
        ...(smiles !== undefined ? { smiles } : {}),
        ...(haworth !== undefined ? { haworth } : {}),
        ...(projection !== undefined ? { projection } : {}),
        correct: option.correct,
      }
    }),
    openAnswer: question.openAnswer
      ? { acceptedAnswers: [...question.openAnswer.acceptedAnswers] }
      : null,
    answeredCorrect: ctx.answeredCorrect,
  }
}

/**
 * `/api/biomolecules/*` — the student report slot plus the teacher-only inbox
 * for broken Biomolecule quiz questions. The student surface is the only one a
 * student account can reach; the teacher endpoints take their identity from
 * the session cookie, never from a request body.
 */
export const biomoleculeReportsApi = {
  /**
   * Report the currently displayed question as broken. `snapshot` is frozen by
   * the client (`snapshotOfQuestion`) and stored verbatim; a duplicate report
   * of the same `questionUid` is rejected by the server.
   */
  reportQuestion: (input: BiomoleculeReportQuestionInput): Promise<void> =>
    httpRequest<void>("/api/biomolecules/report-question", input),

  /** Every report, newest first. Deleted users list with fallback text. */
  listQuestionReports: (): Promise<BiomoleculeQuestionReportSummary[]> =>
    httpRequest<BiomoleculeQuestionReportSummary[]>("/api/biomolecules/list-question-reports"),

  /** One report with the frozen snapshot of the question exactly as the student saw it. */
  getQuestionReport: (id: string): Promise<BiomoleculeQuestionReportDetail> =>
    httpRequest<BiomoleculeQuestionReportDetail>("/api/biomolecules/get-question-report", { id }),

  /** Hard delete — no archive; for when the underlying question is fixed. */
  deleteQuestionReport: (id: string): Promise<void> =>
    httpRequest<void>("/api/biomolecules/delete-question-report", { id }),
}
