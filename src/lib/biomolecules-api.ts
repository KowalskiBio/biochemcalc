import { httpRequest } from "./http"

/** Teacher-edited text for one category; a missing field = built-in text. */
export interface CategoryOverride {
  name?: string
  description?: string
}

/** Category slug → its overrides. A missing slug = all built-in text. */
export type CategoryOverrides = Record<string, CategoryOverride>

export type CategoryField = "name" | "description"

/** One user's summed Biomolekuly quiz scores. */
export interface BiomoleculeLeaderboardEntry {
  userId: string
  username: string
  correctCount: number
  answeredCount: number
  quizCount: number
}

/** `/api/biomolecules/*` — Biomolekuly category display text and quiz leaderboard. */
export const biomoleculesApi = {
  /** Any logged-in user. */
  categoryOverrides: (): Promise<CategoryOverrides> =>
    httpRequest<CategoryOverrides>("/api/biomolecules/category-overrides"),

  /**
   * Teacher-only: change a category's name or description for everyone; a
   * null/blank value restores the built-in text. Returns the full override map.
   */
  updateCategory: (
    categoryId: string,
    field: CategoryField,
    value: string | null,
  ): Promise<CategoryOverrides> =>
    httpRequest<CategoryOverrides>("/api/biomolecules/update-category", {
      categoryId,
      field,
      value,
    }),

  /** Store the score of a finished quiz (needs Biomolekuly access). */
  recordQuizResult: (categoryId: string, correctCount: number, totalCount: number): Promise<void> =>
    httpRequest<void>("/api/biomolecules/record-quiz-result", {
      categoryId,
      correctCount,
      totalCount,
    }),

  /** Any logged-in user. Omitting `categoryId` sums every category. */
  leaderboard: (categoryId?: string): Promise<BiomoleculeLeaderboardEntry[]> =>
    httpRequest<BiomoleculeLeaderboardEntry[]>("/api/biomolecules/leaderboard", { categoryId }),
}
