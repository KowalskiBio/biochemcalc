import { beforeEach, describe, expect, it } from "vitest"
import { useDatabazeStore } from "@/stores/databaze-store"

beforeEach(() => {
  useDatabazeStore.setState({ entries: [] })
})

describe("useDatabazeStore", () => {
  it("adds a new entry", () => {
    useDatabazeStore.getState().addEntry({ code: "X", values: ["a", "b"] })

    const entries = useDatabazeStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].code).toBe("X")
    expect(entries[0].values).toEqual(["a", "b"])
  })

  it("updates an existing entry by id", () => {
    useDatabazeStore.getState().addEntry({ code: "X", values: ["a"] })
    const id = useDatabazeStore.getState().entries[0].id

    useDatabazeStore.getState().updateEntry(id, { values: ["a", "b", "c"] })

    expect(useDatabazeStore.getState().entries[0].values).toEqual(["a", "b", "c"])
  })

  it("deletes an entry by id", () => {
    useDatabazeStore.getState().addEntry({ code: "X", values: ["a"] })
    const id = useDatabazeStore.getState().entries[0].id

    useDatabazeStore.getState().deleteEntry(id)

    expect(useDatabazeStore.getState().entries).toHaveLength(0)
  })

  it("resets to default seed entries", () => {
    useDatabazeStore.getState().addEntry({ code: "X", values: ["a"] })

    useDatabazeStore.getState().resetToDefaults()

    const entries = useDatabazeStore.getState().entries
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.code === "K")).toBe(true)
  })
})
