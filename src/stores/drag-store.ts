import { create } from "zustand"
import type { Set as QuestionSet, Template, Topic } from "@/lib/types"

type CarryKind = "question" | "set" | "topic" | null

interface CarryState {
  kind: CarryKind
  template: Template | null
  set: QuestionSet | null
  topic: Topic | null
  sourceSetId: string | null
  isCarrying: boolean
  mouseX: number
  mouseY: number
  startQuestionCarry: (template: Template, sourceSetId: string) => void
  startSetCarry: (set: QuestionSet) => void
  startTopicCarry: (topic: Topic) => void
  updateMouse: (x: number, y: number) => void
  endCarry: () => void
}

export const useCarryStore = create<CarryState>((set) => ({
  kind: null,
  template: null,
  set: null,
  topic: null,
  sourceSetId: null,
  isCarrying: false,
  mouseX: 0,
  mouseY: 0,
  startQuestionCarry: (template, sourceSetId) =>
    set({ kind: "question", template, sourceSetId, isCarrying: true }),
  startSetCarry: (carriedSet) => set({ kind: "set", set: carriedSet, isCarrying: true }),
  startTopicCarry: (carriedTopic) => set({ kind: "topic", topic: carriedTopic, isCarrying: true }),
  updateMouse: (x, y) => set({ mouseX: x, mouseY: y }),
  endCarry: () =>
    set({
      kind: null,
      template: null,
      set: null,
      topic: null,
      sourceSetId: null,
      isCarrying: false,
    }),
}))
