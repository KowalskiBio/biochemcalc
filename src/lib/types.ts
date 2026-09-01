// Biocal TypeScript Types
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
  groupId: string | null
  position: number
}

/**
 * Input for creating/updating a topic
 */
export interface TopicInput {
  name: string
  forStudents?: boolean
}

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
  /**
   * Per-question difficulty override. null (or absent) means the question
   * inherits the set-wide difficulty preset at generation time.
   */
  difficulty?: QuestionDifficulty | null
  createdAt: string
  // Extended with related data
  variables?: TemplateVariableInput[]
  constants?: TemplateConstantInput[]
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
}

/**
 * A decoy as submitted by the teacher, before persistence assigns it an id
 * and a position (its index in the submitted list).
 */
export interface TemplateDecoyInput {
  formula: string
  optionCount: number
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
  difficulty?: QuestionDifficulty | null
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
  difficulty?: QuestionDifficulty | null
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

export type QuestionDifficulty = "easy" | "medium" | "hard"

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
}

export interface CreateInviteCodeInput {
  role: Role
}

// ============================================================================
// Student practice generator
// ============================================================================

/** A topic offered to a student, listing only the difficulties it can serve. */
export interface PracticeTopic {
  id: string
  name: string
  difficulties: PracticeDifficulty[]
}

export interface PracticeDifficulty {
  /** 2, 3 or 4 — the point value the teacher filed the question under. */
  pointValue: number
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
