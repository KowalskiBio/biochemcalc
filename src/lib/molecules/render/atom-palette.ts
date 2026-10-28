// The app atom palette for biomolecule depictions — the hexes heteroatom
// labels take instead of RDKit's legacy CPK defaults.
//
// RDKit draws with the paper-era CPK set (pure red #FF0000 oxygen, pure blue
// #0000FF nitrogen) tuned for a white page: on the app's backgrounds
// (#F2F3EC light, #101613 dark) the saturated primaries glare. The remap borrows
// the Tailwind v3 -600 accent hexes the calculations module already uses for
// its X/Y/Z variables (VARIABLE_COLORS in src/lib/render-question-text.tsx), so
// a glucose ring oxygen and a calculation variable speak one accent language.
// Like the variable accents, the same hexes serve both themes — the atom
// letter itself carries identity, so the -600 shades need no per-theme
// variant. The neutral carbon ink sits just off pure black/white
// (applyTheme in svg-post.ts swaps one for the other, and Mistr's single-ink
// monochrome mode draws the whole structure in it).
//
// Scope is deliberately the four heteroatoms this app's biomolecules actually
// contain: oxygen everywhere, nitrogen in amino acids / bases / nucleotides /
// porphyrins, sulfur in cysteine and methionine, phosphorus in nucleotides.
// Metals (Fe/Mg/Co) keep their RDKit hue — they are single-atom accents whose
// colour is diagnostic — and no halogenated molecule exists in the seed data,
// so no halogen remap ships unverified.

/** Oxygen — Tailwind red-600; softens RDKit's pure red into the app's red accent. */
export const ATOM_COLOR_OXYGEN = "#DC2626"
/** Nitrogen — Tailwind blue-600; softens RDKit's pure blue into the app's blue accent. */
export const ATOM_COLOR_NITROGEN = "#2563EB"
/**
 * Sulfur — keeps RDKit's classic yellow #CCCC00. An orange retune read as
 * unnatural for sulfur (and risked confusion with phosphorus), while the
 * yellow holds up on both app backgrounds well enough once the glaring
 * oxygen/nitrogen primaries are gone — and the S letter carries identity.
 * Deliberately absent from the remap table so it passes through untouched.
 */
export const ATOM_COLOR_SULFUR = "#CCCC00"
/**
 * Phosphorus — Tailwind orange-600; RDKit's own phosphorus hue (#FF7F00) is
 * already orange, so this is a softening, not a re-hueing. Sulfur stays yellow,
 * so the two warm-family heteroatoms never share a hex.
 */
export const ATOM_COLOR_PHOSPHORUS = "#EA580C"

/**
 * Neutral ink — carbon chains and hydrogens — in the light theme. Not pure
 * black: the theme's darkest surface tone (--color-sidebar #16281F in
 * tokens.css), which softens the depiction against the paper background
 * without losing the skeletal contrast.
 */
export const ATOM_COLOR_NEUTRAL = "#16281F"
/**
 * Neutral ink in the dark theme (applyTheme swaps the light ink for it).
 * Not pure white: near-white with a warm/paper bias (#FCFCF8) so dark-mode
 * structures stop flaring against the muted palette.
 */
export const ATOM_COLOR_NEUTRAL_DARK = "#FCFCF8"

/**
 * RDKit's default heteroatom hexes → the app palette, keys uppercase. The
 * values are the ones the WASM build actually emits (verified molecule by
 * molecule), including its channel truncation: phosphorus 0.5×255 lands on
 * 7F, not 80 — the 80 alias only guards a future RDKit that rounds. Both the
 * fill/stroke attributes and the inline `style="fill:#…"` fragments carry
 * these hexes, so applyTheme matches case-insensitively on both.
 */
export const RDKIT_DEFAULT_ATOM_COLORS: Readonly<Record<string, string>> = {
  "#FF0000": ATOM_COLOR_OXYGEN,
  "#0000FF": ATOM_COLOR_NITROGEN,
  // Sulfur's #CCCC00 intentionally has no entry: it passes through unretuned.
  "#FF7F00": ATOM_COLOR_PHOSPHORUS,
  "#FF8000": ATOM_COLOR_PHOSPHORUS,
}
