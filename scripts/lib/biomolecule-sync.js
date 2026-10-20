// Pure planning for `npm run db:push-biomolecules` (no I/O — see
// scripts/db-push-biomolecules.js). Three copies of the Biomolekuly library,
// each in the `/api/biomolecules/data` shape:
//   base  — what the last `npm run db:pull` downloaded,
//   local — the developer's .local-dev database now,
//   prod  — the live site, re-read after every write.
// `planPush(base, local)` lists the developer's edits as API operations;
// `decide(op, ...)` checks one against prod right before it is sent, so an
// edit someone made on the site since the pull is reported, never overwritten.

const TOPIC_FIELDS = ["name", "description"]
const CATEGORY_FIELDS = ["name", "description", "topicSlug"]

const byKey = (items, key) => new Map(items.map((item) => [item[key], item]))
const norm = (value) => value ?? null

function sortedTraits(traits) {
  return Object.fromEntries(Object.entries(traits ?? {}).sort(([a], [b]) => a.localeCompare(b)))
}

/** The fields the API can write — position, slug and counts are server-owned. */
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

/**
 * Every local edit since `base`, as API operations in a safe order: topics
 * before the categories that use them, categories before their molecules,
 * deletions last. Edits the API can't express come back in `unsupported`.
 */
export function planPush(base, local) {
  const ops = []
  const unsupported = []

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
    } else if (before.categorySlug !== molecule.categorySlug) {
      unsupported.push(
        `Molecule "${molecule.name}" moved from category ${before.categorySlug} to ` +
          `${molecule.categorySlug} — the site can't move molecules; recreate it there instead.`,
      )
    } else if (!sameMolecule(before, molecule)) {
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

  return { ops, unsupported }
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
    default:
      return op.kind
  }
}

/**
 * Local slugs of topics/categories created by this push → the slugs the site
 * gave them (anything not in the map keeps its slug), plus the creates that
 * didn't happen and, in a preview, the ones that would.
 */
export function createSlugMaps() {
  return {
    topics: new Map(),
    categories: new Map(),
    failedTopics: new Set(),
    failedCategories: new Set(),
    plannedTopics: new Set(),
    plannedCategories: new Set(),
  }
}

const mapTopic = (maps, slug) => (slug == null ? null : (maps.topics.get(slug) ?? slug))
const mapCategory = (maps, slug) => maps.categories.get(slug) ?? slug

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

  switch (op.kind) {
    case "createTopic": {
      const existing = prod.topics.find((t) => t.name === op.name)
      if (existing) return skip(`a topic named "${op.name}" is already on the site`)
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
      if (
        op.topicSlug &&
        !prodTopics.has(mapTopic(maps, op.topicSlug)) &&
        !maps.plannedTopics.has(op.topicSlug)
      ) {
        return conflict(`its topic ${op.topicSlug} isn't on the site`)
      }
      const existing = prod.categories.find((c) => c.name === op.name)
      if (existing) return skip(`a category named "${op.name}" is already on the site`)
      return apply
    }
    case "updateCategory": {
      const now = prodCategories.get(op.slug)
      const before = base.categories.find((c) => c.slug === op.slug)
      if (!now) return conflict("the category was deleted on the site")
      const wanted = op.field === "topicSlug" ? mapTopic(maps, op.value) : op.value
      if (
        op.field === "topicSlug" &&
        wanted != null &&
        !prodTopics.has(wanted) &&
        !maps.plannedTopics.has(op.value)
      ) {
        return conflict(`topic ${op.value} isn't on the site`)
      }
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
      const inCategory = (data) =>
        data.molecules
          .filter((m) => m.categorySlug === op.slug)
          .map((m) => JSON.stringify({ id: m.id, ...moleculeContent(m) }))
          .sort()
          .join("\n")
      if (inCategory(prod) !== inCategory(base)) {
        return conflict("its molecules changed on the site — deleting it would lose that work")
      }
      return apply
    }
    case "createMolecule": {
      const local = op.molecule
      if (maps.failedCategories.has(local.categorySlug)) {
        return conflict(`its category ${local.categorySlug} wasn't created`)
      }
      const category = mapCategory(maps, local.categorySlug)
      if (maps.plannedCategories.has(local.categorySlug)) return apply
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
      if (!now) return conflict("the molecule was deleted on the site")
      if (sameMolecule(now, op.molecule)) return skip("already on the site")
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
    default:
      return conflict(`unknown operation ${op.kind}`)
  }
}

/** The `/api/biomolecules/*` call for `op`, with this push's new slugs applied. */
export function request(op, maps) {
  switch (op.kind) {
    case "createTopic":
      return ["create-topic", { name: op.name, description: op.description ?? undefined }]
    case "updateTopic":
      return [
        "update-topic-meta",
        { topicId: op.slug, field: op.field, value: op.value ?? undefined },
      ]
    case "deleteTopic":
      return ["delete-topic", { topicId: op.slug }]
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
        { categoryId: op.slug, field: isTopic ? "topic" : op.field, value: value ?? undefined },
      ]
    }
    case "deleteCategory":
      return ["delete-category", { categoryId: op.slug }]
    case "createMolecule":
    case "updateMolecule": {
      const m = op.molecule
      const content = {
        name: m.name,
        smiles: m.smiles,
        projection: m.projection ?? undefined,
        haworth: m.haworth,
        traits: m.traits ?? {},
      }
      return op.kind === "createMolecule"
        ? ["create-molecule", { categoryId: mapCategory(maps, m.categorySlug), ...content }]
        : ["update-molecule", { moleculeId: op.id, ...content }]
    }
    case "deleteMolecule":
      return ["delete-molecule", { moleculeId: op.id }]
    default:
      throw new Error(`unknown operation ${op.kind}`)
  }
}

/**
 * After a create (or a create skipped because it's already there), remember
 * which slug the site uses for it so later steps point at the right row.
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
  }
}

/** Preview only: treat `op`'s create as done, so what goes inside it reads as ready. */
export function recordPlanned(op, maps) {
  if (op.kind === "createTopic") maps.plannedTopics.add(op.slug)
  if (op.kind === "createCategory") maps.plannedCategories.add(op.slug)
}

/** A create that didn't happen: everything placed inside it must wait. */
export function recordFailed(op, maps) {
  if (op.kind === "createTopic") maps.failedTopics.add(op.slug)
  if (op.kind === "createCategory") maps.failedCategories.add(op.slug)
}

/** Whether two exports describe the same library (ignores order and counts). */
export function sameLibrary(a, b) {
  const { ops, unsupported } = planPush(a, b)
  return ops.length === 0 && unsupported.length === 0
}
