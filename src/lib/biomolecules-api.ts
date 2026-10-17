import { httpRequest } from "./http"

/**
 * Optional molecule characteristics. The keys are a controlled vocabulary
 * validated server-side (see `commands::biomolecules::traits`); a molecule
 * carries any subset of them.
 */
export type BiomoleculeTraits = Record<string, string>

/** One Biomolekuly category, as listed on the hub. */
export interface BiomoleculeCategoryInfo {
  slug: string
  name: string
  description?: string
  builtIn: boolean
  moleculeCount: number
}

/** One molecule. `name` and `smiles` are mandatory, traits optional. */
export interface Biomolecule {
  id: string
  categorySlug: string
  /** Stable per-category slug — the molecule's identity in quiz questions. */
  slug: string
  name: string
  smiles: string
  position: number
  traits: BiomoleculeTraits
}

/** The whole Biomolekuly library; every mutation returns a fresh copy. */
export interface BiomoleculeData {
  categories: BiomoleculeCategoryInfo[]
  molecules: Biomolecule[]
}

export type CategoryField = "name" | "description"

/** One user's summed Biomolekuly quiz scores. */
export interface BiomoleculeLeaderboardEntry {
  userId: string
  username: string
  correctCount: number
  answeredCount: number
  quizCount: number
  /** Weighted score: hard-mode correct answers count double. */
  points: number
}

/** The two Biomolekuly streak variants: Učeň and Mistr. */
export type BiomoleculeStreakKind = "apprentice" | "master"

/** One user's best finished Biomolekuly streak of a given kind. */
export interface BiomoleculeStreakLeaderboardEntry {
  userId: string
  username: string
  bestCorrectCount: number
  totalSeconds: number
  /** `totalSeconds / (bestCorrectCount + 1)` — the failed answer counts too. */
  secondsPerAnswer: number
}

/** `/api/biomolecules/*` — the molecule library, its management, and the leaderboard. */
export const biomoleculesApi = {
  /** Any logged-in user: the full category + molecule dataset. */
  data: (): Promise<BiomoleculeData> => httpRequest<BiomoleculeData>("/api/biomolecules/data"),

  /** Teacher: create a category (the server derives its slug from the name). */
  createCategory: (name: string, description: string | null): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-category", { name, description }),

  /** Teacher: rename a category or change its description. */
  updateCategoryMeta: (
    categoryId: string,
    field: CategoryField,
    value: string | null,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/update-category-meta", {
      categoryId,
      field,
      value,
    }),

  /** Teacher: delete a category with its molecules (past quiz scores remain). */
  deleteCategory: (categoryId: string): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/delete-category", { categoryId }),

  /** Teacher: add a molecule to a category. */
  createMolecule: (
    categoryId: string,
    name: string,
    smiles: string,
    traits: BiomoleculeTraits,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-molecule", {
      categoryId,
      name,
      smiles,
      traits,
    }),

  /** Teacher: update a molecule's name, SMILES, and trait set (wholesale). */
  updateMolecule: (
    moleculeId: string,
    name: string,
    smiles: string,
    traits: BiomoleculeTraits,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/update-molecule", {
      moleculeId,
      name,
      smiles,
      traits,
    }),

  /** Teacher: delete one molecule. */
  deleteMolecule: (moleculeId: string): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/delete-molecule", { moleculeId }),

  /** Store the score of a finished quiz (needs Biomolekuly access). */
  recordQuizResult: (args: {
    categoryId: string
    correctCount: number
    totalCount: number
    /** Played difficulty: `"easy"` or `"hard"` — hard answers score double. */
    mode: "easy" | "hard"
  }): Promise<void> => httpRequest<void>("/api/biomolecules/record-quiz-result", args),

  /** Any logged-in user. Omitting `categoryId` sums every category. */
  leaderboard: (categoryId?: string): Promise<BiomoleculeLeaderboardEntry[]> =>
    httpRequest<BiomoleculeLeaderboardEntry[]>("/api/biomolecules/leaderboard", { categoryId }),

  /** Store the aggregate of a finished streak run (needs Biomolekuly access). */
  recordStreakResult: (args: {
    kind: BiomoleculeStreakKind
    correctCount: number
    totalSeconds: number
  }): Promise<void> => httpRequest<void>("/api/biomolecules/record-streak-result", args),

  /** Any logged-in user. Each user's single best finished run of `kind`. */
  streakLeaderboard: (
    kind: BiomoleculeStreakKind,
  ): Promise<BiomoleculeStreakLeaderboardEntry[]> =>
    httpRequest<BiomoleculeStreakLeaderboardEntry[]>("/api/biomolecules/streak-leaderboard", {
      kind,
    }),
}
