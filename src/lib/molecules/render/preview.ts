// Recognition verdict for the teacher projection preview. Runs the same RDKit
// pipeline the live StructureView uses, without showing anything, and
// summarizes whether the SMILES gets the Haworth treatment.
import { haworthLayoutOf, prepareStructureRender } from "@/lib/molecules/render/haworth-rdkit"
import { ensureRdkit } from "@/lib/molecules/render/rdkit-engine"

export type RecognitionVerdict =
  | { status: "invalid" }
  | { status: "none" }
  | { status: "recognized"; forms: ("pyranose" | "furanose" | "fischer")[] }

/**
 * Prepare the depiction and decide whether any sugar-like ring is recognized.
 * The engine has to be initialized first, hence the async signature; the
 * preview page calls this directly and the live drawing path is untouched.
 */
export async function previewRecognition(smiles: string): Promise<RecognitionVerdict> {
  try {
    await ensureRdkit()
  } catch {
    return { status: "invalid" }
  }
  const prepared = prepareStructureRender(smiles, { width: 320, height: 240 })
  if (prepared === null) {
    return { status: "invalid" }
  }
  if (prepared.recognized === "fischer") {
    return { status: "recognized", forms: ["fischer"] }
  }
  if (prepared.recognized !== "haworth") {
    return { status: "none" }
  }
  const layout = haworthLayoutOf(smiles, { width: 320, height: 240 })
  const forms = (layout?.plans ?? []).map((plan) =>
    plan.cycle.length === 6 ? ("pyranose" as const) : ("furanose" as const),
  )
  return { status: "recognized", forms }
}
