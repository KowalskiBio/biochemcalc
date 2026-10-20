import { describe, expect, it } from "vitest"
import {
  createSlugMaps,
  decide,
  planPush,
  recordCreated,
  recordFailed,
  recordPlanned,
  request,
  sameLibrary,
} from "../lib/biomolecule-sync.js"

const topic = (slug, name, extra = {}) => ({ slug, name, builtIn: false, ...extra })
const category = (slug, name, topicSlug, extra = {}) => ({
  slug,
  name,
  builtIn: false,
  moleculeCount: 0,
  topicSlug,
  ...extra,
})
const molecule = (id, categorySlug, name, extra = {}) => ({
  id,
  categorySlug,
  slug: name.toLowerCase(),
  name,
  smiles: "C",
  position: 0,
  haworth: true,
  traits: {},
  ...extra,
})

function library() {
  return {
    topics: [topic("aminokyseliny", "Aminokyseliny")],
    categories: [category("aminokyseliny", "Aminokyseliny", "aminokyseliny")],
    molecules: [
      molecule("m-ala", "aminokyseliny", "Alanin", { traits: { abbreviation: "Ala" } }),
      molecule("m-gly", "aminokyseliny", "Glycin"),
    ],
  }
}

const clone = (value) => structuredClone(value)

describe("planPush", () => {
  it("finds nothing to do when the library is unchanged", () => {
    const base = library()
    const local = clone(base)
    // Order, positions and counts are server-owned and never pushed.
    local.molecules.reverse()
    local.molecules[0].position = 9
    local.categories[0].moleculeCount = 99
    expect(planPush(base, local)).toEqual({ ops: [], unsupported: [] })
    expect(sameLibrary(base, local)).toBe(true)
  })

  it("orders creates parent-first and deletions last", () => {
    const base = library()
    const local = clone(base)
    local.topics.push(topic("lipidy", "Lipidy"))
    local.categories.push(category("mastne-kyseliny", "Mastné kyseliny", "lipidy"))
    local.molecules.push(molecule("m-new", "mastne-kyseliny", "Kyselina palmitová"))
    local.molecules = local.molecules.filter((m) => m.id !== "m-gly")
    local.molecules[0].smiles = "CC"

    const kinds = planPush(base, local).ops.map((op) => op.kind)
    expect(kinds).toEqual([
      "createTopic",
      "createCategory",
      "updateMolecule",
      "createMolecule",
      "deleteMolecule",
    ])
  })

  it("lets a category deletion take its molecules instead of deleting them one by one", () => {
    const base = library()
    const local = clone(base)
    local.categories = []
    local.molecules = []
    expect(planPush(base, local).ops.map((op) => op.kind)).toEqual(["deleteCategory"])
  })

  it("reports a molecule moved between categories as unsupported", () => {
    const base = library()
    base.categories.push(category("jine", "Jiné", null))
    const local = clone(base)
    local.molecules[0].categorySlug = "jine"
    const { ops, unsupported } = planPush(base, local)
    expect(ops).toEqual([])
    expect(unsupported).toHaveLength(1)
  })

  it("splits topic and category edits per field, as the API takes them", () => {
    const base = library()
    const local = clone(base)
    local.topics[0].description = "Nový popis"
    local.categories[0].name = "Proteinogenní aminokyseliny"
    local.categories[0].topicSlug = null
    expect(planPush(base, local).ops).toEqual([
      { kind: "updateTopic", slug: "aminokyseliny", field: "description", value: "Nový popis" },
      {
        kind: "updateCategory",
        slug: "aminokyseliny",
        field: "name",
        value: "Proteinogenní aminokyseliny",
      },
      { kind: "updateCategory", slug: "aminokyseliny", field: "topicSlug", value: null },
    ])
  })
})

describe("decide", () => {
  const onlyOp = (base, local) => {
    const { ops } = planPush(base, local)
    expect(ops).toHaveLength(1)
    return ops[0]
  }

  it("applies an edit when the site still matches the pull", () => {
    const base = library()
    const local = clone(base)
    local.molecules[0].traits.abbreviation = "A"
    const op = onlyOp(base, local)
    expect(decide(op, base, clone(base), createSlugMaps()).action).toBe("apply")
  })

  it("never overwrites an edit made on the site since the pull", () => {
    const base = library()
    const local = clone(base)
    local.molecules[0].smiles = "CC"
    const prod = clone(base)
    prod.molecules[0].name = "L-Alanin"
    expect(decide(onlyOp(base, local), base, prod, createSlugMaps()).action).toBe("conflict")
  })

  it("skips an edit that is already on the site (a re-run)", () => {
    const base = library()
    const local = clone(base)
    local.molecules[0].smiles = "CC"
    expect(decide(onlyOp(base, local), base, clone(local), createSlugMaps()).action).toBe("skip")
  })

  it("refuses to delete a category that gained molecules on the site", () => {
    const base = library()
    const local = clone(base)
    local.categories = []
    local.molecules = []
    const prod = clone(base)
    prod.molecules.push(molecule("m-ser", "aminokyseliny", "Serin"))
    expect(decide(onlyOp(base, local), base, prod, createSlugMaps()).action).toBe("conflict")
  })

  it("treats a molecule deleted on the site before our delete as done", () => {
    const base = library()
    const local = clone(base)
    local.molecules = local.molecules.filter((m) => m.id !== "m-gly")
    const prod = clone(local)
    expect(decide(onlyOp(base, local), base, prod, createSlugMaps()).action).toBe("skip")
  })

  it("holds back molecules whose new category could not be created", () => {
    const base = library()
    const local = clone(base)
    local.categories.push(category("nova", "Nová", null))
    local.molecules.push(molecule("m-new", "nova", "Nová molekula"))
    const [createCategory, createMolecule] = planPush(base, local).ops
    const maps = createSlugMaps()
    recordFailed(createCategory, maps)
    expect(decide(createMolecule, base, clone(base), maps).action).toBe("conflict")
  })
})

describe("slug mapping", () => {
  it("files new molecules under the slug the site gave their new category", () => {
    const base = library()
    const local = clone(base)
    local.categories.push(category("nova", "Nová", "aminokyseliny"))
    local.molecules.push(molecule("m-new", "nova", "Nová molekula"))
    const [createCategory, createMolecule] = planPush(base, local).ops

    const prodBefore = clone(base)
    const prodAfter = clone(base)
    prodAfter.categories.push(category("nova-2", "Nová", "aminokyseliny"))
    const maps = createSlugMaps()
    recordCreated(createCategory, prodBefore, prodAfter, maps)

    expect(decide(createMolecule, base, prodAfter, maps).action).toBe("apply")
    const [endpoint, body] = request(createMolecule, maps)
    expect(endpoint).toBe("create-molecule")
    expect(body.categoryId).toBe("nova-2")
  })

  it("previews what goes inside a new topic and category as ready", () => {
    const base = library()
    const local = clone(base)
    local.topics.push(topic("lipidy", "Lipidy"))
    local.categories.push(category("mastne-kyseliny", "Mastné kyseliny", "lipidy"))
    local.molecules.push(molecule("m-new", "mastne-kyseliny", "Kyselina palmitová"))
    const prod = clone(base)
    const maps = createSlugMaps()
    for (const op of planPush(base, local).ops) {
      expect(decide(op, base, prod, maps).action).toBe("apply")
      recordPlanned(op, maps)
    }
  })

  it("sends a cleared category topic as an absent value", () => {
    const base = library()
    const local = clone(base)
    local.categories[0].topicSlug = null
    const [op] = planPush(base, local).ops
    expect(request(op, createSlugMaps())).toEqual([
      "update-category-meta",
      { categoryId: "aminokyseliny", field: "topic", value: undefined },
    ])
  })
})
