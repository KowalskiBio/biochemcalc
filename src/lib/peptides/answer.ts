/**
 * Peptidovka answer semantics: the expected chain is the one-letter codes
 * N→C joined; the student's input is tolerated case-insensitively with ALL
 * whitespace stripped ("m k y" == "MKY"). No other normalization — letters
 * are deterministic and aliases don't exist here.
 */

/** Join the per-residue one-letter codes into the expected N→C string. */
export function expectedChainLetters(oneLetters: string[]): string {
  return oneLetters.join("").toUpperCase()
}

/** Case- and whitespace-insensitive exact comparison of the typed chain. */
export function isChainCorrect(input: string, expected: string): boolean {
  return input.replace(/\s+/g, "").toUpperCase() === expected
}
