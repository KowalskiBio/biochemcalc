import { create } from "zustand"
import type { Template, Set } from "@/lib/types"

type CarryKind = "question" | "set" | null

interface CarryState {
  kind: CarryKind
  template: Template | null
  set: Set | null
  sourceSetId: string | null
  isCarrying: boolean
  mouseX: number
  mouseY: number
  startQuestionCarry: (template: Template, sourceSetId: string) => void
  startSetCarry: (set: Set) => void
  updateMouse: (x: number, y: number) => void
  endCarry: () => void
}

export const useCarryStore = create<CarryState>((set) => ({
  kind: null,
  template: null,
  set: null,
  sourceSetId: null,
  isCarrying: false,
  mouseX: 0,
  mouseY: 0,
  startQuestionCarry: (template, sourceSetId) =>
    set({ kind: "question", template, sourceSetId, isCarrying: true }),
  startSetCarry: (carriedSet) => set({ kind: "set", set: carriedSet, isCarrying: true }),
  updateMouse: (x, y) => set({ mouseX: x, mouseY: y }),
  endCarry: () =>
    set({ kind: null, template: null, set: null, sourceSetId: null, isCarrying: false }),
}))
