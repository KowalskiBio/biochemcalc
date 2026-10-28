import { describe, expect, it } from "vitest"

import { computeDepictionBounds } from "@/components/ui/depiction-bounds"

/** Sizes land on ratios of non-binary caps, so compare at 9 decimals. */
function expectBounds(
  actual: { width: number; height: number },
  width: number,
  height: number,
) {
  expect(actual.width).toBeCloseTo(width, 9)
  expect(actual.height).toBeCloseTo(height, 9)
}

describe("computeDepictionBounds", () => {
  it("returns the size square in fixed mode regardless of viewBox and caps", () => {
    // Today's behavior: grids/previews stay uniform — even a huge molecule
    // with tiny caps keeps the plain square element.
    expectBounds(
      computeDepictionBounds({ vbw: 800, vbh: 400, size: 160, capW: 100, capH: 100, grow: false }),
      160,
      160,
    )
    expectBounds(
      computeDepictionBounds({ vbw: 20, vbh: 20, size: 140, capW: 640, capH: 560, grow: false }),
      140,
      140,
    )
  })

  it("keeps the shared natural scale for small molecules (no fill-square zoom)", () => {
    // The stated policy here is "every biomolecule, same bond pixels": a
    // molecule smaller than the square stays at its natural bond length —
    // the window never zooms small depictions up to fill a square.
    const square = computeDepictionBounds({
      vbw: 100,
      vbh: 100,
      size: 220,
      capW: 640,
      capH: 560,
      grow: true,
    })
    expectBounds(square, 100, 100)

    // Same natural scale for a non-square content box: both dims at k = 1.
    const wide = computeDepictionBounds({
      vbw: 100,
      vbh: 50,
      size: 220,
      capW: 640,
      capH: 560,
      grow: true,
    })
    expectBounds(wide, 100, 50)
  })

  it("draws big molecules at natural 1:1 size within the caps", () => {
    // s0 = 160/400 = 0.4 ≤ 1 and both caps fit (640/400, 560/400 > 1), so
    // k = 1: the element is the viewBox at natural bond length.
    expectBounds(
      computeDepictionBounds({ vbw: 400, vbh: 300, size: 160, capW: 640, capH: 560, grow: true }),
      400,
      300,
    )
  })

  it("shrinks uniformly onto the width cap beyond it, preserving aspect", () => {
    // acetyl-CoA shape: caps allow 0.8 in width and 1.4 in height, so the
    // width cap binds and both dims take k = 0.8.
    const bounds = computeDepictionBounds({
      vbw: 800,
      vbh: 400,
      size: 160,
      capW: 640,
      capH: 560,
      grow: true,
    })
    expectBounds(bounds, 640, 320)
    expect(bounds.width / bounds.height).toBeCloseTo(800 / 400, 9)
  })

  it("shrinks uniformly onto the height cap when the molecule is tall", () => {
    // Peptide shape: height cap binds at k = 400/800 = 0.5.
    const bounds = computeDepictionBounds({
      vbw: 400,
      vbh: 800,
      size: 160,
      capW: 640,
      capH: 400,
      grow: true,
    })
    expectBounds(bounds, 200, 400)
    expect(bounds.width / bounds.height).toBeCloseTo(400 / 800, 9)
  })

  it("bounds a 90°-rotated molecule with the dims swapped", () => {
    // Orientation acts on the layout coordinates, so the drawn viewBox
    // arrives pre-rotated: under symmetric caps the bounds swap exactly,
    // with no rotation special-casing in the math.
    const upright = computeDepictionBounds({
      vbw: 400,
      vbh: 800,
      size: 160,
      capW: 500,
      capH: 500,
      grow: true,
    })
    const rotated = computeDepictionBounds({
      vbw: 800,
      vbh: 400,
      size: 160,
      capW: 500,
      capH: 500,
      grow: true,
    })
    expectBounds(rotated, upright.height, upright.width)
  })

  it("lets the other cap bind when a rotated molecule meets asymmetric caps", () => {
    // Caps come from the viewport, not the molecule: rotated 90°, the tall
    // molecule bounded by height becomes a wide one bounded by width.
    expectBounds(
      computeDepictionBounds({ vbw: 800, vbh: 400, size: 160, capW: 640, capH: 400, grow: true }),
      640,
      320,
    )
  })

  it("stays 1:1 when the molecule lands exactly on a cap", () => {
    expectBounds(
      computeDepictionBounds({ vbw: 640, vbh: 320, size: 160, capW: 640, capH: 560, grow: true }),
      640,
      320,
    )
  })

  it("falls back to the size square for a degenerate viewBox", () => {
    expectBounds(
      computeDepictionBounds({ vbw: 0, vbh: 0, size: 180, capW: 640, capH: 560, grow: true }),
      180,
      180,
    )
    expectBounds(
      computeDepictionBounds({
        vbw: Number.NaN,
        vbh: 200,
        size: 180,
        capW: 640,
        capH: 560,
        grow: true,
      }),
      180,
      180,
    )
  })
})
