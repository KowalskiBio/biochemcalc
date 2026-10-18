import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { cs } from "@/i18n/cs"
import {
  type Biomolecule,
  type BiomoleculeCategoryInfo,
  type BiomoleculeData,
  type BiomoleculeTopicInfo,
  type BiomoleculeTraits,
  biomoleculesApi,
  type CategoryField,
  type CategoryMetaField,
  type TopicField,
} from "@/lib/biomolecules-api"

/**
 * The server-backed Biomolekuly library (categories + molecules), shared by
 * every biomolecules page (hub, category, quiz, leaderboard, breadcrumbs).
 * Loaded once per session; every teacher mutation returns the server's fresh
 * full dataset and replaces the local copy atomically.
 */
interface BiomoleculeDataState {
  topics: BiomoleculeTopicInfo[]
  categories: BiomoleculeCategoryInfo[]
  molecules: Biomolecule[]
  status: "idle" | "loading" | "loaded"
  load: () => Promise<void>
  createTopic: (name: string, description?: string) => Promise<BiomoleculeData>
  updateTopicMeta: (topicId: string, field: TopicField, value?: string) => Promise<void>
  deleteTopic: (topicId: string) => Promise<void>
  createCategory: (
    name: string,
    description: string | null,
    topicId?: string,
  ) => Promise<BiomoleculeData>
  updateCategoryMeta: (
    categoryId: string,
    field: CategoryMetaField,
    value?: string | null,
  ) => Promise<void>
  deleteCategory: (categoryId: string) => Promise<void>
  createMolecule: (
    categoryId: string,
    name: string,
    smiles: string,
    traits: BiomoleculeTraits,
  ) => Promise<void>
  updateMolecule: (
    moleculeId: string,
    name: string,
    smiles: string,
    traits: BiomoleculeTraits,
    projection?: string | null,
  ) => Promise<void>
  deleteMolecule: (moleculeId: string) => Promise<void>
}

export const useBiomoleculeDataStore = create<BiomoleculeDataState>((set, get) => ({
  topics: [],
  categories: [],
  molecules: [],
  status: "idle",

  load: async () => {
    if (get().status !== "idle") return
    set({ status: "loading" })
    try {
      const data = await biomoleculesApi.data()
      set({
        topics: data.topics,
        categories: data.categories,
        molecules: data.molecules,
        status: "loaded",
      })
    } catch {
      // The built-in fallback text still works; try again next time.
      set({ status: "idle" })
    }
  },

  createTopic: async (name, description) => {
    const data = await biomoleculesApi.createTopic(name, description)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
    return data
  },

  updateTopicMeta: async (topicId, field, value) => {
    const data = await biomoleculesApi.updateTopicMeta(topicId, field, value)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  deleteTopic: async (topicId) => {
    const data = await biomoleculesApi.deleteTopic(topicId)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  createCategory: async (name, description, topicId) => {
    const data = await biomoleculesApi.createCategory(name, description, topicId)
    set({
      topics: data.topics,
      categories: data.categories,
      molecules: data.molecules,
      status: "loaded",
    })
    return data
  },

  updateCategoryMeta: async (categoryId, field, value) => {
    const data = await biomoleculesApi.updateCategoryMeta(categoryId, field, value)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  deleteCategory: async (categoryId) => {
    const data = await biomoleculesApi.deleteCategory(categoryId)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  createMolecule: async (categoryId, name, smiles, traits) => {
    const data = await biomoleculesApi.createMolecule(categoryId, name, smiles, traits)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  updateMolecule: async (moleculeId, name, smiles, traits, projection) => {
    const data = await biomoleculesApi.updateMolecule(moleculeId, name, smiles, traits, projection)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },

  deleteMolecule: async (moleculeId) => {
    const data = await biomoleculesApi.deleteMolecule(moleculeId)
    set({ topics: data.topics, categories: data.categories, molecules: data.molecules })
  },
}))

const BUILT_IN: Record<string, { name: string; description: string } | undefined> =
  cs.biomolekuly.categories

const BUILT_IN_TOPICS: Record<string, { name: string; description: string } | undefined> =
  cs.biomolekuly.topics

/** The text shipped in cs — the pre-load fallback and the "reset" spelling of built-ins. */
export function builtInCategoryText(categoryId: string, field: CategoryField): string {
  const copy = BUILT_IN[categoryId]
  if (field === "name") return copy?.name ?? categoryId
  if (field === "description") return copy?.description ?? ""
  return ""
}

/** The built-in name — kept for callers that only deal with names. */
export function builtInCategoryName(categoryId: string): string {
  return builtInCategoryText(categoryId, "name")
}

/** The topic text shipped in cs — the pre-load / ungrouped fallback. */
export function builtInTopicText(topicId: string, field: TopicField): string {
  const copy = BUILT_IN_TOPICS[topicId]
  if (field === "name") return copy?.name ?? topicId
  return copy?.description ?? ""
}

/** The built-in topic name. */
export function builtInTopicName(topicId: string): string {
  return builtInTopicText(topicId, "name")
}

function useLoadedData(): BiomoleculeDataState {
  const state = useBiomoleculeDataStore()
  const load = state.load
  useEffect(() => {
    void load()
  }, [load])
  return state
}

/** All categories in hub order (empty until the first load lands). */
export function useMoleculeCategories(): BiomoleculeCategoryInfo[] {
  return useLoadedData().categories
}

/** One category's row, or undefined while loading / for an unknown slug. */
export function useMoleculeCategory(categoryId: string): BiomoleculeCategoryInfo | undefined {
  const { categories } = useLoadedData()
  return categories.find((category) => category.slug === categoryId)
}

/** All topics in hub order (empty until the first load lands). */
export function useMoleculeTopics(): BiomoleculeTopicInfo[] {
  return useLoadedData().topics
}

/** One topic's row, or undefined while loading / for an unknown slug. */
export function useMoleculeTopic(topicSlug: string): BiomoleculeTopicInfo | undefined {
  const { topics } = useLoadedData()
  return topics.find((topic) => topic.slug === topicSlug)
}

/** One category's molecules, in display order. */
export function useCategoryMolecules(categoryId: string): Biomolecule[] {
  const { molecules } = useLoadedData()
  return molecules.filter((molecule) => molecule.categorySlug === categoryId)
}

/** Whether the dataset finished loading at least once this session. */
export function useBiomoleculeDataLoaded(): boolean {
  return useLoadedData().status === "loaded"
}

/**
 * `(categoryId) => display text` for one field, honouring teacher edits.
 * Before the dataset loads it falls back to the cs built-ins (and to the
 * raw slug), matching the old overrides store's contract.
 */
export function useCategoryText(field: CategoryField): (categoryId: string) => string {
  const { categories } = useLoadedData()
  return useCallback(
    (categoryId: string) => {
      const category = categories.find((candidate) => candidate.slug === categoryId)
      const fromData = field === "name" ? category?.name : category?.description
      return fromData || builtInCategoryText(categoryId, field)
    },
    [categories, field],
  )
}

/** `(categoryId) => display name`, honouring teacher renames. */
export function useCategoryNames(): (categoryId: string) => string {
  return useCategoryText("name")
}

/** `(categoryId) => display description`, honouring teacher edits. */
export function useCategoryDescriptions(): (categoryId: string) => string {
  return useCategoryText("description")
}

/**
 * `nameOf` / `descriptionOf` lookups for topics, honouring teacher edits.
 * Built-in slugs fall back to the cs names before the dataset loads (and when
 * a built-in topic is missing from the payload).
 */
export function useTopicText(): {
  nameOf: (topicSlug: string) => string
  descriptionOf: (topicSlug: string) => string
} {
  const { topics } = useLoadedData()

  const nameOf = useCallback(
    (topicSlug: string) => {
      const topic = topics.find((candidate) => candidate.slug === topicSlug)
      return topic?.name || builtInTopicText(topicSlug, "name")
    },
    [topics],
  )

  const descriptionOf = useCallback(
    (topicSlug: string) => {
      const topic = topics.find((candidate) => candidate.slug === topicSlug)
      return topic?.description || builtInTopicText(topicSlug, "description")
    },
    [topics],
  )

  return { nameOf, descriptionOf }
}
