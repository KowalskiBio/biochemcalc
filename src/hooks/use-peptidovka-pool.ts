import { useCallback, useEffect, useMemo, useState } from "react"

import {
  biomoleculesApi,
  type PeptidovkaMode,
  type PeptidovkaSettings,
} from "@/lib/biomolecules-api"
import { PEPTIDE_FAMILY_SLUGS, TRAIT, traitOf } from "@/lib/molecules"
import { ensureRdkit } from "@/lib/molecules/render/rdkit-engine"
import {
  expectedChainLetters,
  generatePeptide,
  nLeftOrientationDeg,
  peptideParts,
} from "@/lib/peptides"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useMoleculeCategories,
} from "@/stores/biomolecule-data-store"

/** One generated peptide, with everything a round needs precomputed. */
export interface PeptideDraw {
  slugs: string[]
  smiles: string
  orientationDeg: number
  /** The N→C one-letter answer, already uppercased. */
  expected: string
  length: number
  /** The teacher's per-amino-acid allowance times the length. */
  timeLimitSeconds: number
}

export type PeptidovkaPoolStatus = "loading" | "error" | "empty" | "ready"

/**
 * Učeň's canonical reading direction – structure laid N-terminus left. Any
 * geometry hiccup (unparseable SMILES, RDKit still initializing) degrades
 * to the unrotated draw rather than killing the round.
 */
export function nLeftDeg(smiles: string, nIndex: number): number {
  try {
    return nLeftOrientationDeg(smiles, nIndex) ?? 0
  } catch {
    return 0
  }
}

/**
 * The Peptidovka material for one mode, as the teacher configured it: the
 * mode's settings (fetched once per mount), the playable amino acids (the
 * peptide family's molecules that carry a one-letter code – the answer
 * alphabet), and `draw()` serving a fresh random peptide. Učeň draws keep the
 * N-terminus on the left; Mistr draws rotate to a random angle.
 *
 * `status` is "ready" once the dataset, the settings and RDKit (needed for
 * the N-left orientation) are all there and the pool holds at least two
 * acids; "empty" when it never will (no peptide family, too few acids).
 */
export function usePeptidovkaPool(mode: PeptidovkaMode) {
  const master = mode === "mistr"
  const loaded = useBiomoleculeDataLoaded()
  const categories = useMoleculeCategories()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const [settingsAll, setSettingsAll] = useState<PeptidovkaSettings[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  // Settings come once per mount – a teacher's mid-run edits are a non-case,
  // exactly like the streak's pool built from the loaded dataset.
  useEffect(() => {
    let cancelled = false
    biomoleculesApi
      .peptidovkaSettings()
      .then((rows) => {
        if (!cancelled) setSettingsAll(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // RDKit has to be up before Učeň's N-left orientation can be measured; the
  // wasm usually wins the race against the dataset, and fail-open degrades
  // to the unrotated draw (nLeftDeg) instead of never starting.
  const [rdkitReady, setRdkitReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ensureRdkit()
      .catch(() => {})
      .then(() => {
        if (!cancelled) setRdkitReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const modeSettings = useMemo(
    () => settingsAll?.find((row) => row.mode === mode) ?? null,
    [settingsAll, mode],
  )

  const playableBySlug = useMemo(() => {
    const map = new Map<string, string>()
    for (const molecule of allMolecules) {
      if (!PEPTIDE_FAMILY_SLUGS.includes(molecule.categorySlug)) continue
      const oneLetter = traitOf(molecule, TRAIT.oneLetter)
      if (oneLetter !== undefined) map.set(molecule.slug, oneLetter)
    }
    return map
  }, [allMolecules])

  // The effective pool: every playable molecule not explicitly switched off.
  // A missing saved weight means the default 1; explicit zero disables the
  // molecule. Valid positive weights pass straight through to the generator's
  // weighted sampling (0.5 = half as likely as 1). Iterating playable molecules
  // also drops stale slugs, stripped one-letter codes, and deleted molecules.
  const { pool, poolWeights } = useMemo(() => {
    const slugs: string[] = []
    const weights: Record<string, number> = {}
    if (modeSettings !== null) {
      for (const slug of playableBySlug.keys()) {
        const weight = modeSettings.weights[slug] ?? 1
        if (!Number.isFinite(weight) || weight <= 0 || weight > 1) continue
        slugs.push(slug)
        weights[slug] = weight
      }
    }
    return { pool: slugs, poolWeights: weights }
  }, [modeSettings, playableBySlug])

  // Unknown slugs in the pool (no residue template – a teacher-added acid
  // the synthesizer doesn't know) get exactly one redraw with a fresh seed,
  // then null; length falls back to a sane span should the server's bounds
  // ever slip.
  const draw = useCallback((): PeptideDraw | null => {
    if (modeSettings === null || pool.length === 0) return null
    const maxLen = Math.max(modeSettings.minLen, modeSettings.maxLen)
    const minLen = Math.max(1, Math.min(modeSettings.minLen, maxLen))
    for (let attempt = 0; attempt < 2; attempt++) {
      const random = crypto.getRandomValues(new Uint32Array(3))
      const length = minLen + (random[0] % (maxLen - minLen + 1))
      const slugs = generatePeptide(poolWeights, length, random[1])
      const parts = peptideParts(slugs)
      if (parts === null) continue
      const letters = slugs.map((slug) => playableBySlug.get(slug))
      if (letters.some((letter) => letter === undefined)) continue
      return {
        slugs,
        smiles: parts.smiles,
        orientationDeg: master ? random[2] % 360 : nLeftDeg(parts.smiles, parts.nIndex),
        expected: expectedChainLetters(letters as string[]),
        length,
        timeLimitSeconds: modeSettings.secondsPerAa * length,
      }
    }
    return null
  }, [modeSettings, pool.length, poolWeights, playableBySlug, master])

  let status: PeptidovkaPoolStatus
  if (loadFailed) status = "error"
  else if (!loaded || settingsAll === null) status = "loading"
  else if (
    !categories.some((category) => PEPTIDE_FAMILY_SLUGS.includes(category.slug)) ||
    playableBySlug.size === 0 ||
    pool.length < 2
  )
    status = "empty"
  else if (!rdkitReady) status = "loading"
  else status = "ready"

  return { status, draw }
}
