import { createSeededRandom, pick, randomInt, shuffle } from "@/lib/molecules/quiz/random"

export type QuizQuestionType =
  | "nameToLetter"
  | "letterToName"
  | "nameToStructure"
  | "structureToName"
  | "letterToStructure"
  | "structureToLetter"
  | "characteristic"

/** The curated amino-acid characteristic predicates (aminokyseliny). */
export type AminoAcidCharacteristicPredicate =
  | "nonpolar"
  | "polar"
  | "aromatic"
  | "acidic"
  | "basic"
  | "essential"
  | "achiral"
  | "sulfur"

/**
 * A characteristic question's predicate id. Amino acids use their curated
 * set above; any category can also get `trait:value` predicates derived
 * from molecule traits ("charge:positive", "polarity:hydrophobic"). The
 * page localizes prompts via `cs.biomolekuly.quiz.characteristicPrompts`.
 */
export type CharacteristicPredicate = string

/**
 * The minimal, molecule-family-agnostic shape the quiz engine needs. Concrete
 * families (amino acids, nitrogenous bases, …) are adapted to this via
 * `getCategoryQuizConfig`, which also supplies their characteristic tests.
 */
export interface QuizMolecule {
  id: string
  name: string
  smiles: string
  /** Required only for the letter-based question types. */
  oneLetter?: string
  /** Additional accepted spellings for open (hard-mode) name answers. */
  aliases?: string[]
  /** Groups molecules for the same-class distractor preference. */
  classKey?: string
  /** Enantiomer decoys are only allowed when this is false/undefined. */
  achiral?: boolean
}

/** A named predicate plus its molecule test, supplied by the category adapter. */
export interface CharacteristicDef {
  predicate: CharacteristicPredicate
  matches: (molecule: QuizMolecule) => boolean
}

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

/**
 * Quiz difficulty. "easy" is the classic multiple-choice flow; "hard" keeps
 * the same MCQs but restricts the types to written-answer material and
 * attaches an `openAnswer` the UI can grade free-text input against.
 */
export type QuizMode = "easy" | "hard"

/** The accepted free-text answer for a hard-mode question. */
export type OpenAnswer = { kind: "name" | "letter"; acceptedAnswers: string[] }

export interface QuizQuestion {
  type: QuizQuestionType
  targetId: string
  prompt: QuizPrompt
  options: QuizOption[]
  /** Present only on hard-mode questions; graded via `isOpenAnswerCorrect`. */
  openAnswer?: OpenAnswer
}

export interface GenerateQuizConfig {
  /** One is chosen per question (round-robin through a shuffled pool). */
  types: QuizQuestionType[]
  questionCount: number
  seed: number
  /** Enantiomer decoys, default true. */
  mirrorDecoys?: boolean
  /** Same-class grouping for distractor preference; default reads `m.classKey`. */
  classKeyOf?: (molecule: QuizMolecule) => string | undefined
  /** A non-empty list enables the "characteristic" question type. */
  characteristics?: CharacteristicDef[]
  /** Quiz difficulty, default "easy". */
  mode?: QuizMode
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

/**
 * The types hard mode quizzes: those whose answer is a written name or letter.
 * The structure-as-answer types (`nameToStructure`, `letterToStructure`) are
 * excluded — a structure can't be typed, so they stay multiple-choice only —
 * and so is `characteristic`: accepting any matching molecule makes it a
 * trivially repeatable question rather than a recall exercise.
 */
export const HARD_MODE_QUIZ_TYPES: readonly QuizQuestionType[] = [
  "nameToLetter",
  "letterToName",
  "structureToName",
  "structureToLetter",
]

/** The curated amino-acid predicates in a stable order. */
export const CHARACTERISTIC_PREDICATES: readonly AminoAcidCharacteristicPredicate[] = [
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

type ClassKeyOf = (molecule: QuizMolecule) => string | undefined

const defaultClassKeyOf: ClassKeyOf = (molecule) => molecule.classKey

/**
 * Quiz types generatable from `molecules`. Letter types are only offered when
 * every molecule carries a `oneLetter`; "characteristic" only when at least one
 * characteristic definition is injected.
 */
export function availableQuizTypes(
  molecules: QuizMolecule[],
  characteristics?: CharacteristicDef[],
): QuizQuestionType[] {
  if (molecules.length === 0) {
    return []
  }
  const everyHasLetter = molecules.every((molecule) => (molecule.oneLetter ?? "").trim().length > 0)
  return ALL_QUIZ_TYPES.filter((type) => {
    if (LETTER_QUIZ_TYPES.has(type)) {
      return everyHasLetter
    }
    if (type === "characteristic") {
      return characteristics !== undefined && characteristics.length > 0
    }
    return true
  })
}

/**
 * The types a session with these molecules can actually produce — the
 * available types, minus those without enough material (four molecules per
 * option set, a qualifying predicate for "characteristic"). The setup
 * screen offers exactly these.
 */
export function generatableQuizTypes(
  molecules: QuizMolecule[],
  characteristics?: CharacteristicDef[],
  mode: QuizMode = "easy",
): QuizQuestionType[] {
  const types = availableQuizTypes(molecules, characteristics).filter((type) =>
    isGeneratable(type, molecules, characteristics),
  )
  if (mode === "hard") {
    return types.filter((type) => HARD_MODE_QUIZ_TYPES.includes(type))
  }
  return types
}

function qualifyingPredicates(
  molecules: QuizMolecule[],
  characteristics: CharacteristicDef[],
): CharacteristicDef[] {
  return characteristics.filter((def) => {
    const matches = molecules.filter((molecule) => def.matches(molecule)).length
    return matches >= 1 && molecules.length - matches >= 3
  })
}

function isGeneratable(
  type: QuizQuestionType,
  molecules: QuizMolecule[],
  characteristics: CharacteristicDef[] | undefined,
): boolean {
  if (type === "characteristic") {
    return (
      characteristics !== undefined && qualifyingPredicates(molecules, characteristics).length > 0
    )
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
  molecule: QuizMolecule,
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

function makeMirrorDecoy(target: QuizMolecule, rng: () => number): QuizOption {
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
 * own class when enough same-class molecules exist (harder traps). Undefined
 * class keys never count as a match. Any shortfall is filled from the rest.
 */
function selectDistractors(
  molecules: QuizMolecule[],
  target: QuizMolecule,
  rng: () => number,
  classKeyOf: ClassKeyOf,
): QuizMolecule[] {
  const targetKey = classKeyOf(target)
  const others = molecules.filter((molecule) => molecule.id !== target.id)
  const sameClass = others.filter((molecule) => {
    const key = classKeyOf(molecule)
    return key !== undefined && key === targetKey
  })
  const rest = others.filter((molecule) => !sameClass.includes(molecule))
  return [...shuffle(rng, sameClass), ...shuffle(rng, rest)].slice(0, 3)
}

function buildPrompt(target: QuizMolecule, type: QuizQuestionType, rng: () => number): QuizPrompt {
  switch (type) {
    case "nameToLetter":
    case "nameToStructure":
      return { kind: "name", text: target.name }
    case "letterToName":
    case "letterToStructure":
      return { kind: "letter", text: target.oneLetter ?? "" }
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
  molecules: QuizMolecule[],
  target: QuizMolecule,
  type: QuizQuestionType,
  rng: () => number,
  mirrorDecoys: boolean,
  classKeyOf: ClassKeyOf,
): QuizOption[] {
  const display = optionDisplayFor(type)
  const distractors = selectDistractors(molecules, target, rng, classKeyOf)
  const options: QuizOption[] = [
    makeOption(display, target, true, rng),
    ...distractors.map((molecule) => makeOption(display, molecule, false, rng)),
  ]

  // Enantiomer decoy: same molecule id as the target, but drawn mirrored, so
  // its depiction is the opposite enantiomer. Only for structure options of a
  // chiral target (an achiral molecule would look identical when mirrored).
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
  molecules: QuizMolecule[],
  target: QuizMolecule,
  characteristics: CharacteristicDef[],
  rng: () => number,
): QuizQuestion {
  const qualifying = qualifyingPredicates(molecules, characteristics)
  const matchingTarget = qualifying.filter((def) => def.matches(target))
  // Prefer a predicate the queued target satisfies, keeping the target queue
  // authoritative; fall back to any qualifying predicate for other inputs.
  const def = matchingTarget.length > 0 ? pick(rng, matchingTarget) : pick(rng, qualifying)
  const predicate = def.predicate

  const matches = molecules.filter((molecule) => def.matches(molecule))
  const nonMatches = molecules.filter((molecule) => !def.matches(molecule))
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
  molecules: QuizMolecule[],
  target: QuizMolecule,
  type: QuizQuestionType,
  rng: () => number,
  mirrorDecoys: boolean,
  classKeyOf: ClassKeyOf,
  characteristics: CharacteristicDef[] | undefined,
): QuizQuestion {
  if (type === "characteristic" && characteristics !== undefined) {
    return buildCharacteristicQuestion(molecules, target, characteristics, rng)
  }
  return {
    type,
    targetId: target.id,
    prompt: buildPrompt(target, type, rng),
    options: buildOptions(molecules, target, type, rng, mirrorDecoys, classKeyOf),
  }
}

/**
 * Normalize a free-text quiz answer for tolerant comparison: Unicode-decompose,
 * strip combining diacritics, lowercase, trim, and collapse inner whitespace.
 * So "Kyselina asparagová" and "  kyselina   asparagova " compare equal.
 */
export function normalizeQuizAnswer(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ")
}

/**
 * The accepted free-text answer for a hard-mode question. Name answers accept
 * the molecule's name plus any aliases; letter answers accept the letter.
 */
function buildOpenAnswer(
  question: QuizQuestion,
  target: QuizMolecule,
): OpenAnswer {
  switch (question.type) {
    case "nameToLetter":
    case "structureToLetter":
      return { kind: "letter", acceptedAnswers: [target.oneLetter ?? ""] }
    default:
      return { kind: "name", acceptedAnswers: [target.name, ...(target.aliases ?? [])] }
  }
}

/**
 * True when `input` matches a hard-mode question's accepted answer, using
 * `normalizeQuizAnswer` on both sides. Always false without an `openAnswer`
 * (easy-mode questions are graded through their options).
 */
export function isOpenAnswerCorrect(question: QuizQuestion, input: string): boolean {
  if (question.openAnswer === undefined) {
    return false
  }
  const normalized = normalizeQuizAnswer(input)
  return question.openAnswer.acceptedAnswers
    .map(normalizeQuizAnswer)
    .some((answer) => answer === normalized)
}

/**
 * Generate a deterministic quiz session for `molecules`.
 *
 * The same `seed` and config always produce byte-identical questions. Targets
 * are drawn from a shuffled queue that reshuffles when exhausted and never
 * repeats back-to-back; question types cycle through a freshly shuffled pool.
 *
 * When `"characteristic"` is requested but no characteristic definitions are
 * injected (or none qualifies), those slots are safely skipped: the type is
 * dropped from the requested pool, so a config that requests only that type
 * yields an empty session.
 */
export function generateQuizSession(
  molecules: QuizMolecule[],
  config: GenerateQuizConfig,
): QuizQuestion[] {
  if (molecules.length === 0 || config.questionCount <= 0) {
    return []
  }

  const rng = createSeededRandom(config.seed)
  const mirrorDecoys = config.mirrorDecoys !== false
  const classKeyOf = config.classKeyOf ?? defaultClassKeyOf
  const mode = config.mode ?? "easy"
  const available = availableQuizTypes(molecules, config.characteristics)
  const requested = [...new Set(config.types)].filter(
    (type) => available.includes(type) && isGeneratable(type, molecules, config.characteristics),
  )
  // Hard mode narrows the pool to written-answer types; an empty intersection
  // yields an empty session, exactly like a config with no generatable types.
  const wanted =
    mode === "hard" ? requested.filter((type) => HARD_MODE_QUIZ_TYPES.includes(type)) : requested
  if (wanted.length === 0) {
    return []
  }

  const questions: QuizQuestion[] = []
  let typePool: QuizQuestionType[] = []
  let targetPool: QuizMolecule[] = []
  let lastTargetId: string | null = null

  const nextType = (): QuizQuestionType => {
    if (typePool.length === 0) {
      typePool = shuffle(rng, wanted)
    }
    const type = typePool[0]
    typePool = typePool.slice(1)
    return type
  }

  const nextTarget = (): QuizMolecule => {
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
    const question = buildQuestion(
      molecules,
      target,
      type,
      rng,
      mirrorDecoys,
      classKeyOf,
      config.characteristics,
    )
    if (mode === "hard") {
      question.openAnswer = buildOpenAnswer(question, target)
    }
    lastTargetId = question.targetId
    questions.push(question)
  }

  return questions
}
