import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { cs } from "@/i18n/cs"
import {
  type Biomolecule,
  type BiomoleculeCategoryInfo,
  type BiomoleculeData,
  type BiomoleculeTraits,
  biomoleculesApi,
  type CategoryField,
} from "@/lib/biomolecules-api"

/**
 * The server-backed Biomolekuly library (categories + molecules), shared by
 * every biomolecules page (hub, category, quiz, leaderboard, breadcrumbs).
 * Loaded once per session; every teacher mutation returns the server's fresh
 * full dataset and replaces the local copy atomically.
 */
interface BiomoleculeDataState {
  categories: BiomoleculeCategoryInfo[]
  molecules: Biomolecule[]
  status: "idle" | "loading" | "loaded"
  load: () => Promise<void>
  createCategory: (name: string, description: string | null) => Promise<BiomoleculeData>
  updateCategoryMeta: (
    categoryId: string,
    field: CategoryField,
    value: string | null,
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
  categories: [],
  molecules: [],
  status: "idle",

  load: async () => {
    if (get().status !== "idle") return
    set({ status: "loading" })
    try {
      const data = await biomoleculesApi.data()
      set({ categories: data.categories, molecules: data.molecules, status: "loaded" })
    } catch {
      // The built-in fallback text still works; try again next time.
      set({ status: "idle" })
    }
  },

  createCategory: async (name, description) => {
    const data = await biomoleculesApi.createCategory(name, description)
    set({ categories: data.categories, molecules: data.molecules, status: "loaded" })
    return data
  },

  updateCategoryMeta: async (categoryId, field, value) => {
    const data = await biomoleculesApi.updateCategoryMeta(categoryId, field, value)
    set({ categories: data.categories, molecules: data.molecules })
  },

  deleteCategory: async (categoryId) => {
    const data = await biomoleculesApi.deleteCategory(categoryId)
    set({ categories: data.categories, molecules: data.molecules })
  },

  createMolecule: async (categoryId, name, smiles, traits) => {
    const data = await biomoleculesApi.createMolecule(categoryId, name, smiles, traits)
    set({ categories: data.categories, molecules: data.molecules })
  },

  updateMolecule: async (moleculeId, name, smiles, traits, projection) => {
    const data = await biomoleculesApi.updateMolecule(moleculeId, name, smiles, traits, projection)
    set({ categories: data.categories, molecules: data.molecules })
  },

  deleteMolecule: async (moleculeId) => {
    const data = await biomoleculesApi.deleteMolecule(moleculeId)
    set({ categories: data.categories, molecules: data.molecules })
  },
}))

const BUILT_IN: Record<string, { name: string; description: string } | undefined> =
  cs.biomolekuly.categories

/** The text shipped in cs — the pre-load fallback and the "reset" spelling of built-ins. */
export function builtInCategoryText(categoryId: string, field: CategoryField): string {
  const copy = BUILT_IN[categoryId]
  if (field === "name") return copy?.name ?? categoryId
  return copy?.description ?? ""
}

/** The built-in name — kept for callers that only deal with names. */
export function builtInCategoryName(categoryId: string): string {
  return builtInCategoryText(categoryId, "name")
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
