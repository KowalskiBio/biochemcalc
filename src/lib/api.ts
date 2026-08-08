import type { BulkImportData } from "./bulk-import-parser"
import { ApiError, extractErrorMessage, httpRequest } from "./http"
// Import all types from types.ts
import type {
  Category,
  CategoryInput,
  CategoryWithSets,
  Constant,
  ConstantInput,
  ExportInput,
  ExportProjektInput,
  ExportResult,
  GenerateInput,
  HistoryEntry,
  OutputFile,
  OutputFileContent,
  Projekt,
  ProjektContent,
  RegenerateVariantInput,
  SaveProjektInput,
  SetModeInput,
  Set as SetModel,
  SetWithTemplates,
  Template,
  TemplateHistoryEntry,
  TemplateInput,
  TemplateLocation,
  TemplateVariantResult,
  TemplateWithDetails,
  Topic,
  TopicInput,
  UpdateProjektInput,
  UpdateTemplateWithVariablesPayload,
  Variable,
  VariableHistoryEntry,
  VariableInput,
  Variant,
  VictorRequest,
  VictorResponse,
  VictorSettings,
} from "./types"

// Re-exported so existing call sites (`import { ApiError } from "@/lib/api"`)
// don't need to change — the underlying HTTP client moved to `./http`.
export { ApiError, extractErrorMessage }

// ============================================================================
// Low-level command dispatch
// ============================================================================

/**
 * POST to `/api/cmd/<command>` — the teacher-only surface that mirrors every
 * command the desktop app's Tauri IPC bridge used to expose. `body` is sent
 * as-is as the JSON request body (no `{payload: ...}` wrapper).
 */
function apiFetch<T>(command: string, body?: unknown): Promise<T> {
  return httpRequest<T>(`/api/cmd/${command}`, body)
}

// ============================================================================
// Topics API
// ============================================================================

export const topicsApi = {
  create: (input: TopicInput): Promise<Topic> => apiFetch<Topic>("create_topic", input),

  list: (): Promise<Topic[]> => apiFetch<Topic[]>("list_topics"),

  get: (id: string): Promise<Topic> => apiFetch<Topic>("get_topic", { id }),

  update: (id: string, name: string, forStudents: boolean): Promise<Topic> =>
    apiFetch<Topic>("update_topic", { id, name, forStudents }),

  delete: (id: string): Promise<void> => apiFetch<void>("delete_topic", { id }),

  /**
   * Import templates in bulk from parsed Word-style text.
   */
  importBulk: (data: BulkImportData): Promise<Topic> =>
    apiFetch<Topic>("import_bulk_templates", data),
}

// ============================================================================
// Variable API
// ============================================================================

export const variablesApi = {
  create: (input: VariableInput): Promise<Variable> =>
    apiFetch<Variable>("create_variable", input),

  list: (): Promise<Variable[]> => apiFetch<Variable[]>("list_variables"),

  get: (id: string): Promise<Variable> => apiFetch<Variable>("get_variable", { id }),

  update: (id: string, input: Partial<VariableInput>): Promise<Variable> =>
    apiFetch<Variable>("update_variable", { id, ...input }),

  delete: (id: string): Promise<void> => apiFetch<void>("delete_variable", { id }),

  /**
   * List variable history entries for a specific template
   */
  listHistoryByTemplate: (
    templateId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<VariableHistoryEntry[]> =>
    apiFetch<VariableHistoryEntry[]>("list_variable_history_by_template", {
      templateId,
      limit,
      offset,
    }),

  /**
   * List all variable history entries
   */
  listAllHistory: (limit: number = 50, offset: number = 0): Promise<VariableHistoryEntry[]> =>
    apiFetch<VariableHistoryEntry[]>("list_all_variable_history", { limit, offset }),

  /**
   * List template field history entries for a specific template
   */
  listTemplateHistoryByTemplate: (
    templateId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<TemplateHistoryEntry[]> =>
    apiFetch<TemplateHistoryEntry[]>("list_template_history_by_template", {
      templateId,
      limit,
      offset,
    }),

  /**
   * List all template field history entries
   */
  listAllTemplateHistory: (limit: number = 50, offset: number = 0): Promise<TemplateHistoryEntry[]> =>
    apiFetch<TemplateHistoryEntry[]>("list_all_template_history", { limit, offset }),
}

// ============================================================================
// Constants API
// ============================================================================

export const constantsApi = {
  create: (input: ConstantInput): Promise<Constant> =>
    apiFetch<Constant>("create_constant", { ...input, isBuiltin: false }),

  /**
   * List all constants (including built-ins)
   */
  list: (): Promise<Constant[]> => apiFetch<Constant[]>("list_constants"),

  get: (id: string): Promise<Constant> => apiFetch<Constant>("get_constant", { id }),

  /**
   * Update a constant (only for custom constants)
   */
  update: (id: string, input: Partial<ConstantInput>): Promise<Constant> =>
    apiFetch<Constant>("update_constant", { id, ...input }),

  /**
   * Delete a constant (only for custom constants)
   */
  delete: (id: string): Promise<void> => apiFetch<void>("delete_constant", { id }),
}

// ============================================================================
// Templates API
// ============================================================================

export const templatesApi = {
  create: (input: TemplateInput): Promise<Template> =>
    apiFetch<Template>("create_template", input),

  list: (): Promise<Template[]> => apiFetch<Template[]>("list_templates"),

  get: (id: string): Promise<Template> => apiFetch<Template>("get_template", { id }),

  /**
   * Get a template with its variables, constants, and constraint
   */
  getWithDetails: (id: string): Promise<TemplateWithDetails> =>
    apiFetch<TemplateWithDetails>("get_template_with_details", { id }),

  /**
   * Get the set/category/topic location of a template.
   */
  getLocation: (id: string): Promise<TemplateLocation | null> =>
    apiFetch<TemplateLocation | null>("get_template_location", { id }),

  update: (id: string, input: Partial<TemplateInput>): Promise<Template> =>
    apiFetch<Template>("update_template", { id, ...input }),

  /**
   * Update a template together with its variables in one atomic operation.
   */
  updateWithVariables: (
    payload: UpdateTemplateWithVariablesPayload,
  ): Promise<TemplateWithDetails> =>
    apiFetch<TemplateWithDetails>("update_template_with_variables", payload),

  /**
   * Update formula/equationText for all templates sharing the same equation text.
   */
  updateByEquation: (payload: {
    oldEquationText: string
    newFormula: string
    newEquationText: string
    newResultUnit: string
  }): Promise<number> => apiFetch<number>("update_templates_by_equation", payload),

  delete: (id: string): Promise<void> => apiFetch<void>("delete_template", { id }),
}

// ============================================================================
// Categories API
// ============================================================================

export const categoriesApi = {
  /**
   * Create a new category (2, 3, or 4 points)
   */
  create: (input: CategoryInput): Promise<Category> => {
    if (![2, 3, 4].includes(input.pointValue)) {
      throw new ApiError("Category must be 2, 3, or 4 points", "INVALID_POINT_VALUE")
    }
    return apiFetch<Category>("create_category", input)
  },

  list: (): Promise<Category[]> => apiFetch<Category[]>("list_categories"),

  listByTopic: (topicId: string): Promise<Category[]> =>
    apiFetch<Category[]>("list_categories_by_topic", { topicId }),

  /**
   * Get a category with its sets
   */
  getWithSets: async (id: string): Promise<CategoryWithSets> => {
    const [category, sets] = await apiFetch<[Category, SetModel[]]>("get_category_with_sets", {
      id,
    })
    return { category, sets }
  },

  get: (id: string): Promise<Category> => apiFetch<Category>("get_category", { id }),

  delete: (id: string): Promise<void> => apiFetch<void>("delete_category", { id }),
}

// ============================================================================
// Sets API
// ============================================================================

export const setsApi = {
  addTemplate: (setId: string, templateId: string): Promise<void> =>
    apiFetch<void>("add_template_to_set", { setId, templateId }),

  removeTemplate: (setId: string, templateId: string): Promise<void> =>
    apiFetch<void>("remove_template_from_set", { setId, templateId }),

  reorderTemplates: (setId: string, templateIds: string[]): Promise<void> =>
    apiFetch<void>("reorder_templates_in_set", { setId, templateIds }),

  updateMode: (input: SetModeInput): Promise<void> => apiFetch<void>("update_set_mode", input),

  /**
   * Get a set with its templates
   */
  getWithTemplates: async (setId: string): Promise<SetWithTemplates> => {
    const [set, templates] = await apiFetch<[SetModel, TemplateWithDetails[]]>(
      "get_set_with_templates",
      { setId },
    )
    return { set, templates }
  },
}

// ============================================================================
// Generation API
// ============================================================================

export const generationApi = {
  generateForTemplates: (input: GenerateInput): Promise<TemplateVariantResult[]> =>
    apiFetch<TemplateVariantResult[]>("generate_for_templates", input),

  exportToTxt: (input: ExportInput): Promise<ExportResult> =>
    apiFetch<ExportResult>("export_to_txt", input),

  /**
   * List all exported test files.
   */
  listOutputFiles: (): Promise<OutputFile[]> => apiFetch<OutputFile[]>("list_output_files"),

  /**
   * Read an exported test file's content.
   */
  readOutputFile: (id: string): Promise<OutputFileContent> =>
    apiFetch<OutputFileContent>("read_output_file", { id }),

  /**
   * Delete an exported test file.
   */
  deleteOutputFile: (id: string): Promise<void> => apiFetch<void>("delete_output_file", { id }),

  regenerateVariant: (input: RegenerateVariantInput): Promise<Variant> =>
    apiFetch<Variant>("regenerate_variant", input),
}

// ============================================================================
// Victor API
// ============================================================================

export const victorApi = {
  getSettings: (): Promise<VictorSettings> => apiFetch<VictorSettings>("get_victor_settings"),

  setSettings: (input: VictorSettings): Promise<VictorSettings> =>
    apiFetch<VictorSettings>("set_victor_settings", input),

  chat: (request: VictorRequest): Promise<VictorResponse> =>
    apiFetch<VictorResponse>("chat_with_victor", request),
}

// ============================================================================
// Projekty API
// ============================================================================

export const projektyApi = {
  save: (input: SaveProjektInput): Promise<Projekt> => apiFetch<Projekt>("save_projekt", input),

  load: (projektId: string): Promise<ProjektContent> =>
    apiFetch<ProjektContent>("load_projekt", { projektId }),

  list: (): Promise<Projekt[]> => apiFetch<Projekt[]>("list_projekty"),

  delete: (projektId: string): Promise<void> => apiFetch<void>("delete_projekt", { projektId }),

  update: (payload: UpdateProjektInput): Promise<Projekt> =>
    apiFetch<Projekt>("update_projekt", payload),

  exportToTxt: (input: ExportProjektInput): Promise<ExportResult> =>
    apiFetch<ExportResult>("export_projekt_to_txt", input),
}

function toHistoryEntry(entry: VariableHistoryEntry): HistoryEntry {
  return {
    id: entry.id,
    templateId: entry.templateId,
    variableId: entry.variableId,
    fieldName: entry.fieldName,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    changedAt: entry.changedAt,
    kind: "variable",
  }
}

function toTemplateHistoryEntry(entry: TemplateHistoryEntry): HistoryEntry {
  return {
    id: entry.id,
    templateId: entry.templateId,
    fieldName: entry.fieldName,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    changedAt: entry.changedAt,
    kind: "template",
  }
}

export const historyApi = {
  listByTemplate: async (
    templateId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<HistoryEntry[]> => {
    const [variableEntries, templateEntries] = await Promise.all([
      variablesApi.listHistoryByTemplate(templateId, limit, offset),
      variablesApi.listTemplateHistoryByTemplate(templateId, limit, offset),
    ])
    return [
      ...variableEntries.map(toHistoryEntry),
      ...templateEntries.map(toTemplateHistoryEntry),
    ].sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
  },

  listAll: async (limit: number = 50, offset: number = 0): Promise<HistoryEntry[]> => {
    const [variableEntries, templateEntries] = await Promise.all([
      variablesApi.listAllHistory(limit, offset),
      variablesApi.listAllTemplateHistory(limit, offset),
    ])
    return [
      ...variableEntries.map(toHistoryEntry),
      ...templateEntries.map(toTemplateHistoryEntry),
    ].sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
  },

  clearByTemplate: (templateId: string): Promise<void> =>
    apiFetch<void>("clear_template_history", { templateId }),

  clearAll: (): Promise<void> => apiFetch<void>("clear_all_history"),
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Validate template input before creation/update
 */
export function validateTemplateInput(input: Partial<TemplateInput>): string[] {
  const errors: string[] = []

  if (input.questionText !== undefined && input.questionText.trim().length === 0) {
    errors.push("Question text is required")
  }

  if (input.formula !== undefined && input.formula.trim().length === 0) {
    errors.push("Formula is required")
  }

  if (input.resultUnit !== undefined && input.resultUnit.trim().length === 0) {
    errors.push("Result unit is required")
  }

  if (input.pointValue !== undefined && ![2, 3, 4].includes(input.pointValue)) {
    errors.push("Point value must be 2, 3, or 4")
  }

  return errors
}

/**
 * Validate variable input before creation/update
 */
export function validateVariableInput(input: Partial<VariableInput>): string[] {
  const errors: string[] = []

  if (input.name !== undefined && input.name.trim().length === 0) {
    errors.push("Name is required")
  }

  if (input.symbol !== undefined && input.symbol.trim().length === 0) {
    errors.push("Symbol is required")
  }

  if (input.minValue !== undefined && input.maxValue !== undefined) {
    if (input.minValue > input.maxValue) {
      errors.push("Minimum value cannot be greater than maximum value")
    }
  }

  if (input.step !== undefined && input.step <= 0) {
    errors.push("Step must be greater than zero")
  }

  if (input.precision !== undefined && input.precision < 0) {
    errors.push("Precision cannot be negative")
  }

  return errors
}

/**
 * Validate constant input before creation/update
 */
export function validateConstantInput(input: Partial<ConstantInput>): string[] {
  const errors: string[] = []

  if (input.name !== undefined && input.name.trim().length === 0) {
    errors.push("Name is required")
  }

  if (input.symbol !== undefined && input.symbol.trim().length === 0) {
    errors.push("Symbol is required")
  }

  if (input.value !== undefined && Number.isNaN(input.value)) {
    errors.push("Value must be a valid number")
  }

  return errors
}
