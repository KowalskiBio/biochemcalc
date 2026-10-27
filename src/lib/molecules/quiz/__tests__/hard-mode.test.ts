import { describe, expect, it } from "vitest"
import { type CategoryQuizConfig, getCategoryQuizConfig } from "@/lib/molecules/quiz/category-quiz"
import {
  ALL_QUIZ_TYPES,
  type CharacteristicDef,
  generatableQuizTypes,
  generateQuizSession,
  HARD_MODE_QUIZ_TYPES,
  isOpenAnswerCorrect,
  normalizeQuizAnswer,
  type QuizQuestion,
  type QuizQuestionType,
} from "@/lib/molecules/quiz/question-generator"
import { TEST_AMINO_ACIDS, TEST_NITROGEN_BASES } from "./fixtures"

const AMINO_ACIDS_SLUG = TEST_AMINO_ACIDS[0]?.categorySlug ?? "aminokyseliny"
const NITROGEN_BASES_SLUG = TEST_NITROGEN_BASES[0]?.categorySlug ?? "dusikate-baze"

function requireConfig(categoryId: string): CategoryQuizConfig {
  const config = getCategoryQuizConfig(categoryId, TEST_AMINO_ACIDS)
  if (config === undefined) {
    throw new Error(`No quiz config for category: ${categoryId}`)
  }
  return config
}

function requireCharacteristics(config: CategoryQuizConfig): CharacteristicDef[] {
  if (config.characteristics === undefined) {
    throw new Error("expected characteristic definitions")
  }
  return config.characteristics
}

const AMINO_ACIDS = requireConfig(AMINO_ACIDS_SLUG)
const NITROGEN_BASES = getCategoryQuizConfig(NITROGEN_BASES_SLUG, TEST_NITROGEN_BASES)
if (NITROGEN_BASES === undefined) {
  throw new Error("expected a quiz config for the nitrogen bases")
}
const AA_CHARACTERISTICS = requireCharacteristics(AMINO_ACIDS)

const HARD_TYPES: QuizQuestionType[] = [...HARD_MODE_QUIZ_TYPES]
const STRUCTURE_ANSWER_TYPES: QuizQuestionType[] = ["nameToStructure", "letterToStructure"]

/** A single-question hard-mode session of exactly `type`. */
function hardQuestion(type: QuizQuestionType, seed: number): QuizQuestion {
  const questions = generateQuizSession(AMINO_ACIDS.molecules, {
    types: [type],
    questionCount: 1,
    seed,
    characteristics: AA_CHARACTERISTICS,
    mode: "hard",
  })
  const question = questions[0]
  if (question === undefined) {
    throw new Error(`hard mode produced no ${type} question`)
  }
  return question
}

describe("HARD_MODE_QUIZ_TYPES", () => {
  it("lists exactly the written-answer types", () => {
    expect(HARD_TYPES).toEqual([
      "nameToLetter",
      "letterToName",
      "structureToName",
      "structureToLetter",
    ])
  })

  it("excludes the structure-as-answer types", () => {
    for (const type of STRUCTURE_ANSWER_TYPES) {
      expect(HARD_MODE_QUIZ_TYPES).not.toContain(type)
    }
  })
})

describe("generatableQuizTypes in hard mode", () => {
  it("intersects the generatable types with HARD_MODE_QUIZ_TYPES", () => {
    const easy = generatableQuizTypes(AMINO_ACIDS.molecules, AA_CHARACTERISTICS)
    const hard = generatableQuizTypes(AMINO_ACIDS.molecules, AA_CHARACTERISTICS, "hard")
    expect(hard).toEqual(easy.filter((type) => HARD_MODE_QUIZ_TYPES.includes(type)))
    expect(hard).not.toContain("nameToStructure")
    expect(hard).not.toContain("letterToStructure")
    expect(hard).not.toContain("characteristic")
  })

  it("defaults to easy when the mode is omitted", () => {
    const easy = generatableQuizTypes(AMINO_ACIDS.molecules, AA_CHARACTERISTICS)
    expect(easy).toContain("nameToStructure")
    expect(easy).toContain("letterToStructure")
  })

  it("yields an empty session when no requested type survives the intersection", () => {
    expect(
      generateQuizSession(AMINO_ACIDS.molecules, {
        types: STRUCTURE_ANSWER_TYPES,
        questionCount: 3,
        seed: 5,
        mode: "hard",
      }),
    ).toEqual([])
  })

  it("never emits a non-hard type and attaches an openAnswer to every question", () => {
    const questions = generateQuizSession(AMINO_ACIDS.molecules, {
      types: [...ALL_QUIZ_TYPES],
      questionCount: 40,
      seed: 17,
      characteristics: AA_CHARACTERISTICS,
      mode: "hard",
    })
    expect(questions).toHaveLength(40)
    for (const question of questions) {
      expect(HARD_MODE_QUIZ_TYPES).toContain(question.type)
      expect(question.openAnswer).toBeDefined()
    }
  })
})

describe("hard-mode openAnswer content", () => {
  it("accepts the target letter for nameToLetter and structureToLetter", () => {
    for (const type of ["nameToLetter", "structureToLetter"] as const) {
      for (let seed = 0; seed < 25; seed++) {
        const question = hardQuestion(type, seed)
        const target = AMINO_ACIDS.molecules.find((m) => m.id === question.targetId)
        if (target === undefined) {
          throw new Error(`unknown target: ${question.targetId}`)
        }
        expect(question.openAnswer).toEqual({
          kind: "letter",
          acceptedAnswers: [target.oneLetter],
        })
      }
    }
  })

  it("accepts the target name and aliases for letterToName and structureToName", () => {
    for (const type of ["letterToName", "structureToName"] as const) {
      for (let seed = 0; seed < 25; seed++) {
        const question = hardQuestion(type, seed)
        const target = AMINO_ACIDS.molecules.find((m) => m.id === question.targetId)
        if (target === undefined) {
          throw new Error(`unknown target: ${question.targetId}`)
        }
        expect(question.openAnswer).toEqual({
          kind: "name",
          acceptedAnswers: [target.name, ...(target.aliases ?? [])],
        })
      }
    }
  })
})

describe("polarity axis vs side-chain family", () => {
  function characteristicOf(predicate: string): CharacteristicDef {
    const def = AA_CHARACTERISTICS.find((d) => d.predicate === predicate)
    if (def === undefined) {
      throw new Error(`missing characteristic ${predicate}`)
    }
    return def
  }

  function quizMoleculeOf(slug: string) {
    const molecule = AMINO_ACIDS.molecules.find((candidate) => candidate.id === slug)
    if (molecule === undefined) {
      throw new Error(`unknown quiz molecule: ${slug}`)
    }
    return molecule
  }

  it("treats phenylalanine as nonpolar AND aromatic (the reported bug)", () => {
    const phe = quizMoleculeOf("phe")
    expect(characteristicOf("nonpolar").matches(phe), "Phe is hydrophobic").toBe(true)
    expect(characteristicOf("aromatic").matches(phe), "Phe is also aromatic").toBe(true)
  })

  it("keeps tyrosine out of nonpolar — the phenol –OH is hydrophilic", () => {
    const tyr = quizMoleculeOf("tyr")
    expect(characteristicOf("nonpolar").matches(tyr)).toBe(false)
    expect(characteristicOf("polar").matches(tyr)).toBe(true)
    expect(characteristicOf("aromatic").matches(tyr)).toBe(true)
  })

  it("counts tryptophan among nonpolar aromatics", () => {
    const trp = quizMoleculeOf("trp")
    expect(characteristicOf("nonpolar").matches(trp)).toBe(true)
    expect(characteristicOf("aromatic").matches(trp)).toBe(true)
  })

  it("does not let histidine masquerade as nonpolar", () => {
    const his = quizMoleculeOf("his")
    expect(characteristicOf("nonpolar").matches(his)).toBe(false)
    expect(characteristicOf("basic").matches(his)).toBe(true)
  })

  it("keeps classic nonpolar rows nonpolar and charged rows out", () => {
    for (const slug of ["gly", "ala", "val", "leu", "ile", "met", "pro", "cys"]) {
      expect(characteristicOf("nonpolar").matches(quizMoleculeOf(slug)), slug).toBe(true)
    }
    for (const slug of ["asp", "glu", "lys", "arg"]) {
      expect(characteristicOf("nonpolar").matches(quizMoleculeOf(slug)), slug).toBe(false)
    }
  })
})

describe("special amino acids (specialni-aminokyseliny)", () => {
  function specialRow(
    slug: string,
    name: string,
    smiles: string,
    traits: Record<string, string>,
  ): import("@/lib/biomolecules-api").Biomolecule {
    return {
      id: `specialni-aminokyseliny-${slug}`,
      categorySlug: "specialni-aminokyseliny",
      slug,
      name,
      smiles,
      traits,
      position: 0,
    }
  }

  const SPECIAL = [
    specialRow("sec", "Selenocystein", "N[C@@H](C[SeH])C(=O)O", {
      oneLetter: "U",
      abbreviation: "Sec",
      sideChain: "polar",
      polarity: "hydrophobic",
      charge: "neutral",
    }),
    specialRow("pyl", "Pyrrolysin", "N[C@@H](CCCCNC(=O)C1N=CCC(C)1)C(=O)O", {
      oneLetter: "O",
      abbreviation: "Pyl",
      sideChain: "basic",
      polarity: "hydrophilic",
      charge: "neutral",
    }),
  ]

  it("quizzes with letters and one form: sec is U, pyl is O", () => {
    const config = getCategoryQuizConfig("specialni-aminokyseliny", SPECIAL)
    expect(config).toBeDefined()
    if (config === undefined) return
    expect(config.molecules.find((m) => m.id === "sec")?.oneLetter).toBe("U")
    expect(config.molecules.find((m) => m.id === "pyl")?.oneLetter).toBe("O")
  })

  it("matches the polarity axis like the canonical acids (sec nonpolar, pyl polar)", () => {
    const config = getCategoryQuizConfig("specialni-aminokyseliny", SPECIAL)
    expect(config).toBeDefined()
    if (config === undefined) return
    const characteristics = requireCharacteristics(config)
    const sec = config.molecules.find((m) => m.id === "sec")
    const pyl = config.molecules.find((m) => m.id === "pyl")
    if (sec === undefined || pyl === undefined) return
    expect(
      characteristics.find((def) => def.predicate === "nonpolar")?.matches(sec),
      "selenocysteine mirrors cysteine on the polarity axis",
    ).toBe(true)
    expect(
      characteristics.find((def) => def.predicate === "nonpolar")?.matches(pyl),
      "pyrrolysine is hydrophilic like lysine",
    ).toBe(false)
  })
})

describe("aliases propagation", () => {
  /** Alanine carries a two-line `aliases` trait on top of its code. */
  function aliasedAminoAcids() {
    return TEST_AMINO_ACIDS.map((molecule) =>
      molecule.slug === "ala"
        ? {
            ...molecule,
            traits: {
              ...molecule.traits,
              aliases: "  Alfa  \n\n Aminokyselina alanin \n",
            },
          }
        : molecule,
    )
  }

  it("gives amino acids their three-letter code as an alias", () => {
    const alanine = AMINO_ACIDS.molecules.find((molecule) => molecule.id === "ala")
    expect(alanine?.aliases).toEqual(["Ala"])
    for (const molecule of AMINO_ACIDS.molecules) {
      expect(molecule.aliases).toHaveLength(1)
      expect((molecule.aliases?.[0] ?? "").length).toBeGreaterThan(1)
    }
  })

  it("gives nitrogen bases no aliases (their abbreviation is the single letter)", () => {
    for (const molecule of NITROGEN_BASES.molecules) {
      expect(molecule.aliases).toBeUndefined()
    }
  })

  it("appends aliases-trait names after the abbreviation alias", () => {
    const config = getCategoryQuizConfig(AMINO_ACIDS_SLUG, aliasedAminoAcids())
    if (config === undefined) {
      throw new Error("expected a quiz config for the amino acids")
    }
    const alanine = config.molecules.find((molecule) => molecule.id === "ala")
    expect(alanine?.aliases).toEqual(["Ala", "Alfa", "Aminokyselina alanin"])

    // Molecules without the trait keep exactly their abbreviation alias.
    const glycine = config.molecules.find((molecule) => molecule.id === "gly")
    expect(glycine?.aliases).toEqual(["Gly"])
  })

  it("accepts a trait alias for a name question", () => {
    const config = getCategoryQuizConfig(AMINO_ACIDS_SLUG, aliasedAminoAcids())
    if (config === undefined) {
      throw new Error("expected a quiz config for the amino acids")
    }
    let question: QuizQuestion | undefined
    for (let seed = 0; seed < 100; seed++) {
      const candidate = generateQuizSession(config.molecules, {
        types: ["structureToName"],
        questionCount: 1,
        seed,
        characteristics: config.characteristics,
        mode: "hard",
      })[0]
      if (candidate?.targetId === "ala") {
        question = candidate
        break
      }
    }
    if (question === undefined) {
      throw new Error("expected a hard-mode question targeting alanine")
    }
    expect(isOpenAnswerCorrect(question, "Aminokyselina alanin")).toBe(true)
    expect(isOpenAnswerCorrect(question, "alfa")).toBe(true)
    expect(isOpenAnswerCorrect(question, "Ala")).toBe(true)
  })
})

describe("normalizeQuizAnswer", () => {
  it("strips diacritics so accented and plain spellings match", () => {
    expect(normalizeQuizAnswer("Kyselina asparagová")).toBe(
      normalizeQuizAnswer("kyselina asparagova"),
    )
  })

  it("lowercases", () => {
    expect(normalizeQuizAnswer("ALANIN")).toBe("alanin")
  })

  it("trims and collapses inner whitespace", () => {
    expect(normalizeQuizAnswer("  Kyselina   asparagová  ")).toBe("kyselina asparagova")
  })
})

describe("isOpenAnswerCorrect", () => {
  const nameQuestion: QuizQuestion = {
    type: "letterToName",
    targetId: "asp",
    prompt: { kind: "letter", text: "D" },
    options: [],
    openAnswer: { kind: "name", acceptedAnswers: ["Kyselina asparagová", "Asp"] },
  }

  it("accepts the name, an alias, and diacritic/case variants", () => {
    expect(isOpenAnswerCorrect(nameQuestion, "Kyselina asparagová")).toBe(true)
    expect(isOpenAnswerCorrect(nameQuestion, "kyselina asparagova")).toBe(true)
    expect(isOpenAnswerCorrect(nameQuestion, "  KYSELINA   ASPARAGOVÁ ")).toBe(true)
    expect(isOpenAnswerCorrect(nameQuestion, "Asp")).toBe(true)
  })

  it("rejects a different molecule", () => {
    expect(isOpenAnswerCorrect(nameQuestion, "Kyselina glutamová")).toBe(false)
  })

  it("accepts the letter for a letter answer", () => {
    const letterQuestion: QuizQuestion = {
      ...nameQuestion,
      openAnswer: { kind: "letter", acceptedAnswers: ["D"] },
    }
    expect(isOpenAnswerCorrect(letterQuestion, "d")).toBe(true)
    expect(isOpenAnswerCorrect(letterQuestion, "E")).toBe(false)
  })

  it("returns false when there is no openAnswer", () => {
    const easyQuestion = generateQuizSession(AMINO_ACIDS.molecules, {
      types: ["nameToLetter"],
      questionCount: 1,
      seed: 2,
      characteristics: AA_CHARACTERISTICS,
    })[0]
    if (easyQuestion === undefined) {
      throw new Error("expected a question")
    }
    expect(easyQuestion.openAnswer).toBeUndefined()
    expect(isOpenAnswerCorrect(easyQuestion, "A")).toBe(false)
  })
})
