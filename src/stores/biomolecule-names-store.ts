import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { cs } from "@/i18n/cs"
import { biomoleculesApi, type CategoryField, type CategoryOverrides } from "@/lib/biomolecules-api"

/**
 * Teacher-edited Biomolekuly category text (name and description), shared by
 * every page that shows it (hub, category page, quiz, leaderboard,
 * breadcrumbs). Loaded once per session; an edit replaces the whole map with
 * the server's answer.
 */
interface BiomoleculeNamesState {
  overrides: CategoryOverrides
  status: "idle" | "loading" | "loaded"
  load: () => Promise<void>
  update: (categoryId: string, field: CategoryField, value: string | null) => Promise<void>
}

export const useBiomoleculeNamesStore = create<BiomoleculeNamesState>((set, get) => ({
  overrides: {},
  status: "idle",

  load: async () => {
    if (get().status !== "idle") return
    set({ status: "loading" })
    try {
      set({ overrides: await biomoleculesApi.categoryOverrides(), status: "loaded" })
    } catch {
      // Built-in text still works; try again next time something asks.
      set({ status: "idle" })
    }
  },

  update: async (categoryId, field, value) => {
    const overrides = await biomoleculesApi.updateCategory(categoryId, field, value)
    set({ overrides, status: "loaded" })
  },
}))

const BUILT_IN: Record<string, { name: string; description: string } | undefined> =
  cs.biomolekuly.categories

/** The text shipped in cs (name falls back to the slug if cs is behind the data). */
export function builtInCategoryText(categoryId: string, field: CategoryField): string {
  const copy = BUILT_IN[categoryId]
  if (field === "name") return copy?.name ?? categoryId
  return copy?.description ?? ""
}

/** The built-in name — kept for callers that only deal with names. */
export function builtInCategoryName(categoryId: string): string {
  return builtInCategoryText(categoryId, "name")
}

/**
 * `(categoryId) => display text` for one field, honouring teacher edits.
 * Triggers the one-time load of the overrides. Stable until the overrides
 * change, so callers can list it as a dependency.
 */
export function useCategoryText(field: CategoryField): (categoryId: string) => string {
  const overrides = useBiomoleculeNamesStore((s) => s.overrides)
  const load = useBiomoleculeNamesStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  return useCallback(
    (categoryId: string) =>
      overrides[categoryId]?.[field] ?? builtInCategoryText(categoryId, field),
    [overrides, field],
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
