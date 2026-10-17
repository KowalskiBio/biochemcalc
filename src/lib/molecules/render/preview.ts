// Recognition verdict for the teacher projection preview: runs the same
// parse → snapshot → recognize pipeline the live StructureView uses,
// without showing anything, and summarizes whether the SMILES gets the
// Haworth treatment.
import SmilesDrawer from "smiles-drawer"

import {
  type PreprocessorLike,
  snapshotFromPreprocessor,
} from "@/lib/molecules/render/pipeline-snapshot"
import { recognizeSugarRings } from "@/lib/molecules/render/recognize"

export type RecognitionVerdict =
  | { status: "invalid" }
  | { status: "none" }
  | { status: "recognized"; forms: ("pyranose" | "furanose")[] }

/**
 * Parse `smiles` and decide whether any sugar-like ring is recognized.
 * Independent, self-contained drawer instance — the preview page can call
 * this directly; the live drawing path is untouched.
 */
export function previewRecognition(smiles: string): RecognitionVerdict {
  let verdict: RecognitionVerdict | null = null
  SmilesDrawer.parse(
    smiles,
    (tree: unknown) => {
      const drawer = new SmilesDrawer.SvgDrawer({ width: 320, height: 240, bondLength: 24 })
      const preprocessor = (
        drawer as unknown as {
          preprocessor: PreprocessorLike & { processGraph: (...args: unknown[]) => void }
        }
      ).preprocessor
      const original = preprocessor.processGraph
      preprocessor.processGraph = ((...args: unknown[]) => {
        const result = original.apply(preprocessor, args)
        const snapshot = snapshotFromPreprocessor(preprocessor)
        const plans = recognizeSugarRings(snapshot)
        verdict =
          plans.length === 0
            ? { status: "none" }
            : {
                status: "recognized",
                forms: plans.map((plan) =>
                  plan.cycle.length === 6 ? ("pyranose" as const) : ("furanose" as const),
                ),
              }
        return result
      }) as typeof original
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      try {
        drawer.draw(tree, svg, "light")
      } finally {
        preprocessor.processGraph = original
      }
    },
    () => {
      verdict = { status: "invalid" }
    },
  )
  return verdict ?? { status: "invalid" }
}
