// BioCal TypeScript Types
// Matches the Rust backend model types exactly

// Variable type - can be numeric or string
export type VariableType = "numeric" | "string"

// How a variable's numeric value is displayed
export type Notation = "auto" | "scientific" | "normal"

// Topic model - groups categories under a common heading
export interface Topic {
  id: string
  name: string
  createdAt: string
  forStudents: boolean
  /**
   * The topic doubles as a timed test in the student test generator,
   * independently of `forStudents`: a test-only topic is reachable in tests
   * but not in the endless practice generator.
   */
  isTest: boolean
  /** Which test it is; meaningless while `isTest` is false. */
  testKind: TestOffer
  groupId: string | null
  position: number
}

/**
 * Input for creating/updating a topic
 */
export interface TopicInput {
  name: string
  forStudents?: boolean
  isTest?: boolean
  testKind?: TestOffer
}

/**
 * Which of the two timed tests a student is sitting. They differ only in how
 * many questions each 2/3/4-point band contributes: 5 for the úvodní test, a
 * topic's first (15 in all), and 4 for the recurring průběžný one (12).
 */
export type TestKind = "uvodni" | "prubezny"

/** Which test(s) a topic flagged `isTest` offers — either, or both. */
export type TestOffer = TestKind | "both"

/**
 * TopicGroup model - a teacher-defined bucket ("Skupina") for organizing
 * topics on the topics list page (e.g. by year/semester). Deliberately
 * unrelated to Category ("Kategorie"), the fixed 2/3/4-point bucket nested
 * under a topic.
 */
export interface TopicGroup {
  id: string
  name: string
  position: number
  createdAt: string
}

// Variable model - represents a configurable variable for biochemistry calculations
export interface Variable {
  id: string
  name: string
  symbol: string
  varType: VariableType
  minValue: number
  maxValue: number
  step: number
  unit: string
  precision: number
  stringValues?: string[]
  pairedConstants?: Array<Record<string, number>>
  significantDigits?: number
  notation?: Notation
  createdAt: string
}

// Input for creating/updating a variable
export interface VariableInput {
  name: string
  symbol: string
  varType: VariableType
  minValue: number
  maxValue: number
  step: number
  unit: string
  precision: number
  stringValues?: string[]
  pairedConstants?: Array<Record<string, number>>
  significantDigits?: number
  notation?: Notation
}

/**
 * Databaze entry - maps a placeholder code to a list of possible chemical tokens.
 * Adjacent placeholders concatenate, e.g. [[K]][[A]] can become KCl, NaCl, CsF, ...
 */
export interface DatabazeEntry {
  id: string
  code: string
  values: string[]
  createdAt: string
}

/**
 * Constant model - represents a physical/chemical constant
 */
export interface Constant {
  id: string
  name: string
  symbol: string
  value: number
  unit: string
  isBuiltin: boolean
  formula?: string
  createdAt: string
}

/**
 * Input for creating/updating a constant
 */
export interface ConstantInput {
  name: string
  symbol: string
  value: number
  unit: string
  formula?: string
}

/**
 * Template variable input - links a variable to a template with a placeholder
 */
export interface TemplateVariableInput {
  variableId: string
  placeholder: string
  greaterThanVariableId?: string
  lessThanVariableId?: string
}

/**
 * Template constant input - links a constant to a template
 */
export interface TemplateConstantInput {
  constantId: string
}

/**
 * Constraint type for template results
 */
export type ConstraintType = "range" | "sd" | "both"

/**
 * Constraint input for template results
 */
export interface ConstraintInput {
  minResult?: number
  maxResult?: number
  sdAllowed?: number
  sdNoGo?: number
  constraintType: ConstraintType
}

/**
 * Template mode - determines how the template is used
 */
export type TemplateMode = "closed" | "open"

/**
 * Template model - represents a question template for generating variants.
 * Mode has been moved to Set; Template no longer carries a mode field.
 */
export interface Template {
  id: string
  questionText: string
  formula: string
  equationText: string
  numericAnswer?: number
  resultUnit: string
  pointValue: number
  significantDigits?: number
  forceScientific?: boolean
  /** @deprecated Superseded by the per-template `decoys` list; kept only so a legacy value still round-trips on read. */
  decoyFormula?: string
  /**
   * "Alternace": an optional alternative equation that also evaluates to a
   * correct answer, becoming a second correct closed-mode option.
   */
  alternativeFormula?: string
  /** Significant digits for the alternace option only; undefined inherits `significantDigits`. */
  alternativeSignificantDigits?: number
  createdAt: string
  // Extended with related data
  variables?: TemplateVariableInput[]
  constants?: TemplateConstantInput[]
  /**
   * Form-input convenience only: never populated by the backend's template
   * read model. The persisted constraint arrives on
   * `TemplateWithDetails.constraint` (a sibling of `template`).
   */
  constraint?: ConstraintInput
}

/**
 * One decoy equation attached to a template, with the teacher-requested
 * number of option slots it should claim ("počet"). Actual slots granted at
 * generation time may be lower if requests across all decoys exceed the
 * available budget.
 */
export interface TemplateDecoy {
  id: string
  templateId: string
  formula: string
  optionCount: number
  position: number
  /** Significant digits for this decoy's options only; undefined inherits the template-level setting. */
  significantDigits?: number
}

/**
 * A decoy as submitted by the teacher, before persistence assigns it an id
 * and a position (its index in the submitted list).
 */
export interface TemplateDecoyInput {
  formula: string
  optionCount: number
  significantDigits?: number
}

export interface TemplateWithDetails {
  template: Template
  variables: VariableWithPlaceholder[]
  constants: Constant[]
  constraint?: ConstraintInput
  decoys: TemplateDecoy[]
}

export interface TemplateLocation {
  setId: string
  categoryId: string
  topicId: string
}

export interface VariableWithPlaceholder {
  variable: Variable
  placeholder: string
  isShared: boolean
  greaterThanVariableId?: string
  lessThanVariableId?: string
}

export type VariableMutationAction = "keep" | "create" | "update" | "clone" | "remove"

export interface VariableMutation {
  action: VariableMutationAction
  variableId?: string
  oldVariableId?: string
  placeholder?: string
  variable?: VariableInput
  greaterThanVariableId?: string
  lessThanVariableId?: string
}

export interface UpdateTemplateWithVariablesPayload {
  id: string
  questionText: string
  formula: string
  equationText: string
  numericAnswer?: number
  resultUnit: string
  pointValue: number
  significantDigits?: number
  forceScientific?: boolean
  decoys: TemplateDecoyInput[]
  alternativeFormula?: string
  /** Significant digits for the alternace option only; undefined inherits `significantDigits`. */
  alternativeSignificantDigits?: number
  variableMutations: VariableMutation[]
  constants: TemplateConstantInput[]
  constraint?: ConstraintInput
}

export interface LocalVariableEdit {
  key: string
  variableId: string | null
  placeholder: string
  name: string
  symbol: string
  varType: VariableType
  minValue: number
  maxValue: number
  step: number
  unit: string
  precision: number
  stringValues?: string[]
  pairedConstants?: Array<Record<string, number>>
  significantDigits?: number
  notation?: Notation
  greaterThanVariableId?: string
  lessThanVariableId?: string
  isNew: boolean
  isRemoved: boolean
  isDirty: boolean
  isShared: boolean
}

/**
 * Input for creating/updating a template
 */
export interface TemplateInput {
  questionText: string
  formula: string
  equationText: string
  numericAnswer?: number
  resultUnit: string
  pointValue: number
  significantDigits?: number
  forceScientific?: boolean
  decoys?: TemplateDecoyInput[]
  alternativeFormula?: string
  /** Significant digits for the alternace option only; undefined inherits `significantDigits`. */
  alternativeSignificantDigits?: number
  variables: TemplateVariableInput[]
  constants: TemplateConstantInput[]
  constraint?: ConstraintInput
}

/**
 * Category model - represents a category with specific point value within a topic
 */
export interface Category {
  id: string
  topicId: string
  pointValue: number
  createdAt: string
}

/**
 * Input for creating a category
 */
export interface CategoryInput {
  topicId: string
  pointValue: number
}

/**
 * Set model - represents a set within a category
 */
export interface Set {
  id: string
  categoryId: string
  setIndex: number
  mode: TemplateMode
  name?: string
}

/**
 * Set mode update input
 */
export interface SetModeInput {
  setId: string
  mode: TemplateMode
}

/**
 * Category with its sets (no longer includes templates at this level)
 */
export interface CategoryWithSets {
  category: Category
  sets: Set[]
}

/**
 * Set with its templates and their variables/constants.
 */
export interface SetWithTemplates {
  set: Set
  templates: TemplateWithDetails[]
}

// One answer field inside a multi-answer variant
export interface AnswerField {
  symbol: string
  value: number
  unit?: string
  numericOptions?: number[]
  correctOption?: number
  /** "Alternace" option, also correct alongside `correctOption`. */
  alternateOption?: number
  intervalLo?: number
  intervalHi?: number
  /**
   * Per-option significant-digit overrides, parallel to `numericOptions`:
   * an entry is a number when that option belongs to a decoy (or is the
   * alternace) configured with its own significant digits; null/undefined
   * inherits the template-level setting.
   */
  optionSigDigits?: (number | null)[]
}

// Variant model - represents a generated variant of a template
export interface Variant {
  id: string
  templateId: string
  assignedValues: Record<string, number>
  assignedStrings?: Record<string, string>
  correctAnswer: number
  numericOptions?: number[]
  correctOption?: number
  /** "Alternace" option, also correct alongside `correctOption`. */
  alternateOption?: number
  /**
   * Per-option significant-digit overrides for single-answer templates,
   * parallel to `numericOptions`; see `AnswerField.optionSigDigits`.
   */
  optionSigDigits?: (number | null)[]
  intervalLo?: number
  intervalHi?: number
  seed: number
  createdAt: string
  answersData?: AnswerField[]
}

/**
 * Result from generate_for_templates command
 */
export interface TemplateVariantResult {
  template: Template
  variants: Variant[]
}

/**
 * Question for export - now includes mode
 */
export interface ExportQuestion {
  template: Template
  variant: Variant
  variablePrecisions: Record<string, number>
  variableSignificantDigits?: Record<string, number>
  variableNotations?: Record<string, Notation>
  resultPrecision: number
  resultSignificantDigits?: number
  forceScientific?: boolean
  mode: TemplateMode
}

/**
 * Result from export_to_txt command
 */
export interface ExportResult {
  content: string
  filePath: string
}

/**
 * Export input
 */
export interface ExportInput {
  filename: string
  questions: ExportQuestion[]
}

/**
 * Exported test file metadata.
 */
export interface OutputFile {
  id: string
  filename: string
  filePath: string
  categoryPackageIds: string[]
  status: "draft" | "generating" | "ready" | "exported" | "failed"
  createdAt: string
}

/**
 * Exported test file with its text content.
 */
export interface OutputFileContent {
  file: OutputFile
  content: string
}

/**
 * "very_hard" is an open-question-only tier (a narrower answer tolerance).
 * There is no closed-mode equivalent, so it's never offered in a
 * closed-question difficulty selector even though the type is shared.
 */
export type QuestionDifficulty = "easy" | "medium" | "hard" | "very_hard"

/**
 * Generate input - now includes mode, difficulty and option count
 */
export interface GenerateInput {
  templateIds: string[]
  count: number
  baseSeed: number
  mode: TemplateMode
  difficulty: QuestionDifficulty
  optionCount: number
  /**
   * Optional per-call custom deviation, as a raw percent (e.g. 42 for ±42%).
   * Overrides the difficulty preset for the whole call. Not persisted —
   * only ExportVariantsDialog's per-row export flow sets this.
   */
  customSpreadPercent?: number
}

// Pagination types (for future use)

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Pagination params
 */
export interface PaginationParams {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: "asc" | "desc"
}

// Filter types

/**
 * Variable filter
 */
export interface VariableFilter extends PaginationParams {
  search?: string
  unit?: string
}

/**
 * Constant filter
 */
export interface ConstantFilter extends PaginationParams {
  search?: string
  isBuiltin?: boolean
  unit?: string
}

/**
 * Template filter
 */
export interface TemplateFilter extends PaginationParams {
  search?: string
  pointValue?: number
}

// Form validation types

/**
 * Field validation error
 */
export interface FieldError {
  field: string
  message: string
}

/**
 * Form validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: FieldError[]
}

export interface VictorSettings {
  apiBaseUrl: string
  apiKey: string
}

export interface VictorMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
}

export interface VictorRequest {
  question: string
  history: VictorMessage[]
}

export interface VictorResponse {
  calculation: string
  solution: string
  explanation: string
  variables: Array<{ symbol: string; value: number; unit: string }>
}

export interface VariableHistoryEntry {
  id: string
  variableId: string
  templateId: string
  fieldName: string
  oldValue?: string
  newValue?: string
  changedAt: string
}

export interface TemplateHistoryEntry {
  id: string
  templateId: string
  fieldName: string
  oldValue?: string
  newValue?: string
  changedAt: string
}

export interface HistoryEntry {
  id: string
  templateId: string
  variableId?: string
  fieldName: string
  oldValue?: string
  newValue?: string
  changedAt: string
  kind: "variable" | "template"
}

export interface Projekt {
  id: string
  name: string
  filePath: string
  questionCount: number
  mode: TemplateMode
  topicName?: string
  createdAt: string
  updatedAt: string
}

export interface ProjektQuestion {
  templateId: string
  questionText: string
  resultUnit: string
  pointValue: number
  correctAnswer?: number
  overrideAnswer?: number
  assignedValues: Record<string, unknown>
  assignedStrings?: Record<string, string>
  variablePrecisions: Record<string, number>
  variableSignificantDigits?: Record<string, number>
  variableNotations?: Record<string, Notation>
  resultPrecision: number
  significantDigits?: number
  forceScientific?: boolean
  numericOptions?: number[]
  correctOption?: number
  /** The "alternace" row: a second option that also counts as correct. */
  alternateOption?: number
  /** Per-option significant-digit overrides; see `AnswerField.optionSigDigits`. */
  optionSigDigits?: (number | null)[]
  intervalLo?: number
  intervalHi?: number
  mode: TemplateMode
  seed: number
  answersData?: AnswerField[]
}

export interface ProjektContent {
  projektId: string
  questions: ProjektQuestion[]
}

export interface RegenerateVariantInput {
  templateId: string
  mode: TemplateMode
  seed: number
  manualAnswer?: number
  difficulty: QuestionDifficulty
  optionCount: number
}

export interface SaveProjektInput {
  name: string
  topicName?: string
  mode: TemplateMode
  questions: ProjektQuestion[]
}

export interface UpdateProjektInput {
  projektId: string
  name: string
  topicName?: string
  mode: TemplateMode
  questions: ProjektQuestion[]
}

export interface ExportProjektInput {
  projektId: string
  filename: string
}

// ============================================================================
// Auth
// ============================================================================

export type Role = "teacher" | "student"

export interface User {
  id: string
  username: string
  role: Role
  createdAt: string
  /** The bootstrap admin (or, on older deployments, the earliest-created
   * teacher) — cannot be deleted by anyone, including other teachers. */
  protected: boolean
  /** Set only if the account registered with one. Enables self-service
   * password recovery; an account without one has no recovery path. */
  email: string | null
}

export interface InviteCode {
  code: string
  role: Role
  createdBy: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  /** How many accounts have registered with this code so far. */
  useCount: number
}

export interface LoginInput {
  username: string
  password: string
}

export interface RegisterInput {
  username: string
  password: string
  inviteCode: string
  email?: string
}

export interface CreateInviteCodeInput {
  role: Role
}

export interface ForgotPasswordInput {
  email: string
}

export interface ResetPasswordInput {
  token: string
  newPassword: string
}

// ============================================================================
// Student practice generator
// ============================================================================

/** A topic offered to a student, listing only the difficulties it can serve. */
export interface PracticeTopic {
  id: string
  name: string
  /** The teacher's "Test" flag: the topic doubles as a timed test. */
  isTest: boolean
  difficulties: PracticeDifficulty[]
}

/** A topic offered in the student test generator (teacher-flagged, all bands full). */
export interface TestTopicOption {
  id: string
  name: string
}

export interface PracticeDifficulty {
  /** 2, 3 or 4 — the point value the teacher filed the question under. */
  pointValue: number
  questionCount: number
  /** The individual sets (sada) this difficulty draws from. */
  sets: PracticeSetOption[]
}

/** One set (sada) a student can restrict practice to, alongside "any set". */
export interface PracticeSetOption {
  id: string
  /** The teacher's chosen name, or undefined for the default "Sada {index}" label. */
  name?: string
  setIndex: number
  mode: TemplateMode
  questionCount: number
}

/** A variable and the placeholder it fills; feeds the question renderer. */
export interface PracticeVariable {
  variable: Variable
  placeholder: string
}

/** One blank to fill in. Single-answer questions have exactly one. */
export interface PracticeAnswerSlot {
  /** The target symbol for multi-answer questions, else undefined. */
  symbol?: string
  unit?: string
  /** Closed mode only — the options to pick between, in display order. */
  numericOptions?: number[]
  /**
   * The template's result significant-figures setting. When present, the UI
   * formats the slot's options and its revealed correct answer with that many
   * significant figures instead of precision-based rounding.
   */
  significantDigits?: number
  /**
   * Per-option significant-digit overrides, parallel to `numericOptions`:
   * an entry is a number when that option belongs to a decoy (or is the
   * alternace) configured with its own significant digits; null/undefined
   * inherits `significantDigits`.
   */
  optionSigDigits?: (number | null)[]
}

/**
 * A question ready to answer. Carries no correct answer, correct option or
 * tolerance interval: grading happens on the server against the stored
 * attempt, so the leaderboard means something.
 */
export interface PracticeQuestion {
  attemptId: string
  questionText: string
  pointValue: number
  mode: TemplateMode
  resultUnit: string
  variables: PracticeVariable[]
  assignedValues: Record<string, number>
  assignedStrings: Record<string, string>
  constants: Record<string, number>
  answerSlots: PracticeAnswerSlot[]
  /** The template's own "always scientific" toggle — `false` means the
   * teacher explicitly wants plain decimal (`12300`, not `1.23×10⁴`) for
   * every option and revealed answer, not just a magnitude-based default. */
  forceScientific: boolean
}

export interface PracticeCorrectAnswer {
  symbol?: string
  value: number
  unit?: string
}

export interface PracticeAnswerResult {
  correct: boolean
  pointValue: number
  correctOption?: number
  /** "Alternace" option, also correct alongside `correctOption`. */
  alternateOption?: number
  correctAnswers: PracticeCorrectAnswer[]
}

export interface NextQuestionInput {
  topicId: string
  pointValue: number
  /** Restrict the served question to this mode; omitted mixes both. */
  mode?: TemplateMode
  /** Restrict the served question to this one set (sada); omitted draws from all of them. */
  setId?: string
}

export interface SubmitAnswerInput {
  attemptId: string
  /** Closed mode: the 1-based option picked. */
  selectedOption?: number
  /** Open mode: one value per answer slot, in the order served. */
  answers?: number[]
}

export interface LeaderboardEntry {
  userId: string
  username: string
  correctCount: number
  answeredCount: number
  points: number
}

// ============================================================================
// Test sessions: a fixed batch of questions generated all at once (timed or
// untimed), as opposed to the endless one-at-a-time practice generator above.
// ============================================================================

export interface StartTestInput {
  topicId: string
  /** Which test to sit; the topic must offer it or the server refuses. */
  kind: TestKind
  /** Omitted starts an untimed test: no deadline is ever enforced. */
  timeLimitSeconds?: number
}

export interface TestSessionView {
  sessionId: string
  timeLimitSeconds?: number
  /** ISO 8601 — combine with `timeLimitSeconds` to compute the deadline. */
  startedAt: string
  questions: PracticeQuestion[]
}

export interface FinishTestInput {
  sessionId: string
}

export interface TestResults {
  totalQuestions: number
  answeredCount: number
  correctCount: number
  points: number
  elapsedSeconds: number
}

/** What a student entered for one test question — the in-progress page's local, unsubmitted state. */
export interface TestAnswer {
  selectedOption?: number
  answers?: string[]
}

/**
 * One graded (or skipped) question, built client-side once a test is
 * finished, for the results page's review: the question as served, what the
 * student answered, and — for an answered one — the grading verdict
 * `submitAnswer` already returned during the finish flow.
 */
export interface TestReviewItem {
  question: PracticeQuestion
  answer: TestAnswer
  /** Absent for a question the student left unanswered. */
  result?: PracticeAnswerResult
}

// ============================================================================
// Streak runs: an endless one-question-at-a-time run (like the practice
// generator, but tracked server-side) that ends the instant the student
// answers one wrong. "Apprentice" stays scoped to a topic/point value like
// practice; "master" draws from every topic, at any difficulty.
// ============================================================================

export type StreakRunKind = "apprentice" | "master"

export interface StartStreakRunInput {
  kind: StreakRunKind
  /** Required for "apprentice"; ignored for "master". */
  topicId?: string
  pointValue?: number
  mode?: TemplateMode
  setId?: string
}

export interface StreakRunView {
  runId: string
  kind: StreakRunKind
  startedAt: string
}

export interface NextStreakQuestionInput {
  runId: string
}

export interface StreakRunSummaryInput {
  runId: string
}

export interface StreakRunSummary {
  kind: StreakRunKind
  correctCount: number
  totalSeconds: number
  secondsPerAnswer: number
}

export interface StreakLeaderboardInput {
  kind: StreakRunKind
  /** Scope the board to one topic/difficulty/set — meaningful for "apprentice" only. */
  topicId?: string
  pointValue?: number
  setId?: string
}

export interface StreakLeaderboardEntry {
  userId: string
  username: string
  bestCorrectCount: number
  totalSeconds: number
  secondsPerAnswer: number
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface ReportQuestionInput {
  attemptId: string
  message: string
}

export interface QuestionReportSummary {
  id: string
  studentUsername: string
  topicName: string
  pointValue: number
  message: string
  createdAt: string
}

export interface QuestionReportDetail {
  id: string
  attemptId: string
  templateId: string
  message: string
  createdAt: string
  studentUsername: string
  topicName: string
  pointValue: number
  isCorrect: boolean | null
  location: TemplateLocation | null
  questionText: string
  resultUnit: string
  mode: TemplateMode
  variables: PracticeVariable[]
  assignedValues: Record<string, number>
  assignedStrings: Record<string, string>
  constants: Record<string, number>
  answerSlots: PracticeAnswerSlot[]
  correctAnswers: PracticeCorrectAnswer[]
  correctOption?: number
  /** "Alternace" option, also correct alongside `correctOption`. */
  alternateOption?: number
}
