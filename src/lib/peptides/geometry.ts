import { parseMol, snapshotFromMol } from "@/lib/molecules/render/rdkit-engine"

/**
 * Rotation (degrees, y-up math sense as in `orientation.ts`) that lays the
 * peptide N→C vector horizontally with the N-terminus on the LEFT: the
 * teacher-facing "canonical reading direction" for Učeň. Compute the current
 * N→C direction from the pre-render (y-up molblock) coordinates and return
 * its negation, ready to feed `orientationDeg`.
 *
 * Anchors: `nIndex` comes from the synthesizer (0, or 3 when the chain opens
 * with proline's ring-first fragment); the C-end anchor is the trailing
 * carboxyl oxygen — always the last text atom by construction, and RDKit
 * preserves SMILES parse order in its JSON atom list, so it is the final
 * index of the parsed snapshot.
 */
export function nLeftOrientationDeg(smiles: string, nIndex: number): number | null {
  const mol = parseMol(smiles)
  if (mol === null) {
    return null
  }
  try {
    const atoms = snapshotFromMol(mol).atoms
    const from = atoms[nIndex]
    const to = atoms[atoms.length - 1]
    if (from === undefined || to === undefined) {
      return null
    }
    const dx = to.pos.x - from.pos.x
    const dy = to.pos.y - from.pos.y
    // atan2(0,0) === 0, so even a hypothetically degenerate axis is safe.
    return -(Math.atan2(dy, dx) * 180) / Math.PI
  } finally {
    mol.delete()
  }
}
