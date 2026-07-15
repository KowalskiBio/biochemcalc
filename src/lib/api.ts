import { invoke } from "@tauri-apps/api/core"
import type { BulkImportData } from "./bulk-import-parser"
// Import all types from types.ts
import type {
  ApiResponse,
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

// ============================================================================
// API Error Handling
// ============================================================================

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    public readonly message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * Extract a human-readable message from an unknown error value.
 * Tauri invoke errors may be plain objects, strings, or Error instances.
 */
function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback
  }
  if (typeof error === "string" && error.length > 0) {
    return error
  }
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    const message = obj.message || obj.error || obj.msg
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }
  return fallback
}

/**
 * Parse API response and handle errors consistently
 */
function handleApiResponse<T>(response: unknown): T {
  if (response === null || response === undefined) {
    return undefined as T
  }

  if (typeof response === "object") {
    const obj = response as Record<string, unknown>

    // Check for error response
    if (obj.success === false) {
      const errorMessage = (obj.error as string) || (obj.message as string) || "Unknown API error"
      const details = obj.details
      throw new ApiError(errorMessage, obj.error as string, details)
    }

    // Return data from success response
    if (obj.success === true && "data" in obj) {
      return obj.data as T
    }

    // Handle direct response (though our API wraps everything)
    return response as T
  }

  const primitiveType = typeof response
  if (primitiveType === "number" || primitiveType === "string" || primitiveType === "boolean") {
    return response as T
  }

  throw new ApiError("Invalid API response format")
}

// ============================================================================
// Topics API
// ============================================================================

export const topicsApi = {
  /**
   * Create a new topic
   */
  create: async (input: TopicInput): Promise<Topic> => {
    try {
      const response = await invoke<ApiResponse<Topic>>("create_topic", {
        payload: input,
      })
      return handleApiResponse<Topic>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to create topic")
    }
  },

  /**
   * List all topics
   */
  list: async (): Promise<Topic[]> => {
    try {
      const response = await invoke<ApiResponse<Topic[]>>("list_topics")
      return handleApiResponse<Topic[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list topics")
    }
  },

  /**
   * Get a single topic by ID
   */
  get: async (id: string): Promise<Topic> => {
    try {
      const response = await invoke<ApiResponse<Topic>>("get_topic", { id })
      return handleApiResponse<Topic>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to get topic ${id}`)
    }
  },

  /**
   * Update a topic
   */
  update: async (id: string, name: string): Promise<Topic> => {
    try {
      const response = await invoke<ApiResponse<Topic>>("update_topic", {
        payload: { id, name },
      })
      return handleApiResponse<Topic>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to update topic ${id}`)
    }
  },

  /**
   * Delete a topic
   */
  delete: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_topic", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to delete topic ${id}`)
    }
  },

  /**
   * Import templates in bulk from parsed Word-style text.
   */
  importBulk: async (data: BulkImportData): Promise<Topic> => {
    try {
      const response = await invoke<ApiResponse<Topic>>("import_bulk_templates", {
        payload: data,
      })
      return handleApiResponse<Topic>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to import templates")
    }
  },
}

// ============================================================================
// Variable API
// ============================================================================

export const variablesApi = {
  /**
   * Create a new variable
   */
  create: async (input: VariableInput): Promise<Variable> => {
    try {
      const response = await invoke<ApiResponse<Variable>>("create_variable", {
        payload: input,
      })
      return handleApiResponse<Variable>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to create variable")
    }
  },

  /**
   * List all variables
   */
  list: async (): Promise<Variable[]> => {
    try {
      const response = await invoke<ApiResponse<Variable[]>>("list_variables")
      return handleApiResponse<Variable[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list variables")
    }
  },

  /**
   * Get a single variable by ID
   */
  get: async (id: string): Promise<Variable> => {
    try {
      const response = await invoke<ApiResponse<Variable>>("get_variable", { id })
      return handleApiResponse<Variable>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to get variable ${id}`)
    }
  },

  /**
   * Update a variable
   */
  update: async (id: string, input: Partial<VariableInput>): Promise<Variable> => {
    try {
      const response = await invoke<ApiResponse<Variable>>("update_variable", {
        payload: { id, ...input },
      })
      return handleApiResponse<Variable>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to update variable ${id}`)
    }
  },

  /**
   * Delete a variable
   */
  delete: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_variable", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to delete variable ${id}`)
    }
  },

  /**
   * List variable history entries for a specific template
   */
  listHistoryByTemplate: async (
    templateId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<VariableHistoryEntry[]> => {
    try {
      const response = await invoke<ApiResponse<VariableHistoryEntry[]>>(
        "list_variable_history_by_template",
        {
          templateId,
          limit,
          offset,
        },
      )
      return handleApiResponse<VariableHistoryEntry[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error
          ? error.message
          : `Failed to list variable history for template ${templateId}`,
      )
    }
  },

  /**
   * List all variable history entries
   */
  listAllHistory: async (
    limit: number = 50,
    offset: number = 0,
  ): Promise<VariableHistoryEntry[]> => {
    try {
      const response = await invoke<ApiResponse<VariableHistoryEntry[]>>(
        "list_all_variable_history",
        {
          limit,
          offset,
        },
      )
      return handleApiResponse<VariableHistoryEntry[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to list all variable history",
      )
    }
  },

  /**
   * List template field history entries for a specific template
   */
  listTemplateHistoryByTemplate: async (
    templateId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<TemplateHistoryEntry[]> => {
    try {
      const response = await invoke<ApiResponse<TemplateHistoryEntry[]>>(
        "list_template_history_by_template",
        {
          templateId,
          limit,
          offset,
        },
      )
      return handleApiResponse<TemplateHistoryEntry[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error
          ? error.message
          : `Failed to list template history for template ${templateId}`,
      )
    }
  },

  /**
   * List all template field history entries
   */
  listAllTemplateHistory: async (
    limit: number = 50,
    offset: number = 0,
  ): Promise<TemplateHistoryEntry[]> => {
    try {
      const response = await invoke<ApiResponse<TemplateHistoryEntry[]>>(
        "list_all_template_history",
        {
          limit,
          offset,
        },
      )
      return handleApiResponse<TemplateHistoryEntry[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to list all template history",
      )
    }
  },
}

// ============================================================================
// Constants API
// ============================================================================

export const constantsApi = {
  /**
   * Create a new constant
   */
  create: async (input: ConstantInput): Promise<Constant> => {
    try {
      const response = await invoke<ApiResponse<Constant>>("create_constant", {
        payload: { ...input, isBuiltin: false },
      })
      return handleApiResponse<Constant>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to create constant")
    }
  },

  /**
   * List all constants (including built-ins)
   */
  list: async (): Promise<Constant[]> => {
    try {
      const response = await invoke<ApiResponse<Constant[]>>("list_constants")
      return handleApiResponse<Constant[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list constants")
    }
  },

  /**
   * Get a single constant by ID
   */
  get: async (id: string): Promise<Constant> => {
    try {
      const response = await invoke<ApiResponse<Constant>>("get_constant", { id })
      return handleApiResponse<Constant>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to get constant ${id}`)
    }
  },

  /**
   * Update a constant (only for custom constants)
   */
  update: async (id: string, input: Partial<ConstantInput>): Promise<Constant> => {
    try {
      const response = await invoke<ApiResponse<Constant>>("update_constant", {
        payload: { id, ...input },
      })
      return handleApiResponse<Constant>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to update constant ${id}`)
    }
  },

  /**
   * Delete a constant (only for custom constants)
   */
  delete: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_constant", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to delete constant ${id}`)
    }
  },
}

// ============================================================================
// Templates API
// ============================================================================

export const templatesApi = {
  /**
   * Create a new template
   */
  create: async (input: TemplateInput): Promise<Template> => {
    try {
      const response = await invoke<ApiResponse<Template>>("create_template", {
        payload: input,
      })
      return handleApiResponse<Template>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to create template")
    }
  },

  /**
   * List all templates
   */
  list: async (): Promise<Template[]> => {
    try {
      const response = await invoke<ApiResponse<Template[]>>("list_templates")
      return handleApiResponse<Template[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list templates")
    }
  },

  /**
   * Get a single template by ID
   */
  get: async (id: string): Promise<Template> => {
    try {
      const response = await invoke<ApiResponse<Template>>("get_template", { id })
      return handleApiResponse<Template>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to get template ${id}`)
    }
  },

  /**
   * Get a template with its variables, constants, and constraint
   */
  getWithDetails: async (id: string): Promise<TemplateWithDetails> => {
    try {
      const response = await invoke<ApiResponse<TemplateWithDetails>>("get_template_with_details", {
        id,
      })
      return handleApiResponse<TemplateWithDetails>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to get template ${id} with details`,
      )
    }
  },

  /**
   * Get the set/category/topic location of a template.
   */
  getLocation: async (id: string): Promise<TemplateLocation | null> => {
    try {
      const response = await invoke<ApiResponse<TemplateLocation | null>>("get_template_location", {
        id,
      })
      return handleApiResponse<TemplateLocation | null>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to get location for ${id}`,
      )
    }
  },

  /**
   * Update a template
   */
  update: async (id: string, input: Partial<TemplateInput>): Promise<Template> => {
    try {
      const response = await invoke<ApiResponse<Template>>("update_template", {
        payload: { id, ...input },
      })
      return handleApiResponse<Template>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to update template ${id}`)
    }
  },

  /**
   * Update a template together with its variables in one atomic operation.
   */
  updateWithVariables: async (
    payload: UpdateTemplateWithVariablesPayload,
  ): Promise<TemplateWithDetails> => {
    try {
      const response = await invoke<ApiResponse<TemplateWithDetails>>(
        "update_template_with_variables",
        { payload },
      )
      return handleApiResponse<TemplateWithDetails>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : `Failed to update template ${payload.id}`
      throw new ApiError(message, undefined, error)
    }
  },

  /**
   * Update formula/equationText for all templates sharing the same equation text.
   */
  updateByEquation: async (payload: {
    oldEquationText: string
    newFormula: string
    newEquationText: string
    newResultUnit: string
  }): Promise<number> => {
    try {
      const response = await invoke<ApiResponse<number>>("update_templates_by_equation", {
        payload,
      })
      return handleApiResponse<number>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to update templates by equation",
      )
    }
  },

  /**
   * Delete a template
   */
  delete: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_template", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to delete template ${id}`)
    }
  },
}

// ============================================================================
// Categories API
// ============================================================================

export const categoriesApi = {
  /**
   * Create a new category (2, 3, or 4 points)
   */
  create: async (input: CategoryInput): Promise<Category> => {
    // Validate point value
    if (![2, 3, 4].includes(input.pointValue)) {
      throw new ApiError("Category must be 2, 3, or 4 points", "INVALID_POINT_VALUE")
    }

    try {
      const response = await invoke<ApiResponse<Category>>("create_category", {
        payload: input,
      })
      return handleApiResponse<Category>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to create category")
    }
  },

  /**
   * List all categories
   */
  list: async (): Promise<Category[]> => {
    try {
      const response = await invoke<ApiResponse<Category[]>>("list_categories")
      return handleApiResponse<Category[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list categories")
    }
  },

  /**
   * List categories by topic ID
   */
  listByTopic: async (topicId: string): Promise<Category[]> => {
    try {
      const response = await invoke<ApiResponse<Category[]>>("list_categories_by_topic", {
        topicId,
      })
      return handleApiResponse<Category[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to list categories for topic ${topicId}`,
      )
    }
  },

  /**
   * Get a category with its sets
   */
  getWithSets: async (id: string): Promise<CategoryWithSets> => {
    try {
      const response = await invoke<ApiResponse<[Category, SetModel[]]>>("get_category_with_sets", {
        id,
      })
      const data = handleApiResponse<[Category, SetModel[]]>(response)
      return { category: data[0], sets: data[1] }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to get category ${id} with sets`,
      )
    }
  },

  /**
   * Get a single category by ID
   */
  get: async (id: string): Promise<Category> => {
    try {
      const response = await invoke<ApiResponse<Category>>("get_category", { id })
      return handleApiResponse<Category>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to get category ${id}`)
    }
  },

  /**
   * Delete a category
   */
  delete: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_category", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : `Failed to delete category ${id}`)
    }
  },
}

// ============================================================================
// Sets API
// ============================================================================

export const setsApi = {
  /**
   * Add a template to a set
   */
  addTemplate: async (setId: string, templateId: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("add_template_to_set", {
        payload: { setId, templateId },
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to add template to set")
    }
  },

  /**
   * Remove a template from a set
   */
  removeTemplate: async (setId: string, templateId: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("remove_template_from_set", {
        payload: { setId, templateId },
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to remove template from set",
      )
    }
  },

  /**
   * Reorder templates within a set
   */
  reorderTemplates: async (setId: string, templateIds: string[]): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("reorder_templates_in_set", {
        payload: { setId, templateIds },
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to reorder templates in set",
      )
    }
  },

  /**
   * Update the mode of a set
   */
  updateMode: async (input: SetModeInput): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("update_set_mode", {
        payload: input,
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to update set mode")
    }
  },

  /**
   * Get a set with its templates
   */
  getWithTemplates: async (setId: string): Promise<SetWithTemplates> => {
    try {
      const response = await invoke<ApiResponse<[SetModel, TemplateWithDetails[]]>>(
        "get_set_with_templates",
        {
          setId,
        },
      )
      const data = handleApiResponse<[SetModel, TemplateWithDetails[]]>(response)
      return { set: data[0], templates: data[1] }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to get set ${setId} with templates`,
      )
    }
  },
}

// ============================================================================
// Generation API
// ============================================================================

export const generationApi = {
  /**
   * Generate variants for a set of templates
   */
  generateForTemplates: async (input: GenerateInput): Promise<TemplateVariantResult[]> => {
    try {
      const response = await invoke<ApiResponse<TemplateVariantResult[]>>(
        "generate_for_templates",
        { payload: input },
      )
      return handleApiResponse<TemplateVariantResult[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(extractErrorMessage(error, "Failed to generate variants"))
    }
  },

  /**
   * Export generated questions to a text file
   */
  exportToTxt: async (input: ExportInput): Promise<ExportResult> => {
    try {
      const response = await invoke<ApiResponse<ExportResult>>("export_to_txt", {
        payload: input,
      })
      return handleApiResponse<ExportResult>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to export to text file")
    }
  },

  /**
   * List all exported test files.
   */
  listOutputFiles: async (): Promise<OutputFile[]> => {
    try {
      const response = await invoke<ApiResponse<OutputFile[]>>("list_output_files")
      return handleApiResponse<OutputFile[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(extractErrorMessage(error, "Failed to list output files"))
    }
  },

  /**
   * Read an exported test file's content.
   */
  readOutputFile: async (id: string): Promise<OutputFileContent> => {
    try {
      const response = await invoke<ApiResponse<OutputFileContent>>("read_output_file", { id })
      return handleApiResponse<OutputFileContent>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(extractErrorMessage(error, "Failed to read output file"))
    }
  },

  /**
   * Delete an exported test file.
   */
  deleteOutputFile: async (id: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_output_file", { id })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(extractErrorMessage(error, "Failed to delete output file"))
    }
  },

  /**
   * Regenerate a variant for a template
   */
  regenerateVariant: async (input: RegenerateVariantInput): Promise<Variant> => {
    try {
      const response = await invoke<ApiResponse<Variant>>("regenerate_variant", {
        payload: input,
      })
      return handleApiResponse<Variant>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(extractErrorMessage(error, "Failed to regenerate variant"))
    }
  },
}

// ============================================================================
// Victor API
// ============================================================================

export const victorApi = {
  /**
   * Get Victor settings
   */
  getSettings: async (): Promise<VictorSettings> => {
    try {
      const response = await invoke<ApiResponse<VictorSettings>>("get_victor_settings")
      return handleApiResponse<VictorSettings>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to get Victor settings")
    }
  },

  /**
   * Set Victor settings
   */
  setSettings: async (input: VictorSettings): Promise<VictorSettings> => {
    try {
      const response = await invoke<ApiResponse<VictorSettings>>("set_victor_settings", {
        payload: input,
      })
      return handleApiResponse<VictorSettings>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to set Victor settings")
    }
  },

  /**
   * Chat with Victor
   */
  chat: async (request: VictorRequest): Promise<VictorResponse> => {
    try {
      const response = await invoke<ApiResponse<VictorResponse>>("chat_with_victor", {
        payload: request,
      })
      return handleApiResponse<VictorResponse>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to chat with Victor")
    }
  },
}

// ============================================================================
// Projekty API
// ============================================================================

export const projektyApi = {
  save: async (input: SaveProjektInput): Promise<Projekt> => {
    try {
      const response = await invoke<ApiResponse<Projekt>>("save_projekt", {
        payload: input,
      })
      return handleApiResponse<Projekt>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to save projekt")
    }
  },

  load: async (projektId: string): Promise<ProjektContent> => {
    try {
      const response = await invoke<ApiResponse<ProjektContent>>("load_projekt", {
        payload: { projektId },
      })
      return handleApiResponse<ProjektContent>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to load projekt ${projektId}`,
      )
    }
  },

  list: async (): Promise<Projekt[]> => {
    try {
      const response = await invoke<ApiResponse<Projekt[]>>("list_projekty")
      return handleApiResponse<Projekt[]>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to list projekty")
    }
  },

  delete: async (projektId: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("delete_projekt", {
        payload: { projektId },
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : `Failed to delete projekt ${projektId}`,
      )
    }
  },

  update: async (payload: UpdateProjektInput): Promise<Projekt> => {
    try {
      const response = await invoke<ApiResponse<Projekt>>("update_projekt", {
        payload,
      })
      return handleApiResponse<Projekt>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to update projekt")
    }
  },

  exportToTxt: async (input: ExportProjektInput): Promise<ExportResult> => {
    try {
      const response = await invoke<ApiResponse<ExportResult>>("export_projekt_to_txt", {
        payload: input,
      })
      return handleApiResponse<ExportResult>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error ? error.message : "Failed to export projekt to text",
      )
    }
  },
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

  clearByTemplate: async (templateId: string): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("clear_template_history", {
        payload: { templateId },
      })
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        error instanceof Error
          ? error.message
          : `Failed to clear history for template ${templateId}`,
      )
    }
  },

  clearAll: async (): Promise<void> => {
    try {
      const response = await invoke<ApiResponse<void>>("clear_all_history")
      return handleApiResponse<void>(response)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : "Failed to clear all history")
    }
  },
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
