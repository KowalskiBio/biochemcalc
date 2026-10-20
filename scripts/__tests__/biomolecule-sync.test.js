import { describe, expect, it } from "vitest"
import {
  createSlugMaps,
  decide,
  planPush,
  recordCreated,
  recordFailed,
  recordPlanned,
  request,
} from "../lib/biomolecule-sync.js"

const topic = (slug, name, extra = {}) => ({
  slug,
  name,
  builtIn: false,
  updatedAt: "v1",
  ...extra,
})
const category = (slug, name, topicSlug, extra = {}) => ({
  slug,
  name,
  builtIn: false,
  moleculeCount: 0,
  topicSlug,
  updatedAt: "v1",
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
  updatedAt: "v1",
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
    // Positions, versions and counts are server-owned; only list order counts.
    local.molecules[0].position = 9
    local.molecules[0].updatedAt = "v2"
    local.categories[0].moleculeCount = 99
    expect(planPush(base, local)).toEqual({ ops: [] })
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

  it("pushes a molecule moved to another category as an update with the new category", () => {
    const base = library()
    base.categories.push(category("jine", "Jiné", null))
    const local = clone(base)
    local.molecules[0].categorySlug = "jine"
    const { ops } = planPush(base, local)
    expect(ops.map((op) => op.kind)).toEqual(["updateMolecule"])
    const [endpoint, body] = request(ops[0], base, clone(base), createSlugMaps())
    expect(endpoint).toBe("update-molecule")
    expect(body).toMatchObject({ moleculeId: "m-ala", categoryId: "jine", expectedUpdatedAt: "v1" })
  })

  it("reorders only when the order really changed, not when items were just added", () => {
    const base = library()
    const appended = clone(base)
    appended.molecules.push(molecule("m-new", "aminokyseliny", "Serin"))
    expect(planPush(base, appended).ops.map((op) => op.kind)).toEqual(["createMolecule"])

    const reordered = clone(base)
    reordered.molecules.reverse()
    const { ops } = planPush(base, reordered)
    expect(ops).toMatchObject([
      { kind: "reorderMolecules", slug: "aminokyseliny", order: ["m-gly", "m-ala"] },
    ])
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
    const [endpoint, body] = request(createMolecule, base, prodAfter, maps)
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
      recordPlanned(op, base, maps)
    }
  })

  it("sends a cleared category topic as an absent value", () => {
    const base = library()
    const local = clone(base)
    local.categories[0].topicSlug = null
    const [op] = planPush(base, local).ops
    expect(request(op, base, clone(base), createSlugMaps())).toEqual([
      "update-category-meta",
      { categoryId: "aminokyseliny", field: "topic", value: undefined, expectedUpdatedAt: "v1" },
    ])
  })
})

describe("versions and reorders", () => {
  it("bases a second edit of the same row on the version our first edit left", () => {
    const base = library()
    const local = clone(base)
    local.categories[0].name = "Nový název"
    local.categories[0].description = "Nový popis"
    const [rename, describeOp] = planPush(base, local).ops
    const maps = createSlugMaps()
    const after = clone(base)
    after.categories[0].name = "Nový název"
    after.categories[0].updatedAt = "v2"
    recordCreated(rename, base, after, maps)
    expect(request(describeOp, base, after, maps)[1].expectedUpdatedAt).toBe("v2")
  })

  it("deletes a category after moving a molecule out of it without a false conflict", () => {
    const base = library()
    base.categories.push(category("jine", "Jiné", null))
    const local = clone(base)
    local.molecules[0].categorySlug = "jine"
    local.categories = local.categories.filter((c) => c.slug !== "aminokyseliny")
    local.molecules = local.molecules.filter((m) => m.id !== "m-gly")
    const { ops } = planPush(base, local)
    expect(ops.map((op) => op.kind)).toEqual(["updateMolecule", "deleteCategory"])

    const maps = createSlugMaps()
    const afterMove = clone(base)
    afterMove.molecules[0].categorySlug = "jine"
    afterMove.molecules[0].updatedAt = "v2"
    recordCreated(ops[0], base, afterMove, maps)
    expect(decide(ops[1], base, afterMove, maps).action).toBe("apply")
    expect(request(ops[1], base, afterMove, maps)[1].expectedMolecules).toEqual({ "m-gly": "v1" })
  })

  it("refuses a reorder when the site was reordered since the pull", () => {
    const base = library()
    base.molecules.push(molecule("m-ser", "aminokyseliny", "Serin"))
    const byId = (data, ids) => ids.map((id) => data.molecules.find((m) => m.id === id))
    const local = clone(base)
    local.molecules = byId(base, ["m-ser", "m-ala", "m-gly"])
    const [op] = planPush(base, local).ops

    // Already in our order on the site, with a site-added molecule in between.
    const done = clone(local)
    done.molecules.splice(1, 0, molecule("m-x", "aminokyseliny", "Xanthin"))
    expect(decide(op, base, done, createSlugMaps()).action).toBe("skip")

    const reorderedOnSite = clone(base)
    reorderedOnSite.molecules = byId(base, ["m-gly", "m-ala", "m-ser"])
    expect(decide(op, base, reorderedOnSite, createSlugMaps()).action).toBe("conflict")
  })

  it("sends the full new order, keeps site-added items at the end and names the order it saw", () => {
    const base = library()
    const local = clone(base)
    local.molecules.reverse()
    const [op] = planPush(base, local).ops
    const prod = clone(base)
    prod.molecules.push(molecule("m-ser", "aminokyseliny", "Serin"))
    expect(decide(op, base, prod, createSlugMaps()).action).toBe("apply")
    expect(request(op, base, prod, createSlugMaps())).toEqual([
      "reorder-molecules",
      {
        categoryId: "aminokyseliny",
        ids: ["m-gly", "m-ala", "m-ser"],
        expectedOrder: ["m-ala", "m-gly", "m-ser"],
      },
    ])
  })
})
