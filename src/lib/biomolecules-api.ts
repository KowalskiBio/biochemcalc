import { httpRequest } from "./http"

/**
 * Optional molecule characteristics. The keys are a controlled vocabulary
 * validated server-side (see `commands::biomolecules::traits`); a molecule
 * carries any subset of them.
 */
export type BiomoleculeTraits = Record<string, string>

/** One Biomolekuly topic — the grouping level above categories. */
export interface BiomoleculeTopicInfo {
  slug: string
  name: string
  description?: string
  builtIn: boolean
  /** Row version; writes may echo it back so they only land on an unchanged row. */
  updatedAt?: string
}

/** One Biomolekuly category, as listed on the hub. */
export interface BiomoleculeCategoryInfo {
  slug: string
  name: string
  description?: string
  builtIn: boolean
  moleculeCount: number
  /** The topic this category is grouped under, if any. */
  topicSlug?: string | null
  updatedAt?: string
}

/** One molecule. `name` and `smiles` are mandatory, traits optional. */
export interface Biomolecule {
  id: string
  categorySlug: string
  /** Stable per-category slug — the molecule's identity in quiz questions. */
  slug: string
  name: string
  smiles: string
  /** Raw JSON Haworth projection spec, when the molecule has one. */
  projection?: string | null
  /**
   * Whether to recognize saccharides and draw them as a Haworth projection.
   * `undefined`/absent means `true` (the default behavior).
   */
  haworth?: boolean
  position: number
  traits: BiomoleculeTraits
  updatedAt?: string
}

/** The whole Biomolekuly library; every mutation returns a fresh copy. */
export interface BiomoleculeData {
  topics: BiomoleculeTopicInfo[]
  categories: BiomoleculeCategoryInfo[]
  molecules: Biomolecule[]
}

export type CategoryField = "name" | "description"

/** Fields editable through `updateCategoryMeta`; `"topic"` moves the category. */
export type CategoryMetaField = CategoryField | "topic"

export type TopicField = "name" | "description"

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

  /** Teacher: create a topic (the server derives its slug from the name). */
  createTopic: (name: string, description?: string): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-topic", { name, description }),

  /** Teacher: rename a topic or change its description. */
  updateTopicMeta: (topicId: string, field: TopicField, value?: string): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/update-topic-meta", {
      topicId,
      field,
      value,
    }),

  /** Teacher: delete a topic; its categories remain, just ungrouped. */
  deleteTopic: (topicId: string): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/delete-topic", { topicId }),

  /** Teacher: create a category (the server derives its slug from the name). */
  createCategory: (
    name: string,
    description: string | null,
    topicId?: string,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-category", {
      name,
      description,
      topicId,
    }),

  /** Teacher: rename a category, change its description, or move it to a topic. */
  updateCategoryMeta: (
    categoryId: string,
    field: CategoryMetaField,
    value?: string | null,
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
    projection?: string | null,
    haworth?: boolean,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-molecule", {
      categoryId,
      name,
      smiles,
      projection: projection ?? null,
      traits,
      ...(haworth === undefined ? {} : { haworth }),
    }),

  /**
   * Teacher: update a molecule's name, SMILES, trait set (wholesale), and
   * projection; a `categoryId` other than its own moves it there.
   */
  updateMolecule: (
    moleculeId: string,
    name: string,
    smiles: string,
    traits: BiomoleculeTraits,
    projection?: string | null,
    haworth?: boolean,
    categoryId?: string,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/update-molecule", {
      moleculeId,
      name,
      smiles,
      projection: projection ?? null,
      traits,
      ...(haworth === undefined ? {} : { haworth }),
      ...(categoryId === undefined ? {} : { categoryId }),
    }),

  /**
   * Teacher: reorder. Each takes every item in the new order plus the order
   * it was based on, so a concurrent change is refused instead of lost.
   */
  reorderTopics: (slugs: string[], expectedOrder: string[]): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/reorder-topics", { slugs, expectedOrder }),

  reorderCategories: (slugs: string[], expectedOrder: string[]): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/reorder-categories", {
      slugs,
      expectedOrder,
    }),

  reorderMolecules: (
    categoryId: string,
    ids: string[],
    expectedOrder: string[],
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/reorder-molecules", {
      categoryId,
      ids,
      expectedOrder,
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
  streakLeaderboard: (kind: BiomoleculeStreakKind): Promise<BiomoleculeStreakLeaderboardEntry[]> =>
    httpRequest<BiomoleculeStreakLeaderboardEntry[]>("/api/biomolecules/streak-leaderboard", {
      kind,
    }),
}
