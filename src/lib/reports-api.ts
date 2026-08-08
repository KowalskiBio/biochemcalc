import { httpRequest } from "./http"
import type { QuestionReportDetail, QuestionReportSummary } from "./types"

/**
 * `/api/cmd/*` — the teacher-only inbox for student question reports. A
 * student can file a report but can never reach this surface; the acting
 * teacher's identity comes from the session cookie, never from a request
 * body.
 */
export const reportsApi = {
  /** Every report, newest first. Deleted users/topics list with fallback text. */
  list: (): Promise<QuestionReportSummary[]> =>
    httpRequest<QuestionReportSummary[]>("/api/cmd/list_question_reports"),

  /** One report with the frozen snapshot of the question exactly as the student saw it. */
  get: (id: string): Promise<QuestionReportDetail> =>
    httpRequest<QuestionReportDetail>("/api/cmd/get_question_report", { id }),

  /** Hard delete — no archive; for when the underlying question is fixed. */
  remove: (id: string): Promise<void> =>
    httpRequest<void>("/api/cmd/delete_question_report", { id }),
}
