import { useEffect, useRef, useState } from "react"
import SmilesDrawer from "smiles-drawer"

import { computeDepictionBounds } from "@/components/ui/depiction-bounds"
import { ProjectionView } from "@/components/ui/projection-view"
import { type Point, transformPoints } from "@/lib/molecules/orientation"
import {
  applyHaworthBoldFrontEdges,
  applyHaworthHOLabels,
  applyHaworthLayout,
  collectOhLabelHints,
  type HaworthPreprocessor,
} from "@/lib/molecules/render/haworth-layout"
import type { ProjectionSpec } from "@/lib/molecules/render/projection"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/ui-store"

export interface StructureViewProps {
  smiles: string
  /**
   * Parsed projection (Haworth, …). When set, the projection is drawn
   * INSTEAD of the SMILES pipeline below: `smiles` only survives as the
   * accessible-name fallback, and `size`/`theme` don't apply (a projection
   * draws at its natural size and follows `currentColor`). Raw projection
   * strings are parsed upstream with `parseProjection`.
   */
  projection?: ProjectionSpec
  /** Square canvas side length in px. */
  size?: number
  /**
   * Adaptive sizing for single-molecule contexts (SMILES path only; a
   * projection already draws at its natural size). Default false keeps
   * today's fixed `size` square — grids, previews and option lists stay
   * uniform. When true, the element grows with the molecule's natural
   * bounds (1:1 bonds) up to `maxWidth` × 70%-of-viewport-height, and only
   * beyond the caps does the depiction shrink, uniformly. See
   * `computeDepictionBounds` for the exact semantics.
   */
  grow?: boolean
  /**
   * Width cap for `grow`, in px. Defaults to the parent container's width
   * at draw time (fallback 640 px); pass it explicitly wherever the parent
   * is shrink-to-fit, so its width can't feed back on the grown depiction.
   */
  maxWidth?: number
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
  /** Reports whether the SMILES parsed and drew — used by the editor form. */
  onValidityChange?: (valid: boolean) => void
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
 * Post-draw adaptive sizing (SMILES path only). Replaces the fixed `size`
 * square with the depiction's natural bounds: the viewBox the drawer just
 * wrote feeds `computeDepictionBounds`, and the result lands on the svg's
 * own width/height attributes plus the wrapper's style, so the error
 * overlay (`absolute inset-0` on the wrapper) keeps covering the drawing.
 * Orientation/mirror need no special-casing — they act on the coordinates
 * before rendering, so a 90° rotation simply swaps the viewBox dims. The
 * width cap is `maxWidth` or the parent container's width at draw time
 * (fallback 640 px); the height cap is 70% of the viewport (fallback 560).
 */
function applyGrowBounds(
  wrapper: HTMLDivElement | null,
  svg: SVGSVGElement,
  size: number,
  maxWidth?: number,
): void {
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number)
  const vbw = viewBox[2] ?? 0
  const vbh = viewBox[3] ?? 0
  const parentWidth = wrapper?.parentElement?.clientWidth ?? 0
  const capW = maxWidth ?? (parentWidth > 0 ? parentWidth : 640)
  const capH =
    typeof window !== "undefined" && window.innerHeight > 0 ? 0.7 * window.innerHeight : 560
  const { width, height } = computeDepictionBounds({ vbw, vbh, size, capW, capH, grow: true })
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  if (wrapper !== null) {
    wrapper.style.width = `${width}px`
    wrapper.style.height = `${height}px`
  }
}

/**
 * The projection branch of StructureView. Validity is a settled question —
 * a `ProjectionSpec` only exists once `parseProjection` accepted the raw
 * string — so it reports `true` once per spec change, mirroring the SMILES
 * path's `onValidityChange` contract.
 */
function ProjectionStructureView({
  projection,
  orientationDeg,
  mirror,
  className,
  title,
  smiles,
  onValidityChange,
}: StructureViewProps & { projection: ProjectionSpec }) {
  useEffect(() => {
    onValidityChange?.(true)
    // Same reasoning as the SMILES effect: only the real input re-fires.
  }, [projection])

  return (
    <ProjectionView
      spec={projection}
      orientationDeg={orientationDeg}
      mirror={mirror}
      className={className}
      ariaLabel={title ?? smiles}
    />
  )
}

/**
 * Renders a 2D skeletal depiction of a molecule: its Haworth-style
 * `projection` when one is given, otherwise the SMILES with `smiles-drawer`.
 *
 * The wrapper has a transparent background, so the caller decides the surface
 * the depiction sits on; the drawing theme (light/dark) is chosen to stay
 * legible against it.
 */
export function StructureView(props: StructureViewProps) {
  // No hooks here: the two branches are distinct components, so a
  // projection↔SMILES flip reconciles as a plain remount.
  if (props.projection) {
    return <ProjectionStructureView {...props} projection={props.projection} />
  }
  return <SmilesStructureView {...props} />
}

function SmilesStructureView({
  smiles,
  size = 160,
  orientationDeg = 0,
  mirror = false,
  theme,
  className,
  title,
  onValidityChange,
  grow = false,
  maxWidth,
}: StructureViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
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

    // Re-anchor the element on the fixed square before every draw. React
    // only writes the width/height attrs and style when the `size` PROP
    // changes, so without this a grown draw (`grow` flipped off, or a grown
    // redraw under a new SMILES) would leave the old dimensions behind.
    const wrapper = wrapperRef.current
    svg.setAttribute("width", String(size))
    svg.setAttribute("height", String(size))
    if (wrapper !== null) {
      wrapper.style.width = `${size}px`
      wrapper.style.height = `${size}px`
    }

    SmilesDrawer.parse(
      smiles,
      (tree) => {
        onValidityChange?.(true)
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
        let recognized = false
        preprocessor.processGraph = () => {
          originalProcessGraph.call(preprocessor)
          // Sugar rings first: recognized rings snap into the canonical
          // Haworth skeleton (nucleotides & co. keep their full library
          // layout for the rest). Recognized sugars stay canonical — no
          // random orientation — while an explicit enantiomer mirror still
          // applies to the whole drawing (mirror decoys work on projections).
          recognized = applyHaworthLayout(
            preprocessor as unknown as HaworthPreprocessor,
          )
          if (recognized) {
            if (mirror) {
              applyOrientation(preprocessor, 0, true)
            }
          } else {
            applyOrientation(preprocessor, orientationDeg, mirror)
          }
        }

        try {
          drawer.draw(tree, svg, resolvedTheme)
          if (recognized) {
            // Left-half ring hydroxyls read "HO", anchored off the ring —
            // the hexose C4 idiom that also frees up crowded space.
            applyHaworthHOLabels(
              svg,
              collectOhLabelHints(preprocessor as unknown as HaworthPreprocessor),
            )
            // Graduated bold front ring bonds (thin C1→C2, thick C2→C3,
            // thick→thin C3→C4) — pyranose and furanose alike. Runs on the
            // final coordinates, so the quads land exactly on the ring.
            applyHaworthBoldFrontEdges(svg, preprocessor as unknown as HaworthPreprocessor)
          }
          if (grow) {
            // Fully drawn (labels included): the viewBox now holds the
            // final bounds, so adaptive sizing can measure it.
            applyGrowBounds(wrapper, svg, size, maxWidth)
          }
        } finally {
          preprocessor.processGraph = originalProcessGraph
        }
      },
      () => {
        setHasError(true)
        onValidityChange?.(false)
      },
    )
    // onValidityChange is intentionally not a dependency: its identity can
    // change per parent render, and only real inputs should trigger a redraw.
  }, [smiles, size, orientationDeg, mirror, resolvedTheme, grow, maxWidth])

  return (
    <div
      ref={wrapperRef}
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
