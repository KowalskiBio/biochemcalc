// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  data: vi.fn(),
  createTopic: vi.fn(),
  updateTopicMeta: vi.fn(),
  deleteTopic: vi.fn(),
  createCategory: vi.fn(),
  updateCategoryMeta: vi.fn(),
  deleteCategory: vi.fn(),
  createMolecule: vi.fn(),
  updateMolecule: vi.fn(),
  deleteMolecule: vi.fn(),
}))

vi.mock("@/lib/biomolecules-api", () => ({ biomoleculesApi: api }))

import { cs } from "@/i18n/cs"
import type { BiomoleculeData, BiomoleculeTopicInfo } from "@/lib/biomolecules-api"
import {
  useBiomoleculeDataStore,
  useMoleculeTopic,
  useMoleculeTopics,
  useTopicText,
} from "@/stores/biomolecule-data-store"

const AMINO_TOPIC: BiomoleculeTopicInfo = {
  slug: "aminokyseliny",
  name: "Aminokyseliny",
  description: "Proteinogenní aminokyseliny a jejich vlastnosti.",
  builtIn: true,
}

const CUSTOM_TOPIC: BiomoleculeTopicInfo = {
  slug: "vitaminy",
  name: "Vitamíny",
  description: "Ve vodě a v tucích rozpustné vitamíny.",
  builtIn: false,
}

function dataset(overrides: Partial<BiomoleculeData> = {}): BiomoleculeData {
  return { topics: [], categories: [], molecules: [], ...overrides }
}

beforeEach(() => {
  useBiomoleculeDataStore.setState({
    topics: [],
    categories: [],
    molecules: [],
    status: "idle",
  })
  vi.clearAllMocks()
})

describe("useBiomoleculeDataStore topics", () => {
  it("load() ingests the topics from the payload", async () => {
    api.data.mockResolvedValue(dataset({ topics: [AMINO_TOPIC, CUSTOM_TOPIC] }))

    await useBiomoleculeDataStore.getState().load()

    const state = useBiomoleculeDataStore.getState()
    expect(state.status).toBe("loaded")
    expect(state.topics).toEqual([AMINO_TOPIC, CUSTOM_TOPIC])
  })

  it("createTopic() replaces the whole dataset, topics included", async () => {
    const next = dataset({ topics: [CUSTOM_TOPIC] })
    api.createTopic.mockResolvedValue(next)

    const result = await useBiomoleculeDataStore.getState().createTopic("Vitamíny", "Popis")

    expect(api.createTopic).toHaveBeenCalledWith("Vitamíny", "Popis")
    expect(result).toBe(next)
    expect(useBiomoleculeDataStore.getState().topics).toEqual([CUSTOM_TOPIC])
  })

  it("updateTopicMeta() replaces the whole dataset, topics included", async () => {
    const renamed = { ...CUSTOM_TOPIC, name: "Vitaminy" }
    api.updateTopicMeta.mockResolvedValue(dataset({ topics: [renamed] }))

    await useBiomoleculeDataStore.getState().updateTopicMeta("vitaminy", "name", "Vitaminy")

    expect(api.updateTopicMeta).toHaveBeenCalledWith("vitaminy", "name", "Vitaminy")
    expect(useBiomoleculeDataStore.getState().topics).toEqual([renamed])
  })

  it("deleteTopic() replaces the whole dataset, topics included", async () => {
    api.deleteTopic.mockResolvedValue(dataset({ topics: [] }))

    await useBiomoleculeDataStore.getState().deleteTopic("vitaminy")

    expect(api.deleteTopic).toHaveBeenCalledWith("vitaminy")
    expect(useBiomoleculeDataStore.getState().topics).toEqual([])
  })

  it("category mutations also ingest topics and accept a topicId", async () => {
    const category = {
      slug: "vitamin-c",
      name: "Vitamin C",
      builtIn: false,
      moleculeCount: 0,
      topicSlug: "vitaminy",
    }
    api.createCategory.mockResolvedValue(
      dataset({ topics: [CUSTOM_TOPIC], categories: [category] }),
    )

    await useBiomoleculeDataStore.getState().createCategory("Vitamin C", null, "vitaminy")

    expect(api.createCategory).toHaveBeenCalledWith("Vitamin C", null, "vitaminy")
    const state = useBiomoleculeDataStore.getState()
    expect(state.topics).toEqual([CUSTOM_TOPIC])
    expect(state.categories).toEqual([category])
  })
})

describe("useBiomoleculeDataStore molecules", () => {
  const SMILES = "CN1C=NC2=C1C(=O)N(C)C(=O)N2C"

  it("createMolecule() forwards the haworth flag (true and false)", async () => {
    api.createMolecule.mockResolvedValue(dataset())
    const store = useBiomoleculeDataStore.getState()

    await store.createMolecule("vitamin-c", "Kofein", SMILES, {}, true)
    expect(api.createMolecule).toHaveBeenLastCalledWith(
      "vitamin-c",
      "Kofein",
      SMILES,
      {},
      undefined,
      true,
      undefined,
    )

    await store.createMolecule("vitamin-c", "Kofein", SMILES, {}, false)
    expect(api.createMolecule).toHaveBeenLastCalledWith(
      "vitamin-c",
      "Kofein",
      SMILES,
      {},
      undefined,
      false,
      undefined,
    )
  })

  it("createMolecule() forwards the fischer flag (true and false)", async () => {
    api.createMolecule.mockResolvedValue(dataset())
    const store = useBiomoleculeDataStore.getState()

    await store.createMolecule("vitamin-c", "Kofein", SMILES, {}, true, true)
    expect(api.createMolecule).toHaveBeenLastCalledWith(
      "vitamin-c",
      "Kofein",
      SMILES,
      {},
      undefined,
      true,
      true,
    )

    await store.createMolecule("vitamin-c", "Kofein", SMILES, {}, true, false)
    expect(api.createMolecule).toHaveBeenLastCalledWith(
      "vitamin-c",
      "Kofein",
      SMILES,
      {},
      undefined,
      true,
      false,
    )
  })

  it("updateMolecule() forwards the projection, the haworth flag and a move", async () => {
    api.updateMolecule.mockResolvedValue(dataset())
    const store = useBiomoleculeDataStore.getState()

    await store.updateMolecule("mol-1", "Kofein", SMILES, {}, "{}", true)
    expect(api.updateMolecule).toHaveBeenLastCalledWith(
      "mol-1",
      "Kofein",
      SMILES,
      {},
      "{}",
      true,
      undefined,
    )

    await store.updateMolecule("mol-1", "Kofein", SMILES, {}, null, false, "sacharidy")
    expect(api.updateMolecule).toHaveBeenLastCalledWith(
      "mol-1",
      "Kofein",
      SMILES,
      {},
      null,
      false,
      "sacharidy",
      undefined,
    )
  })

  it("updateMolecule() forwards the fischer flag", async () => {
    api.updateMolecule.mockResolvedValue(dataset())
    const store = useBiomoleculeDataStore.getState()

    await store.updateMolecule("mol-1", "Kofein", SMILES, {}, "{}", true, undefined, true)
    expect(api.updateMolecule).toHaveBeenLastCalledWith(
      "mol-1",
      "Kofein",
      SMILES,
      {},
      "{}",
      true,
      undefined,
      true,
    )

    await store.updateMolecule("mol-1", "Kofein", SMILES, {}, null, true, undefined, false)
    expect(api.updateMolecule).toHaveBeenLastCalledWith(
      "mol-1",
      "Kofein",
      SMILES,
      {},
      null,
      true,
      undefined,
      false,
    )
  })
})

let captured:
  | {
      topics: BiomoleculeTopicInfo[]
      topic: BiomoleculeTopicInfo | undefined
      name: string
      description: string
    }
  | undefined

function Probe({ slug }: { slug: string }) {
  const topics = useMoleculeTopics()
  const topic = useMoleculeTopic(slug)
  const { nameOf, descriptionOf } = useTopicText()
  captured = {
    topics,
    topic,
    name: nameOf(slug),
    description: descriptionOf(slug),
  }
  return null
}

describe("topic selectors", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // React only allows `act()` when this flag is set.
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    captured = undefined
  })

  function renderProbe(slug: string): void {
    act(() => root.render(createElement(Probe, { slug })))
  }

  it("falls back to the cs names and descriptions for the three built-in slugs", () => {
    useBiomoleculeDataStore.setState({ status: "loaded" })

    for (const [slug, copy] of Object.entries(cs.biomolekuly.topics)) {
      renderProbe(slug)
      expect(captured?.topic).toBeUndefined()
      expect(captured?.topics).toEqual([])
      expect(captured?.name).toBe(copy.name)
      expect(captured?.description).toBe(copy.description)
    }
  })

  it("returns DB values for custom topics and DB edits of built-ins", () => {
    const editedBuiltin = { ...AMINO_TOPIC, name: "Aminokyseliny (upravené)" }
    useBiomoleculeDataStore.setState({
      status: "loaded",
      topics: [editedBuiltin, CUSTOM_TOPIC],
    })

    renderProbe("aminokyseliny")
    expect(captured?.topic).toEqual(editedBuiltin)
    expect(captured?.topics).toHaveLength(2)
    expect(captured?.name).toBe("Aminokyseliny (upravené)")

    renderProbe("vitaminy")
    expect(captured?.topic).toEqual(CUSTOM_TOPIC)
    expect(captured?.name).toBe("Vitamíny")
    expect(captured?.description).toBe("Ve vodě a v tucích rozpustné vitamíny.")
  })
})
