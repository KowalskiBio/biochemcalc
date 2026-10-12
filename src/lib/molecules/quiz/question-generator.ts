import type { AminoAcid } from "@/lib/molecules/amino-acids"
import { createSeededRandom, pick, randomInt, shuffle } from "@/lib/molecules/quiz/random"

export type QuizQuestionType =
  | "nameToLetter"
  | "letterToName"
  | "nameToStructure"
  | "structureToName"
  | "letterToStructure"
  | "structureToLetter"
  | "characteristic"

export type CharacteristicPredicate =
  | "nonpolar"
  | "polar"
  | "aromatic"
  | "acidic"
  | "basic"
  | "essential"
  | "achiral"
  | "sulfur"

export interface QuizOption {
  /** Unique within the question, e.g. the molecule id or `${id}:mirror`. */
  key: string
  display: "name" | "letter" | "structure"
  moleculeId: string
  correct: boolean
  /** Present only when `display === "structure"`. */
  smiles?: string
  /** Present only when `display === "structure"`; random angle in `[0, 360)`. */
  orientationDeg?: number
  /** Present only when `display === "structure"`; true only on enantiomer decoys. */
  mirror?: boolean
}

export interface QuizPrompt {
  kind: "name" | "letter" | "structure" | "characteristic"
  /** Molecule name, the letter, or `""` for structure/characteristic prompts. */
  text: string
  /** Present only when `kind === "structure"`. */
  smiles?: string
  /** Present only when `kind === "structure"`. */
  orientationDeg?: number
  /** Present only when `kind === "characteristic"`; the page localizes it. */
  predicate?: CharacteristicPredicate
}

export interface QuizQuestion {
  type: QuizQuestionType
  targetId: string
  prompt: QuizPrompt
  options: QuizOption[]
}

export interface GenerateQuizConfig {
  /** One is chosen per question (round-robin through a shuffled pool). */
  types: QuizQuestionType[]
  questionCount: number
  seed: number
  /** Enantiomer decoys, default true. */
  mirrorDecoys?: boolean
}

/** All quiz types in a stable order. */
export const ALL_QUIZ_TYPES: readonly QuizQuestionType[] = [
  "nameToLetter",
  "letterToName",
  "nameToStructure",
  "structureToName",
  "letterToStructure",
  "structureToLetter",
  "characteristic",
]

/** All characteristic predicates in a stable order. */
export const CHARACTERISTIC_PREDICATES: readonly CharacteristicPredicate[] = [
  "nonpolar",
  "polar",
  "aromatic",
  "acidic",
  "basic",
  "essential",
  "achiral",
  "sulfur",
]

/** Types whose answer options contain a letter, i.e. require `oneLetter`. */
const LETTER_QUIZ_TYPES: ReadonlySet<QuizQuestionType> = new Set([
  "nameToLetter",
  "letterToName",
  "letterToStructure",
  "structureToLetter",
])

/** Types whose answer options are structures (eligible for mirror decoys). */
const STRUCTURE_OPTION_TYPES: ReadonlySet<QuizQuestionType> = new Set([
  "nameToStructure",
  "letterToStructure",
])

const MIRROR_DECOY_PROBABILITY = 0.5

/** Classify a molecule against a characteristic predicate. Pure. */
export function moleculeMatchesPredicate(
  molecule: AminoAcid,
  predicate: CharacteristicPredicate,
): boolean {
  switch (predicate) {
    case "nonpolar":
      return molecule.sideChain === "nonpolar"
    case "polar":
      return molecule.sideChain === "polar"
    case "acidic":
      return molecule.sideChain === "acidic"
    case "basic":
      return molecule.sideChain === "basic"
    case "aromatic":
      return molecule.aromatic
    case "essential":
      return molecule.essential
    case "achiral":
      return molecule.achiral
    case "sulfur":
      return molecule.id === "cys" || molecule.id === "met"
  }
}

/**
 * Quiz types generatable from `molecules`. Letter types are only offered when
 * every molecule carries a `oneLetter`, since their options are letters looked
 * up by molecule id.
 */
export function availableQuizTypes(molecules: AminoAcid[]): QuizQuestionType[] {
  if (molecules.length === 0) {
    return []
  }
  const everyHasLetter = molecules.every((molecule) => molecule.oneLetter.trim().length > 0)
  return ALL_QUIZ_TYPES.filter((type) => everyHasLetter || !LETTER_QUIZ_TYPES.has(type))
}

function qualifyingPredicates(molecules: AminoAcid[]): CharacteristicPredicate[] {
  return CHARACTERISTIC_PREDICATES.filter((predicate) => {
    const matches = molecules.filter((molecule) =>
      moleculeMatchesPredicate(molecule, predicate),
    ).length
    return matches >= 1 && molecules.length - matches >= 3
  })
}

function isGeneratable(type: QuizQuestionType, molecules: AminoAcid[]): boolean {
  if (type === "characteristic") {
    return qualifyingPredicates(molecules).length > 0
  }
  // Needs the target plus three distinct distractors.
  return molecules.length >= 4
}

function optionDisplayFor(type: QuizQuestionType): "name" | "letter" | "structure" {
  switch (type) {
    case "nameToLetter":
    case "structureToLetter":
      return "letter"
    case "letterToName":
    case "structureToName":
    case "characteristic":
      return "name"
    case "nameToStructure":
    case "letterToStructure":
      return "structure"
  }
}

function makeOption(
  display: "name" | "letter" | "structure",
  molecule: AminoAcid,
  correct: boolean,
  rng: () => number,
): QuizOption {
  if (display === "structure") {
    return {
      key: molecule.id,
      display: "structure",
      moleculeId: molecule.id,
      correct,
      smiles: molecule.smiles,
      orientationDeg: randomInt(rng, 0, 360),
      mirror: false,
    }
  }
  return { key: molecule.id, display, moleculeId: molecule.id, correct }
}

function makeMirrorDecoy(target: AminoAcid, rng: () => number): QuizOption {
  return {
    key: `${target.id}:mirror`,
    display: "structure",
    moleculeId: target.id,
    correct: false,
    smiles: target.smiles,
    orientationDeg: randomInt(rng, 0, 360),
    mirror: true,
  }
}

/**
 * Three distinct molecules that differ from the target, preferring the target's
 * own side-chain class when enough same-class molecules exist (harder traps).
 * Any shortfall is filled from the remaining molecules.
 */
function selectDistractors(
  molecules: AminoAcid[],
  target: AminoAcid,
  rng: () => number,
): AminoAcid[] {
  const others = molecules.filter((molecule) => molecule.id !== target.id)
  const sameClass = others.filter((molecule) => molecule.sideChain === target.sideChain)
  const rest = others.filter((molecule) => molecule.sideChain !== target.sideChain)
  return [...shuffle(rng, sameClass), ...shuffle(rng, rest)].slice(0, 3)
}

function buildPrompt(target: AminoAcid, type: QuizQuestionType, rng: () => number): QuizPrompt {
  switch (type) {
    case "nameToLetter":
    case "nameToStructure":
      return { kind: "name", text: target.name }
    case "letterToName":
    case "letterToStructure":
      return { kind: "letter", text: target.oneLetter }
    case "structureToName":
    case "structureToLetter":
      return {
        kind: "structure",
        text: "",
        smiles: target.smiles,
        orientationDeg: randomInt(rng, 0, 360),
      }
    case "characteristic":
      // Built by buildCharacteristicQuestion, which knows the predicate.
      return { kind: "characteristic", text: "" }
  }
}

function buildOptions(
  molecules: AminoAcid[],
  target: AminoAcid,
  type: QuizQuestionType,
  rng: () => number,
  mirrorDecoys: boolean,
): QuizOption[] {
  const display = optionDisplayFor(type)
  const distractors = selectDistractors(molecules, target, rng)
  const options: QuizOption[] = [
    makeOption(display, target, true, rng),
    ...distractors.map((molecule) => makeOption(display, molecule, false, rng)),
  ]

  // Enantiomer decoy: same molecule id as the target, but drawn mirrored, so
  // its depiction is the opposite enantiomer. Only for structure options of a
  // chiral target (glycine is achiral and would look identical).
  if (
    mirrorDecoys &&
    STRUCTURE_OPTION_TYPES.has(type) &&
    !target.achiral &&
    rng() < MIRROR_DECOY_PROBABILITY
  ) {
    const replaceIndex = randomInt(rng, 1, options.length)
    options[replaceIndex] = makeMirrorDecoy(target, rng)
  }

  return shuffle(rng, options)
}

function buildCharacteristicQuestion(
  molecules: AminoAcid[],
  target: AminoAcid,
  rng: () => number,
): QuizQuestion {
  const qualifying = qualifyingPredicates(molecules)
  const matchingTarget = qualifying.filter((predicate) =>
    moleculeMatchesPredicate(target, predicate),
  )
  // Prefer a predicate the queued target satisfies, keeping the target queue
  // authoritative; fall back to any qualifying predicate for other inputs.
  const predicate = matchingTarget.length > 0 ? pick(rng, matchingTarget) : pick(rng, qualifying)

  const matches = molecules.filter((molecule) => moleculeMatchesPredicate(molecule, predicate))
  const nonMatches = molecules.filter((molecule) => !moleculeMatchesPredicate(molecule, predicate))
  const correct = matches.some((molecule) => molecule.id === target.id)
    ? target
    : pick(rng, matches)
  const distractors = shuffle(rng, nonMatches).slice(0, 3)

  const options: QuizOption[] = [
    makeOption("name", correct, true, rng),
    ...distractors.map((molecule) => makeOption("name", molecule, false, rng)),
  ]

  return {
    type: "characteristic",
    targetId: correct.id,
    prompt: { kind: "characteristic", text: "", predicate },
    options: shuffle(rng, options),
  }
}

function buildQuestion(
  molecules: AminoAcid[],
  target: AminoAcid,
  type: QuizQuestionType,
  rng: () => number,
  mirrorDecoys: boolean,
): QuizQuestion {
  if (type === "characteristic") {
    return buildCharacteristicQuestion(molecules, target, rng)
  }
  return {
    type,
    targetId: target.id,
    prompt: buildPrompt(target, type, rng),
    options: buildOptions(molecules, target, type, rng, mirrorDecoys),
  }
}

/**
 * Generate a deterministic quiz session for `molecules`.
 *
 * The same `seed` and config always produce byte-identical questions. Targets
 * are drawn from a shuffled queue that reshuffles when exhausted and never
 * repeats back-to-back; question types cycle through a freshly shuffled pool.
 */
export function generateQuizSession(
  molecules: AminoAcid[],
  config: GenerateQuizConfig,
): QuizQuestion[] {
  if (molecules.length === 0 || config.questionCount <= 0) {
    return []
  }

  const rng = createSeededRandom(config.seed)
  const mirrorDecoys = config.mirrorDecoys !== false
  const available = availableQuizTypes(molecules)
  const requested = [...new Set(config.types)].filter(
    (type) => available.includes(type) && isGeneratable(type, molecules),
  )
  if (requested.length === 0) {
    return []
  }

  const questions: QuizQuestion[] = []
  let typePool: QuizQuestionType[] = []
  let targetPool: AminoAcid[] = []
  let lastTargetId: string | null = null

  const nextType = (): QuizQuestionType => {
    if (typePool.length === 0) {
      typePool = shuffle(rng, requested)
    }
    const type = typePool[0]
    typePool = typePool.slice(1)
    return type
  }

  const nextTarget = (): AminoAcid => {
    if (targetPool.length === 0) {
      targetPool = shuffle(rng, molecules)
      // Avoid a back-to-back repeat across the reshuffle boundary.
      if (lastTargetId !== null && targetPool.length > 1 && targetPool[0].id === lastTargetId) {
        const j = randomInt(rng, 1, targetPool.length)
        const first = targetPool[0]
        targetPool[0] = targetPool[j]
        targetPool[j] = first
      }
    }
    const target = targetPool[0]
    targetPool = targetPool.slice(1)
    return target
  }

  for (let i = 0; i < config.questionCount; i++) {
    const type = nextType()
    const target = nextTarget()
    const question = buildQuestion(molecules, target, type, rng, mirrorDecoys)
    lastTargetId = question.targetId
    questions.push(question)
  }

  return questions
}
