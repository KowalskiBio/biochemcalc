// BiochemCalc TypeScript Types
// Matches the Rust backend model types exactly

// Variable type - can be numeric or string
export type VariableType = "numeric" | "string"

// Topic model - groups categories under a common heading
export interface Topic {
  id: string
  name: string
  createdAt: string
}

/**
 * Input for creating/updating a topic
 */
export interface TopicInput {
  name: string
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
  createdAt: string
  // Extended with related data
  variables?: TemplateVariableInput[]
  constants?: TemplateConstantInput[]
  constraint?: ConstraintInput
}

export interface TemplateWithDetails {
  template: Template
  variables: VariableWithPlaceholder[]
  constants: Constant[]
  constraint?: ConstraintInput
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
  resultPrecision: number
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
}

// API Response types

/**
 * Success response wrapper
 */
export interface ApiSuccessResponse<T> {
  data: T
  success: true
}

/**
 * Error response wrapper
 */
export interface ApiErrorResponse {
  error: string
  message?: string
  success: false
}

/**
 * Generic API response
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

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
  resultPrecision: number
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
