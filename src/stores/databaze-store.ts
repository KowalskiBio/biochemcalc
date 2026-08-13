import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DatabazeEntry } from "@/lib/types"
import { generateId } from "@/lib/utils"

interface DatabazeState {
  entries: DatabazeEntry[]

  addEntry: (entry: Omit<DatabazeEntry, "id" | "createdAt">) => void
  updateEntry: (id: string, updates: Partial<Omit<DatabazeEntry, "id" | "createdAt">>) => void
  deleteEntry: (id: string) => void
  resetToDefaults: () => void
}

export const defaultDatabazeEntries: DatabazeEntry[] = [
  {
    id: "k-monovalent",
    code: "K",
    values: ["Li", "Na", "K", "Rb", "Cs", "Ag"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "a-monovalent",
    code: "A",
    values: ["F", "Cl", "Br", "I", "NO3", "CH3COO"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "k-divalent",
    code: "KK",
    values: ["Mg", "Ca", "Sr", "Ba", "Zn", "Cu"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "a-divalent",
    code: "AA",
    values: ["O", "S", "SO4", "CO3"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "sk-salt-k",
    code: "sK",
    values: ["Li", "Na", "K", "Rb", "Cs"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "sa-salt-a",
    code: "sA",
    values: ["F", "Cl", "Br", "I"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "skk-salt-kk",
    code: "sKK",
    values: ["Mg", "Ca", "Sr", "Ba"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "saa-salt-aa",
    code: "sAA",
    values: ["O", "S", "SO4"],
    createdAt: new Date().toISOString(),
  },
  {
    id: "molecule",
    code: "molekula",
    values: ["glukóza", "sacharóza", "DNA", "RNA", "glycin"],
    createdAt: new Date().toISOString(),
  },
]

export const useDatabazeStore = create<DatabazeState>()(
  persist(
    (set) => ({
      entries: defaultDatabazeEntries,

      addEntry: (entry) => {
        set((state) => ({
          entries: [
            ...state.entries,
            {
              id: generateId(),
              code: entry.code,
              values: entry.values,
              createdAt: new Date().toISOString(),
            },
          ],
        }))
      },

      updateEntry: (id, updates) => {
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  ...updates,
                }
              : e,
          ),
        }))
      },

      deleteEntry: (id) => {
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }))
      },

      resetToDefaults: () => {
        set({ entries: defaultDatabazeEntries })
      },
    }),
    {
      name: "databaze-store",
    },
  ),
)

export const useDatabazeEntries = () => useDatabazeStore((state) => state.entries)

export const useDatabazeActions = () => ({
  addEntry: useDatabazeStore((state) => state.addEntry),
  updateEntry: useDatabazeStore((state) => state.updateEntry),
  deleteEntry: useDatabazeStore((state) => state.deleteEntry),
  resetToDefaults: useDatabazeStore((state) => state.resetToDefaults),
})

export const useDatabazeEntryByCode = (code: string) =>
  useDatabazeStore((state) => state.entries.find((e) => e.code === code))
