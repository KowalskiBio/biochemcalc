// Pure planning for `npm run db:push-biomolecules` (no I/O — see
// scripts/db-push-biomolecules.js). Three copies of the Biomolekuly library,
// each in the `/api/biomolecules/data` shape:
//   base  — what the last `npm run db:pull` downloaded,
//   local — the developer's .local-dev database now,
//   prod  — the live site, re-read after every write.
// `planPush(base, local)` lists the developer's edits as API operations;
// `decide(op, ...)` checks one against prod right before it is sent, so an
// edit someone made on the site since the pull is reported, never overwritten.
// `request(op, ...)` also names the row versions the edit was based on, so the
// server itself refuses a write that races a change made a moment earlier.

const TOPIC_FIELDS = ["name", "description"]
const CATEGORY_FIELDS = ["name", "description", "topicSlug"]

const byKey = (items, key) => new Map(items.map((item) => [item[key], item]))
const norm = (value) => value ?? null
const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i])

function sortedTraits(traits) {
  return Object.fromEntries(Object.entries(traits ?? {}).sort(([a], [b]) => a.localeCompare(b)))
}

/** The fields the API can write — slug and counts are server-owned. */
function moleculeContent(m) {
  return {
    categorySlug: m.categorySlug,
    name: m.name,
    smiles: m.smiles,
    projection: norm(m.projection),
    haworth: m.haworth,
    traits: sortedTraits(m.traits),
  }
}

const sameMolecule = (a, b) =>
  JSON.stringify(moleculeContent(a)) === JSON.stringify(moleculeContent(b))

const moleculeIdsIn = (data, categorySlug) =>
  data.molecules.filter((m) => m.categorySlug === categorySlug).map((m) => m.id)

/**
 * What an ordered list looks like after this push's creates and deletions if
 * nobody reorders it: survivors keep their order, newcomers go to the end.
 */
function naturalOrder(baseIds, localIds) {
  const local = new Set(localIds)
  const base = new Set(baseIds)
  return [...baseIds.filter((id) => local.has(id)), ...localIds.filter((id) => !base.has(id))]
}

/**
 * Every local edit since `base`, as API operations in a safe order: topics
 * before the categories that use them, categories before their molecules,
 * deletions after that, and reorders last, once every item is in place.
 */
export function planPush(base, local) {
  const ops = []

  const baseTopics = byKey(base.topics, "slug")
  const localTopics = byKey(local.topics, "slug")
  const baseCategories = byKey(base.categories, "slug")
  const localCategories = byKey(local.categories, "slug")
  const baseMolecules = byKey(base.molecules, "id")
  const localMolecules = byKey(local.molecules, "id")

  for (const topic of local.topics) {
    const before = baseTopics.get(topic.slug)
    if (!before) {
      ops.push({
        kind: "createTopic",
        slug: topic.slug,
        name: topic.name,
        description: norm(topic.description),
      })
      continue
    }
    for (const field of TOPIC_FIELDS) {
      if (norm(before[field]) !== norm(topic[field])) {
        ops.push({ kind: "updateTopic", slug: topic.slug, field, value: norm(topic[field]) })
      }
    }
  }

  for (const category of local.categories) {
    const before = baseCategories.get(category.slug)
    if (!before) {
      ops.push({
        kind: "createCategory",
        slug: category.slug,
        name: category.name,
        description: norm(category.description),
        topicSlug: norm(category.topicSlug),
      })
      continue
    }
    for (const field of CATEGORY_FIELDS) {
      if (norm(before[field]) !== norm(category[field])) {
        ops.push({
          kind: "updateCategory",
          slug: category.slug,
          field,
          value: norm(category[field]),
        })
      }
    }
  }

  for (const molecule of local.molecules) {
    const before = baseMolecules.get(molecule.id)
    if (!before) {
      ops.push({ kind: "createMolecule", id: molecule.id, molecule })
    } else if (!sameMolecule(before, molecule)) {
      // Covers a move to another category too (`categorySlug` differs).
      ops.push({ kind: "updateMolecule", id: molecule.id, molecule })
    }
  }

  for (const molecule of base.molecules) {
    // A deleted category takes its molecules with it (FK cascade).
    if (!localMolecules.has(molecule.id) && localCategories.has(molecule.categorySlug)) {
      ops.push({ kind: "deleteMolecule", id: molecule.id, name: molecule.name })
    }
  }
  for (const category of base.categories) {
    if (!localCategories.has(category.slug)) {
      ops.push({ kind: "deleteCategory", slug: category.slug, name: category.name })
    }
  }
  for (const topic of base.topics) {
    if (!localTopics.has(topic.slug)) {
      ops.push({ kind: "deleteTopic", slug: topic.slug, name: topic.name })
    }
  }

  const topicOrder = local.topics.map((t) => t.slug)
  const baseTopicOrder = base.topics.map((t) => t.slug)
  if (!sameList(topicOrder, naturalOrder(baseTopicOrder, topicOrder))) {
    ops.push({ kind: "reorderTopics", order: topicOrder, baseOrder: baseTopicOrder })
  }
  const categoryOrder = local.categories.map((c) => c.slug)
  const baseCategoryOrder = base.categories.map((c) => c.slug)
  if (!sameList(categoryOrder, naturalOrder(baseCategoryOrder, categoryOrder))) {
    ops.push({ kind: "reorderCategories", order: categoryOrder, baseOrder: baseCategoryOrder })
  }
  for (const category of local.categories) {
    const order = moleculeIdsIn(local, category.slug)
    const baseOrder = moleculeIdsIn(base, category.slug)
    if (!sameList(order, naturalOrder(baseOrder, order))) {
      ops.push({
        kind: "reorderMolecules",
        slug: category.slug,
        name: category.name,
        order,
        baseOrder,
      })
    }
  }

  return { ops }
}

/** One-line human description of an operation, for the preview. */
export function describe(op) {
  switch (op.kind) {
    case "createTopic":
      return `+ topic "${op.name}"`
    case "updateTopic":
      return `~ topic ${op.slug}: ${op.field} → ${JSON.stringify(op.value)}`
    case "deleteTopic":
      return `- topic "${op.name}" (its categories stay, ungrouped)`
    case "createCategory":
      return `+ category "${op.name}"${op.topicSlug ? ` in topic ${op.topicSlug}` : ""}`
    case "updateCategory":
      return `~ category ${op.slug}: ${op.field} → ${JSON.stringify(op.value)}`
    case "deleteCategory":
      return `- category "${op.name}" WITH ALL ITS MOLECULES`
    case "createMolecule":
      return `+ molecule "${op.molecule.name}" in ${op.molecule.categorySlug}`
    case "updateMolecule":
      return `~ molecule "${op.molecule.name}" (${op.molecule.categorySlug})`
    case "deleteMolecule":
      return `- molecule "${op.name}"`
    case "reorderTopics":
      return "↕ topic order"
    case "reorderCategories":
      return "↕ category order"
    case "reorderMolecules":
      return `↕ molecule order in "${op.name}"`
    default:
      return op.kind
  }
}

/**
 * What this push has done so far: the slugs/ids the site gave new rows, the
 * creates that didn't happen (and, in a preview, those that would), the row
 * versions after our own writes, and molecules we took out of a category.
 */
export function createSlugMaps() {
  return {
    topics: new Map(),
    categories: new Map(),
    molecules: new Map(),
    failedTopics: new Set(),
    failedCategories: new Set(),
    plannedTopics: new Set(),
    plannedCategories: new Set(),
    versions: new Map(),
    leftCategory: new Set(),
  }
}

const mapTopic = (maps, slug) => (slug == null ? null : (maps.topics.get(slug) ?? slug))
const mapCategory = (maps, slug) => maps.categories.get(slug) ?? slug
const mapMolecule = (maps, id) => maps.molecules.get(id) ?? id

/** The version our write should be based on: ours if we wrote it, else the pull's. */
function versionOf(maps, key, baseRow) {
  return maps.versions.get(key) ?? baseRow?.updatedAt
}

/** The molecules a category should hold now: the pull's, minus what we took out. */
function expectedCategoryMolecules(base, maps, slug) {
  return base.molecules.filter((m) => m.categorySlug === slug && !maps.leftCategory.has(m.id))
}

/**
 * Whether `order` (a reorder op) can go out against `prod`, and the full list
 * to send. Items someone else added on the site keep their place at the end.
 */
function plannedOrder(op, prodOrder, map) {
  const present = new Set(prodOrder)
  const wanted = op.order.map(map).filter((id) => present.has(id))
  const wantedSet = new Set(wanted)
  const full = [...wanted, ...prodOrder.filter((id) => !wantedSet.has(id))]
  // Our items already stand in our order (wherever site-added ones sit).
  const done = sameList(
    prodOrder.filter((id) => wantedSet.has(id)),
    wanted,
  )
  // Items that existed at the pull must still be in the pull's relative order.
  const fromBase = new Set(op.baseOrder.map(map))
  const prodBase = prodOrder.filter((id) => fromBase.has(id))
  const baseStill = op.baseOrder.map(map).filter((id) => present.has(id))
  return { full, done, reorderedOnSite: !sameList(prodBase, baseStill) }
}

function prodOrderFor(op, prod, maps) {
  if (op.kind === "reorderTopics") return prod.topics.map((t) => t.slug)
  if (op.kind === "reorderCategories") return prod.categories.map((c) => c.slug)
  return moleculeIdsIn(prod, mapCategory(maps, op.slug))
}

function orderMapper(op, maps) {
  if (op.kind === "reorderTopics") return (slug) => mapTopic(maps, slug)
  if (op.kind === "reorderCategories") return (slug) => mapCategory(maps, slug)
  return (id) => mapMolecule(maps, id)
}

/**
 * Whether `op` can go out against the live library `prod` now:
 *   { action: "apply" }               — prod still matches the pull; send it,
 *   { action: "skip", reason }        — already on the site (a re-run), or
 *   { action: "conflict", reason }    — someone changed it on the site since
 *                                       the pull (or it depends on a step that
 *                                       didn't go through); left alone.
 */
export function decide(op, base, prod, maps) {
  const prodTopics = byKey(prod.topics, "slug")
  const prodCategories = byKey(prod.categories, "slug")
  const prodMolecules = byKey(prod.molecules, "id")
  const apply = { action: "apply" }
  const skip = (reason) => ({ action: "skip", reason })
  const conflict = (reason) => ({ action: "conflict", reason })
  const topicReachable = (slug) =>
    slug == null || prodTopics.has(mapTopic(maps, slug)) || maps.plannedTopics.has(slug)
  const categoryReachable = (slug) =>
    prodCategories.has(mapCategory(maps, slug)) || maps.plannedCategories.has(slug)

  switch (op.kind) {
    case "createTopic": {
      if (prod.topics.some((t) => t.name === op.name)) {
        return skip(`a topic named "${op.name}" is already on the site`)
      }
      return apply
    }
    case "updateTopic": {
      const now = prodTopics.get(op.slug)
      const before = base.topics.find((t) => t.slug === op.slug)
      if (!now) return conflict("the topic was deleted on the site")
      if (norm(now[op.field]) === op.value) return skip("already on the site")
      if (norm(now[op.field]) !== norm(before[op.field])) {
        return conflict(`changed on the site to ${JSON.stringify(norm(now[op.field]))}`)
      }
      return apply
    }
    case "deleteTopic": {
      const now = prodTopics.get(op.slug)
      const before = base.topics.find((t) => t.slug === op.slug)
      if (!now) return skip("already gone from the site")
      if (TOPIC_FIELDS.some((f) => norm(now[f]) !== norm(before[f]))) {
        return conflict("the topic was edited on the site")
      }
      return apply
    }
    case "createCategory": {
      if (op.topicSlug && maps.failedTopics.has(op.topicSlug)) {
        return conflict(`its topic ${op.topicSlug} wasn't created`)
      }
      if (!topicReachable(op.topicSlug)) {
        return conflict(`its topic ${op.topicSlug} isn't on the site`)
      }
      if (prod.categories.some((c) => c.name === op.name)) {
        return skip(`a category named "${op.name}" is already on the site`)
      }
      return apply
    }
    case "updateCategory": {
      const now = prodCategories.get(op.slug)
      const before = base.categories.find((c) => c.slug === op.slug)
      if (!now) return conflict("the category was deleted on the site")
      const isTopic = op.field === "topicSlug"
      if (isTopic && maps.failedTopics.has(op.value)) {
        return conflict(`topic ${op.value} wasn't created`)
      }
      if (isTopic && !topicReachable(op.value))
        return conflict(`topic ${op.value} isn't on the site`)
      const wanted = isTopic ? mapTopic(maps, op.value) : op.value
      if (norm(now[op.field]) === wanted) return skip("already on the site")
      if (norm(now[op.field]) !== norm(before[op.field])) {
        return conflict(`changed on the site to ${JSON.stringify(norm(now[op.field]))}`)
      }
      return apply
    }
    case "deleteCategory": {
      const now = prodCategories.get(op.slug)
      const before = base.categories.find((c) => c.slug === op.slug)
      if (!now) return skip("already gone from the site")
      if (CATEGORY_FIELDS.some((f) => norm(now[f]) !== norm(before[f]))) {
        return conflict("the category was edited on the site")
      }
      const fingerprint = (molecules) =>
        molecules
          .map((m) => JSON.stringify({ id: m.id, ...moleculeContent(m) }))
          .sort()
          .join("\n")
      const onSite = prod.molecules.filter((m) => m.categorySlug === op.slug)
      if (fingerprint(onSite) !== fingerprint(expectedCategoryMolecules(base, maps, op.slug))) {
        return conflict("its molecules changed on the site — deleting it would lose that work")
      }
      return apply
    }
    case "createMolecule": {
      const local = op.molecule
      if (maps.failedCategories.has(local.categorySlug)) {
        return conflict(`its category ${local.categorySlug} wasn't created`)
      }
      if (maps.plannedCategories.has(local.categorySlug)) return apply
      const category = mapCategory(maps, local.categorySlug)
      if (!prodCategories.has(category)) {
        return conflict(`its category ${local.categorySlug} isn't on the site`)
      }
      const existing = prod.molecules.find(
        (m) => m.categorySlug === category && m.name === local.name,
      )
      if (existing) {
        return sameMolecule(existing, { ...local, categorySlug: category })
          ? skip("already on the site")
          : conflict(`a different molecule named "${local.name}" is already in that category`)
      }
      return apply
    }
    case "updateMolecule": {
      const now = prodMolecules.get(op.id)
      const before = base.molecules.find((m) => m.id === op.id)
      const target = op.molecule.categorySlug
      if (!now) return conflict("the molecule was deleted on the site")
      if (maps.failedCategories.has(target)) return conflict(`category ${target} wasn't created`)
      if (!categoryReachable(target)) return conflict(`category ${target} isn't on the site`)
      if (sameMolecule(now, { ...op.molecule, categorySlug: mapCategory(maps, target) })) {
        return skip("already on the site")
      }
      if (!sameMolecule(now, before)) return conflict("the molecule was edited on the site")
      return apply
    }
    case "deleteMolecule": {
      const now = prodMolecules.get(op.id)
      const before = base.molecules.find((m) => m.id === op.id)
      if (!now) return skip("already gone from the site")
      if (!sameMolecule(now, before)) return conflict("the molecule was edited on the site")
      return apply
    }
    case "reorderTopics":
    case "reorderCategories":
    case "reorderMolecules": {
      if (op.kind === "reorderMolecules" && !categoryReachable(op.slug)) {
        return conflict(`category ${op.slug} isn't on the site`)
      }
      const prodOrder = prodOrderFor(op, prod, maps)
      const { done, reorderedOnSite } = plannedOrder(op, prodOrder, orderMapper(op, maps))
      if (done) return skip("already in this order on the site")
      if (reorderedOnSite) return conflict("the order was changed on the site")
      return apply
    }
    default:
      return conflict(`unknown operation ${op.kind}`)
  }
}

/**
 * The `/api/biomolecules/*` call for `op` against `prod`, with this push's new
 * slugs applied and the versions the edit is based on, so the server refuses
 * it if the row changed after `decide` looked.
 */
export function request(op, base, prod, maps) {
  const baseTopic = (slug) => base.topics.find((t) => t.slug === slug)
  const baseCategory = (slug) => base.categories.find((c) => c.slug === slug)
  const baseMolecule = (id) => base.molecules.find((m) => m.id === id)

  switch (op.kind) {
    case "createTopic":
      return ["create-topic", { name: op.name, description: op.description ?? undefined }]
    case "updateTopic":
      return [
        "update-topic-meta",
        {
          topicId: op.slug,
          field: op.field,
          value: op.value ?? undefined,
          expectedUpdatedAt: versionOf(maps, `topic:${op.slug}`, baseTopic(op.slug)),
        },
      ]
    case "deleteTopic":
      return [
        "delete-topic",
        {
          topicId: op.slug,
          expectedUpdatedAt: versionOf(maps, `topic:${op.slug}`, baseTopic(op.slug)),
        },
      ]
    case "createCategory":
      return [
        "create-category",
        {
          name: op.name,
          description: op.description ?? undefined,
          topicId: mapTopic(maps, op.topicSlug) ?? undefined,
        },
      ]
    case "updateCategory": {
      const isTopic = op.field === "topicSlug"
      const value = isTopic ? mapTopic(maps, op.value) : op.value
      return [
        "update-category-meta",
        {
          categoryId: op.slug,
          field: isTopic ? "topic" : op.field,
          value: value ?? undefined,
          expectedUpdatedAt: versionOf(maps, `category:${op.slug}`, baseCategory(op.slug)),
        },
      ]
    }
    case "deleteCategory":
      return [
        "delete-category",
        {
          categoryId: op.slug,
          expectedUpdatedAt: versionOf(maps, `category:${op.slug}`, baseCategory(op.slug)),
          expectedMolecules: Object.fromEntries(
            expectedCategoryMolecules(base, maps, op.slug).map((m) => [
              m.id,
              versionOf(maps, `molecule:${m.id}`, m),
            ]),
          ),
        },
      ]
    case "createMolecule":
    case "updateMolecule": {
      const m = op.molecule
      const content = {
        name: m.name,
        smiles: m.smiles,
        projection: m.projection ?? undefined,
        haworth: m.haworth,
        traits: m.traits ?? {},
        categoryId: mapCategory(maps, m.categorySlug),
      }
      return op.kind === "createMolecule"
        ? ["create-molecule", content]
        : [
            "update-molecule",
            {
              moleculeId: op.id,
              ...content,
              expectedUpdatedAt: versionOf(maps, `molecule:${op.id}`, baseMolecule(op.id)),
            },
          ]
    }
    case "deleteMolecule":
      return [
        "delete-molecule",
        {
          moleculeId: op.id,
          expectedUpdatedAt: versionOf(maps, `molecule:${op.id}`, baseMolecule(op.id)),
        },
      ]
    case "reorderTopics":
    case "reorderCategories":
    case "reorderMolecules": {
      const prodOrder = prodOrderFor(op, prod, maps)
      const { full } = plannedOrder(op, prodOrder, orderMapper(op, maps))
      if (op.kind === "reorderTopics") {
        return ["reorder-topics", { slugs: full, expectedOrder: prodOrder }]
      }
      if (op.kind === "reorderCategories") {
        return ["reorder-categories", { slugs: full, expectedOrder: prodOrder }]
      }
      return [
        "reorder-molecules",
        { categoryId: mapCategory(maps, op.slug), ids: full, expectedOrder: prodOrder },
      ]
    }
    default:
      throw new Error(`unknown operation ${op.kind}`)
  }
}

/**
 * After a write (or a create skipped because it's already there): remember
 * the slug/id the site uses for a new row, the version our write left behind,
 * and molecules that left their category.
 */
export function recordCreated(op, prodBefore, prodAfter, maps) {
  if (op.kind === "createTopic") {
    const known = new Set(prodBefore.topics.map((t) => t.slug))
    const made =
      prodAfter.topics.find((t) => !known.has(t.slug) && t.name === op.name) ??
      prodAfter.topics.find((t) => t.name === op.name)
    if (made) maps.topics.set(op.slug, made.slug)
  } else if (op.kind === "createCategory") {
    const known = new Set(prodBefore.categories.map((c) => c.slug))
    const made =
      prodAfter.categories.find((c) => !known.has(c.slug) && c.name === op.name) ??
      prodAfter.categories.find((c) => c.name === op.name)
    if (made) maps.categories.set(op.slug, made.slug)
  } else if (op.kind === "createMolecule") {
    const category = mapCategory(maps, op.molecule.categorySlug)
    const made = prodAfter.molecules.find(
      (m) => m.categorySlug === category && m.name === op.molecule.name,
    )
    if (made) maps.molecules.set(op.id, made.id)
  } else if (op.kind === "updateTopic") {
    const row = prodAfter.topics.find((t) => t.slug === op.slug)
    if (row) maps.versions.set(`topic:${op.slug}`, row.updatedAt)
  } else if (op.kind === "updateCategory") {
    const row = prodAfter.categories.find((c) => c.slug === op.slug)
    if (row) maps.versions.set(`category:${op.slug}`, row.updatedAt)
  } else if (op.kind === "updateMolecule") {
    const row = prodAfter.molecules.find((m) => m.id === op.id)
    if (row) maps.versions.set(`molecule:${op.id}`, row.updatedAt)
    const before = prodBefore.molecules.find((m) => m.id === op.id)
    if (row && before && row.categorySlug !== before.categorySlug) maps.leftCategory.add(op.id)
  } else if (op.kind === "deleteMolecule") {
    maps.leftCategory.add(op.id)
  }
}

/** Preview only: treat `op` as done, so what depends on it reads as ready. */
export function recordPlanned(op, base, maps) {
  if (op.kind === "createTopic") maps.plannedTopics.add(op.slug)
  if (op.kind === "createCategory") maps.plannedCategories.add(op.slug)
  if (op.kind === "deleteMolecule") maps.leftCategory.add(op.id)
  if (op.kind === "updateMolecule") {
    const before = base.molecules.find((m) => m.id === op.id)
    if (before && before.categorySlug !== op.molecule.categorySlug) maps.leftCategory.add(op.id)
  }
}

/** A create that didn't happen: everything placed inside it must wait. */
export function recordFailed(op, maps) {
  if (op.kind === "createTopic") maps.failedTopics.add(op.slug)
  if (op.kind === "createCategory") maps.failedCategories.add(op.slug)
}
