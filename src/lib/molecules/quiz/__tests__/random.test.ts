import { describe, expect, it } from "vitest"
import { createSeededRandom, pick, randomInt, shuffle } from "@/lib/molecules/quiz/random"

describe("createSeededRandom", () => {
  it("is deterministic for a given seed", () => {
    const first = createSeededRandom(42)
    const second = createSeededRandom(42)
    for (let i = 0; i < 50; i++) {
      expect(first()).toBe(second())
    }
  })

  it("produces different streams for different seeds", () => {
    const first = createSeededRandom(1)
    const second = createSeededRandom(2)
    const fromFirst = Array.from({ length: 10 }, () => first())
    const fromSecond = Array.from({ length: 10 }, () => second())
    expect(fromFirst).not.toEqual(fromSecond)
  })

  it("stays within [0, 1)", () => {
    const rng = createSeededRandom(7)
    for (let i = 0; i < 1000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe("randomInt", () => {
  it("returns integers within the half-open range", () => {
    const rng = createSeededRandom(3)
    for (let i = 0; i < 500; i++) {
      const value = randomInt(rng, -5, 5)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(-5)
      expect(value).toBeLessThan(5)
    }
  })

  it("throws on an empty range", () => {
    expect(() => randomInt(createSeededRandom(0), 4, 4)).toThrow()
  })
})

describe("pick and shuffle", () => {
  it("pick returns an element of the array", () => {
    const rng = createSeededRandom(11)
    const items = ["a", "b", "c"]
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(pick(rng, items))
    }
  })

  it("shuffle keeps the same elements, is deterministic, and does not mutate", () => {
    const items = [1, 2, 3, 4, 5, 6]
    const first = shuffle(createSeededRandom(9), items)
    const second = shuffle(createSeededRandom(9), items)
    expect(first).toEqual(second)
    expect([...first].sort((x, y) => x - y)).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5, 6])
  })
})
