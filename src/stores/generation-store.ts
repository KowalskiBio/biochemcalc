import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import type { QuestionDifficulty, TemplateMode, TemplateVariantResult } from "@/lib/types"

export interface GeneratedTestState {
  results: TemplateVariantResult[] | null
  mode: TemplateMode | null
  closedDifficulty: QuestionDifficulty
  closedOptionCount: number
  /** Drives the tolerance interval width of open answers: easy ±50 %,
   * medium ±30 %, hard ±10 % (see `open_interval` in the Rust engine). */
  openDifficulty: QuestionDifficulty
  lastClosedDifficulty: QuestionDifficulty
  lastClosedOptionCount: number
  lastOpenDifficulty: QuestionDifficulty
  generationError: string | null
}

const defaultGeneratedState: GeneratedTestState = {
  results: null,
  mode: null,
  closedDifficulty: "medium",
  closedOptionCount: 5,
  openDifficulty: "medium",
  lastClosedDifficulty: "medium",
  lastClosedOptionCount: 5,
  lastOpenDifficulty: "medium",
  generationError: null,
}

interface GenerationStoreState {
  generations: Record<string, GeneratedTestState>
  setGeneration: (setId: string, update: Partial<GeneratedTestState>) => void
  updateGeneration: (
    setId: string,
    updater: (state: GeneratedTestState) => GeneratedTestState,
  ) => void
  clearGeneration: (setId: string) => void
  clearAllGenerations: () => void
}

export const useGenerationStore = create<GenerationStoreState>()((set) => ({
  generations: {},

  setGeneration: (setId, update) =>
    set((state) => ({
      generations: {
        ...state.generations,
        [setId]: {
          ...(state.generations[setId] ?? defaultGeneratedState),
          ...update,
        },
      },
    })),

  updateGeneration: (setId, updater) =>
    set((state) => ({
      generations: {
        ...state.generations,
        [setId]: updater(state.generations[setId] ?? defaultGeneratedState),
      },
    })),

  clearGeneration: (setId) =>
    set((state) => {
      const next = { ...state.generations }
      delete next[setId]
      return { generations: next }
    }),

  clearAllGenerations: () => set({ generations: {} }),
}))

export const useGenerationBySetId = (setId: string | undefined) =>
  useGenerationStore((state) =>
    setId ? (state.generations[setId] ?? defaultGeneratedState) : defaultGeneratedState,
  )

export const useGenerationActions = () =>
  useGenerationStore(
    useShallow((state) => ({
      setGeneration: state.setGeneration,
      updateGeneration: state.updateGeneration,
      clearGeneration: state.clearGeneration,
      clearAllGenerations: state.clearAllGenerations,
    })),
  )
