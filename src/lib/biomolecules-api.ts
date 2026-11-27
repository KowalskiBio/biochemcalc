import { withClockOffset } from "@/lib/test-clock"
import { httpRequest } from "./http"

/**
 * Optional molecule characteristics. The keys are a controlled vocabulary
 * validated server-side (see `commands::biomolecules::traits`); a molecule
 * carries any subset of them.
 */
export type BiomoleculeTraits = Record<string, string>

/** One Biomolekuly topic – the grouping level above categories. */
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
  /** Stable per-category slug – the molecule's identity in quiz questions. */
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
  /**
   * Whether to recognize open-chain sugars and draw them as a Fischer
   * projection. `undefined`/absent means `true` (the default behavior).
   */
  fischer?: boolean
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

/** The two Peptidovka modes: Učeň and Mistr. */
export type PeptidovkaMode = "ucen" | "mistr"

/** One mode's teacher-editable Peptidovka settings. */
export interface PeptidovkaSettings {
  mode: PeptidovkaMode
  minLen: number
  maxLen: number
  secondsPerAa: number
  /** Amino-acid slug → weight (0-1); at least two entries must be positive. */
  weights: Record<string, number>
}

/** The aggregate of one finished Peptidovka run, as recorded for the leaderboard. */
export interface PeptidovkaRunResult {
  mode: PeptidovkaMode
  /**
   * Number of peptides GUESSED CORRECTLY in the run – the leaderboard's
   * "Nejlepší série" metric. Points (their in-game summary) are computed
   * but NOT recorded: time/answer needs a per-peptide unit to avg over.
   */
  correctCount: number
  totalSeconds: number
}

/** How a teacher-created test picks its seed: one shared seed, or per attempt. */
export type BiomoleculeTestQuestionSet = "fixed" | "random"

/** A teacher-created Biomolekuly test, as returned by the API. */
export interface BiomoleculeTest {
  id: string
  title: string
  categorySlugs: string[]
  /** Creation-time molecule pool snapshot (client-resolved). */
  moleculeIds: string[]
  /** Canonical quiz type ids: nameToLetter, letterToName, … */
  questionTypes: string[]
  questionCount: number
  questionSet: BiomoleculeTestQuestionSet
  monochrome: boolean
  availableFrom: string
  availableTo: string
  seed: number
  createdAt: string
  /**
   * Student invite codes this test targets. An empty array means ALL students
   * (the default for tests created before audiences existed).
   */
  assignedCodes: string[]
}

/** One student's attempt on a test, as seen by the teacher. */
export interface BiomoleculeTestAttemptSummary {
  attemptId: string
  userId: string
  username: string
  startedAt: string
  submittedAt: string | null
  totalCount: number | null
  correctCount: number | null
  /** The attempt's generation seed, used to regenerate its batch. */
  seed: number
  /** Stored per-item breakdown; null until the attempt is submitted. */
  detailJson: string | null
}

/** A teacher's per-test view: the test, its attempts, and who could still take it. */
export interface BiomoleculeTestTeacherView {
  test: BiomoleculeTest
  attempts: BiomoleculeTestAttemptSummary[]
  roster: { userId: string; username: string }[]
}

/** Teacher page: every test plus the page-level audience picker and server time. */
export interface BiomoleculeTestsTeacherPage {
  tests: BiomoleculeTestTeacherView[]
  /** All student invite codes with their registered-user counts (audience picker). */
  codes: { code: string; studentCount: number }[]
  /** One server timestamp so windows render without client clock skew. */
  serverNow: string
}

/** The test fields a student sees: no teacher-only audience, no generation seed. */
export type BiomoleculeTestStudentTest = Omit<BiomoleculeTest, "assignedCodes" | "seed">

/** A student's view: the test plus their own attempt (null = not started). */
export interface BiomoleculeTestStudentView {
  test: BiomoleculeTestStudentTest
  attempt: {
    attemptId: string
    seed: number
    startedAt: string
    submittedAt: string | null
    totalCount: number | null
    correctCount: number | null
    detailJson: string | null
  } | null
  /** Server clock at listing time. */
  serverNow: string
  /** Server minus device clock, attached by the API client on arrival. */
  clockOffsetMs: number
}

/** Result of starting/resuming: `"exists"` means resume or show the result. */
export interface BiomoleculeTestStartResult {
  status: "started" | "exists"
  attemptId: string
  seed: number
  startedAt: string
  submittedAt: string | null
  totalCount: number | null
  correctCount: number | null
}

/** How a teacher-created Peptidovka test picks its seed. */
export type PeptidovkaTestQuestionSet = "fixed" | "random"

/** A teacher-created Peptidovka test, as returned by the API. */
export interface PeptidovkaTest {
  id: string
  title: string
  /** Amino-acid molecule slugs; each carries weight 1. */
  poolSlugs: string[]
  peptideCount: number
  peptideMinLength: number
  peptideMaxLength: number
  questionSet: PeptidovkaTestQuestionSet
  monochrome: boolean
  availableFrom: string
  availableTo: string
  seed: number
  createdAt: string
  /**
   * Student invite codes this test targets. An empty array means ALL students
   * (the default for tests created before audiences existed).
   */
  assignedCodes: string[]
}

/** One student's attempt on a Peptidovka test, as seen by the teacher. */
export interface PeptidovkaTestAttemptSummary {
  attemptId: string
  userId: string
  username: string
  startedAt: string
  submittedAt: string | null
  totalCount: number | null
  correctCount: number | null
  /** The attempt's generation seed, used to regenerate its batch. */
  seed: number
  /** Stored per-item breakdown; null until the attempt is submitted. */
  detailJson: string | null
}

/** A teacher's per-test view: the test, its attempts, and who could still take it. */
export interface PeptidovkaTestTeacherView {
  test: PeptidovkaTest
  attempts: PeptidovkaTestAttemptSummary[]
  roster: { userId: string; username: string }[]
}

/** Teacher page: every test plus the page-level audience picker and server time. */
export interface PeptidovkaTestsTeacherPage {
  tests: PeptidovkaTestTeacherView[]
  /** All student invite codes with their registered-user counts (audience picker). */
  codes: { code: string; studentCount: number }[]
  /** One server timestamp so windows render without client clock skew. */
  serverNow: string
}

/** The test fields a student sees: no teacher-only audience, no generation seed. */
export type PeptidovkaTestStudentTest = Omit<PeptidovkaTest, "assignedCodes" | "seed">

/** A student's view: the test plus their own attempt (null = not started). */
export interface PeptidovkaTestStudentView {
  test: PeptidovkaTestStudentTest
  attempt: {
    attemptId: string
    seed: number
    startedAt: string
    submittedAt: string | null
    totalCount: number | null
    correctCount: number | null
    detailJson: string | null
  } | null
  /** Server clock at listing time. */
  serverNow: string
  /** Server minus device clock, attached by the API client on arrival. */
  clockOffsetMs: number
}

/** Result of starting/resuming: `"exists"` means resume or show the result. */
export interface PeptidovkaTestStartResult {
  status: "started" | "exists"
  attemptId: string
  seed: number
  startedAt: string
  submittedAt: string | null
  totalCount: number | null
  correctCount: number | null
}

/** Body accepted by `createPeptidovkaTest`; pool slugs resolved by the client. */
export interface CreatePeptidovkaTestInput {
  title: string
  poolSlugs: string[]
  peptideCount: number
  peptideMinLength: number
  peptideMaxLength: number
  questionSet: PeptidovkaTestQuestionSet
  monochrome?: boolean
  availableFrom: string
  availableTo: string
  /** Optional client-chosen seed; omitted means the server generates one. */
  seed?: number
  /**
   * Student invite codes to target. Omitted or `[]` means ALL students.
   */
  assignedCodes?: string[]
}

/** Body accepted by `createBiomoleculeTest`; ids are client-resolved. */
export interface CreateBiomoleculeTestInput {
  title: string
  categorySlugs: string[]
  moleculeIds: string[]
  questionTypes: string[]
  questionCount: number
  questionSet: BiomoleculeTestQuestionSet
  monochrome?: boolean
  availableFrom: string
  availableTo: string
  /** Optional client-chosen seed; omitted means the server generates one. */
  seed?: number
  /**
   * Student invite codes to target. Omitted or `[]` means ALL students.
   */
  assignedCodes?: string[]
}

/** One user's best finished Biomolekuly streak of a given kind. */
export interface BiomoleculeStreakLeaderboardEntry {
  userId: string
  username: string
  bestCorrectCount: number
  totalSeconds: number
  /** `totalSeconds / (bestCorrectCount + 1)` – the failed answer counts too. */
  secondsPerAnswer: number
}

/** `/api/biomolecules/*` – the molecule library, its management, and the leaderboard. */
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
    fischer?: boolean,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/create-molecule", {
      categoryId,
      name,
      smiles,
      projection: projection ?? null,
      traits,
      ...(haworth === undefined ? {} : { haworth }),
      ...(fischer === undefined ? {} : { fischer }),
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
    fischer?: boolean,
  ): Promise<BiomoleculeData> =>
    httpRequest<BiomoleculeData>("/api/biomolecules/update-molecule", {
      moleculeId,
      name,
      smiles,
      projection: projection ?? null,
      traits,
      ...(haworth === undefined ? {} : { haworth }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(fischer === undefined ? {} : { fischer }),
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
    /** Played difficulty: `"easy"` or `"hard"` – hard answers score double. */
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

  /** Any logged-in user: both Peptidovka modes' settings, Učeň first. */
  peptidovkaSettings: (): Promise<PeptidovkaSettings[]> =>
    httpRequest<PeptidovkaSettings[]>("/api/biomolecules/peptidovka-settings"),

  /** Teacher: replace one mode's settings (bounds validated server-side). */
  updatePeptidovkaSettings: (
    mode: PeptidovkaMode,
    settings: Omit<PeptidovkaSettings, "mode">,
  ): Promise<void> =>
    httpRequest<void>("/api/biomolecules/update-peptidovka-settings", { mode, ...settings }),

  /** Store the aggregate of one finished Peptidovka run. */
  recordPeptidovkaRun: (run: PeptidovkaRunResult): Promise<void> =>
    httpRequest<void>("/api/biomolecules/record-peptidovka-run", run),

  /** Any logged-in user: each user's single best finished Peptidovka run of the mode. */
  peptidovkaLeaderboard: (mode: PeptidovkaMode): Promise<BiomoleculeStreakLeaderboardEntry[]> =>
    httpRequest<BiomoleculeStreakLeaderboardEntry[]>("/api/biomolecules/peptidovka-leaderboard", {
      mode,
    }),

  /** Teacher: the module's action history, newest first (defaults 50/0). */
  biomoleculeHistory: (params?: {
    limit?: number
    offset?: number
  }): Promise<BiomoleculeHistoryEntry[]> =>
    httpRequest<BiomoleculeHistoryEntry[]>("/api/biomolecules/biomolecule-history", params ?? {}),

  /** Teacher: wipe the module's history (confirm dialog collects consent first). */
  clearBiomoleculeHistory: (): Promise<void> =>
    httpRequest<void>("/api/biomolecules/clear-biomolecule-history"),

  /** Teacher: create a test from a client-resolved molecule pool snapshot. */
  createBiomoleculeTest: (payload: CreateBiomoleculeTestInput): Promise<BiomoleculeTest> =>
    httpRequest<BiomoleculeTest>("/api/biomolecules/create-biomolecule-test", payload),

  /** Teacher: delete a test that no student has attempted yet. */
  deleteBiomoleculeTest: (id: string): Promise<void> =>
    httpRequest<void>("/api/biomolecules/delete-biomolecule-test", { testId: id }),

  /** Teacher: the page of tests with attempts, audience picker codes and server time. */
  biomoleculeTests: (): Promise<BiomoleculeTestsTeacherPage> =>
    httpRequest<BiomoleculeTestsTeacherPage>("/api/biomolecules/biomolecule-tests"),

  /** Student: tests currently open, each with this student's attempt status. */
  availableBiomoleculeTests: (): Promise<BiomoleculeTestStudentView[]> =>
    httpRequest<Omit<BiomoleculeTestStudentView, "clockOffsetMs">[]>(
      "/api/biomolecules/available-biomolecule-tests",
    ).then((views) => withClockOffset(views)),

  /** Student: start a test or resume/show an existing attempt. */
  startBiomoleculeTestAttempt: (testId: string): Promise<BiomoleculeTestStartResult> =>
    httpRequest<BiomoleculeTestStartResult>("/api/biomolecules/start-biomolecule-test", {
      testId,
    }),

  /** Student: submit one attempt (idempotent; the server keeps the first result). */
  submitBiomoleculeTestAttempt: (args: {
    attemptId: string
    totalCount: number
    correctCount: number
    detailJson?: string | null
  }): Promise<void> =>
    httpRequest<void>("/api/biomolecules/submit-biomolecule-test", {
      ...args,
      detailJson: args.detailJson ?? null,
    }),

  /** Teacher: create a Peptidovka test from a client-resolved amino-acid pool. */
  createPeptidovkaTest: (payload: CreatePeptidovkaTestInput): Promise<PeptidovkaTest> =>
    httpRequest<PeptidovkaTest>("/api/biomolecules/create-peptidovka-test", payload),

  /** Teacher: delete a Peptidovka test that no student has attempted yet. */
  deletePeptidovkaTest: (id: string): Promise<void> =>
    httpRequest<void>("/api/biomolecules/delete-peptidovka-test", { testId: id }),

  /** Teacher: the page of Peptidovka tests with attempts, codes and server time. */
  peptidovkaTests: (): Promise<PeptidovkaTestsTeacherPage> =>
    httpRequest<PeptidovkaTestsTeacherPage>("/api/biomolecules/peptidovka-tests"),

  /** Student: Peptidovka tests currently open, with this student's attempt status. */
  availablePeptidovkaTests: (): Promise<PeptidovkaTestStudentView[]> =>
    httpRequest<Omit<PeptidovkaTestStudentView, "clockOffsetMs">[]>(
      "/api/biomolecules/available-peptidovka-tests",
    ).then((views) => withClockOffset(views)),

  /** Student: start a Peptidovka test or resume/show an existing attempt. */
  startPeptidovkaTestAttempt: (testId: string): Promise<PeptidovkaTestStartResult> =>
    httpRequest<PeptidovkaTestStartResult>("/api/biomolecules/start-peptidovka-test", { testId }),

  /** Student: submit one Peptidovka attempt (idempotent; the server keeps the first result). */
  submitPeptidovkaTestAttempt: (args: {
    attemptId: string
    totalCount: number
    correctCount: number
    detailJson?: string | null
  }): Promise<void> =>
    httpRequest<void>("/api/biomolecules/submit-peptidovka-test", {
      ...args,
      detailJson: args.detailJson ?? null,
    }),
}

/** One teacher action in the biomolecules module, as logged for the Historie page. */
export interface BiomoleculeHistoryEntry {
  id: string
  userId: string
  username: string
  /** "molecule" | "category" | "topic" | "topics" | "categories" | "peptidovka". */
  kind: string
  /** "create" | "update" | "delete" | "reorder" | "settings". */
  action: string
  label: string
  detail: string | null
  createdAt: string
}
