import { describe, expect, it } from "vitest"
import { pointsBoundingCenter, transformPoints } from "@/lib/molecules/orientation"

/**
 * Four points on the unit axes, so the bounding-box center is the origin and
 * every result can be checked against a plain rotation matrix.
 */
const compass = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]

function expectPointsCloseTo(
  actual: { x: number; y: number }[],
  expected: { x: number; y: number }[],
) {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].x).toBeCloseTo(expected[i].x)
    expect(actual[i].y).toBeCloseTo(expected[i].y)
  }
}

describe("pointsBoundingCenter", () => {
  it("returns the axis-aligned bounding-box center", () => {
    const center = pointsBoundingCenter([
      { x: -2, y: 4 },
      { x: 6, y: 0 },
      { x: 1, y: 10 },
    ])
    expect(center).toEqual({ x: 2, y: 5 })
  })

  it("falls back to the origin for an empty input", () => {
    expect(pointsBoundingCenter([])).toEqual({ x: 0, y: 0 })
  })
})

describe("transformPoints", () => {
  it("keeps points unchanged (as copies) for the identity transform", () => {
    const result = transformPoints(compass, 0, false)
    expect(result).toEqual(compass)
    // New objects, not the same references.
    expect(result[0]).not.toBe(compass[0])
  })

  it("rotates 90 degrees counter-clockwise in the documented convention", () => {
    // (1, 0) -> (0, 1) at 90°; the whole set shifts one quarter turn.
    const result = transformPoints(compass, 90, false)
    expectPointsCloseTo(result, [
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ])
  })

  it("negates every point at 180 degrees", () => {
    const result = transformPoints(compass, 180, false)
    expectPointsCloseTo(
      result,
      compass.map((point) => ({ x: -point.x, y: -point.y })),
    )
  })

  it("makes 270 degrees the inverse of 90 degrees", () => {
    const rotated = transformPoints(transformPoints(compass, 90, false), 270, false)
    expectPointsCloseTo(rotated, compass)
  })

  it("mirrors x across the bounding-box center and keeps y", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]
    // bbox center is (2, 3) -> x' = 2*2 - x, y unchanged.
    const result = transformPoints(points, 0, true)
    expectPointsCloseTo(result, [
      { x: 3, y: 2 },
      { x: 1, y: 4 },
    ])
  })

  it("is an identity after a double mirror", () => {
    const once = transformPoints(compass, 0, true)
    const twice = transformPoints(once, 0, true)
    expectPointsCloseTo(twice, compass)
  })

  it("preserves the bounding-box center under rotation and mirroring", () => {
    const expected = pointsBoundingCenter(compass)
    for (const [deg, mirror] of [
      [90, false],
      [180, false],
      [270, false],
      [0, true],
    ] as const) {
      const center = pointsBoundingCenter(transformPoints(compass, deg, mirror))
      expect(center.x).toBeCloseTo(expected.x)
      expect(center.y).toBeCloseTo(expected.y)
    }
  })

  it("preserves the bounding-box extents of a square rotated by 90 degrees", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const rotated = transformPoints(square, 90, false)

    const center = pointsBoundingCenter(square)
    const rotatedCenter = pointsBoundingCenter(rotated)
    expect(rotatedCenter.x).toBeCloseTo(center.x)
    expect(rotatedCenter.y).toBeCloseTo(center.y)

    const xs = rotated.map((point) => point.x)
    const ys = rotated.map((point) => point.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4)
  })
})
