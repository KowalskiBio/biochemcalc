import { useEffect, useRef, useState } from "react"
import SmilesDrawer from "smiles-drawer"

import { type Point, transformPoints } from "@/lib/molecules/orientation"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/ui-store"

export interface StructureViewProps {
  smiles: string
  /** Square canvas side length in px. */
  size?: number
  /**
   * Rotation of the 2D layout, in degrees. Applied to the coordinates before
   * rendering (see `orientation.ts`), so atom labels always stay upright — a
   * positive angle is counter-clockwise in the y-up mathematical sense, which
   * reads as clockwise on the downward-y SVG screen.
   */
  orientationDeg?: number
  /**
   * Mirror the depiction across its vertical axis. This flips the
   * stereochemistry (an enantiomer for chiral molecules), so callers must only
   * enable it for achiral molecules (see `canMirrorStructure`).
   */
  mirror?: boolean
  /** Drawing theme. Defaults to the app theme from `useUiStore`. */
  theme?: "light" | "dark"
  className?: string
  /** Accessible name; falls back to the SMILES string when omitted. */
  title?: string
}

/**
 * Minimal local view of the private `DrawerBase` behind `SvgDrawer`.
 * smiles-drawer@2.4.1 does not publish `rings` on `DrawerBase` nor the
 * `Vector2` shape of `graph.vertices`, so we describe only what the
 * pre-render coordinate patch touches.
 */
interface PreprocessorShim {
  graph: { vertices: { position: Point }[] }
  rings: { center: Point }[]
  processGraph: () => void
}

/**
 * Mutate the laid-out coordinates in place, after `processGraph` and before
 * anything is drawn. Ring centers are transformed alongside the vertex
 * positions: `SvgDrawer.drawAromaticityRing` draws the circle at
 * `ring.center`, so leaving them behind would float the aromatic circles of
 * Phe/Tyr/Trp away from their rings.
 */
function applyOrientation(
  preprocessor: PreprocessorShim,
  orientationDeg: number,
  mirror: boolean,
): void {
  if (orientationDeg === 0 && !mirror) {
    return
  }

  const points = [
    ...preprocessor.graph.vertices.map((vertex) => vertex.position),
    ...preprocessor.rings.map((ring) => ring.center),
  ]
  const transformed = transformPoints(points, orientationDeg, mirror)
  for (let i = 0; i < points.length; i++) {
    points[i].x = transformed[i].x
    points[i].y = transformed[i].y
  }
}

/**
 * Renders a 2D skeletal depiction of a SMILES string with `smiles-drawer`.
 *
 * The wrapper has a transparent background, so the caller decides the surface
 * the depiction sits on; the drawing theme (light/dark) is chosen to stay
 * legible against it.
 */
export function StructureView({
  smiles,
  size = 160,
  orientationDeg = 0,
  mirror = false,
  theme,
  className,
  title,
}: StructureViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hasError, setHasError] = useState(false)
  const appTheme = useThemeStore()
  const resolvedTheme = theme ?? appTheme

  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) {
      return
    }

    // SvgWrapper is constructed with `clear: true` and empties the target, but
    // clearing here too keeps a failed parse from leaving a stale drawing.
    svg.replaceChildren()
    setHasError(false)

    SmilesDrawer.parse(
      smiles,
      (tree) => {
        const drawer = new SmilesDrawer.SvgDrawer({
          width: size,
          height: size,
          bondLength: 24,
          padding: 12,
          // `explicitHydrogens: false` suppresses terminal hydrogen atoms so
          // small molecules keep a clean skeletal look. This does NOT hide
          // the stereochemical wedge: DrawerBase.initHydrogens() keeps an H
          // drawn whenever its neighbour is a stereocenter, so the wedge/dash
          // of the chiral L-amino acids survives. Verified against 2.4.1.
          explicitHydrogens: false,
        })

        // Patch ONLY this drawer instance. `processGraph` computes the 2D
        // layout; wrapping it lets us transform the coordinates in place after
        // layout and before `draw()` emits bonds, wedge/dash marks, aromatic
        // rings and the (upright) atom labels. The method is invoked against
        // the real DrawerBase instance via `.call`, and the original is
        // restored in a `finally` so the patch can never leak into another
        // draw — `preprocessor` is per-instance.
        const preprocessor = drawer.preprocessor as unknown as PreprocessorShim
        const originalProcessGraph = preprocessor.processGraph
        preprocessor.processGraph = () => {
          originalProcessGraph.call(preprocessor)
          applyOrientation(preprocessor, orientationDeg, mirror)
        }

        try {
          drawer.draw(tree, svg, resolvedTheme)
        } finally {
          preprocessor.processGraph = originalProcessGraph
        }
      },
      () => {
        setHasError(true)
      },
    )
  }, [smiles, size, orientationDeg, mirror, resolvedTheme])

  return (
    <div
      role="img"
      aria-label={title ?? smiles}
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
    >
      <svg ref={svgRef} width={size} height={size} aria-hidden="true" />
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-muted-foreground/40 border-dashed">
          <span className="font-mono text-muted-foreground text-xs">?</span>
        </div>
      )}
    </div>
  )
}
