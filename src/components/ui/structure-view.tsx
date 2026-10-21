import { useEffect, useRef, useState } from "react"

import { computeDepictionBounds } from "@/components/ui/depiction-bounds"
import { ProjectionView } from "@/components/ui/projection-view"
import type { ProjectionSpec } from "@/lib/molecules/render/projection"
import { renderStructure } from "@/lib/molecules/render/render-structure"
import { ensureRdkit } from "@/lib/molecules/render/rdkit-engine"
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
  /**
   * Gate saccharide auto-recognition and Haworth projection. Set false to
   * force skeletal rendering and ignore Haworth projections; default true.
   */
  haworth?: boolean
  /**
   * Gate open-chain sugar auto-recognition into a Fischer projection (runs
   * only when no sugar ring is recognized — mutually exclusive by structure).
   * Default true.
   */
  fischer?: boolean
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
   * reads as clockwise on the downward-y SVG screen. Recognised Haworth
   * skeletons stay canonical and ignore it.
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
 * Post-draw adaptive sizing (SMILES path only). Measures the drawn content
 * (falling back to the viewBox under jsdom, where `getBBox` is unavailable)
 * and feeds `computeDepictionBounds`, then writes the result to the svg's own
 * width/height attributes plus the wrapper's style, so the error overlay
 * (`absolute inset-0` on the wrapper) keeps covering the drawing. The width
 * cap is `maxWidth` or the parent container's width at draw time (fallback
 * 640 px); the height cap is 70% of the viewport (fallback 560).
 */
function applyGrowBounds(
  wrapper: HTMLDivElement | null,
  svg: SVGSVGElement,
  size: number,
  maxWidth?: number,
): void {
  let vbw = 0
  let vbh = 0
  if (typeof svg.getBBox === "function") {
    try {
      const box = svg.getBBox()
      vbw = box.width
      vbh = box.height
    } catch {
      // jsdom: fall through to the viewBox.
    }
  }
  if (!(vbw > 0) || !(vbh > 0)) {
    const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number)
    vbw = viewBox[2] ?? 0
    vbh = viewBox[3] ?? 0
  }
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
 * `projection` when one is given, otherwise the SMILES with the RDKit
 * pipeline (`renderStructure`).
 *
 * The wrapper has a transparent background, so the caller decides the surface
 * the depiction sits on; the drawing theme (light/dark) is chosen to stay
 * legible against it.
 */
export function StructureView(props: StructureViewProps) {
  // No hooks here: the two branches are distinct components, so a
  // projection↔SMILES flip reconciles as a plain remount.
  if (props.projection && props.haworth !== false) {
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
  haworth = true,
  fischer = true,
}: StructureViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [ready, setReady] = useState(false)
  const [hasError, setHasError] = useState(false)
  const appTheme = useThemeStore()
  const resolvedTheme = theme ?? appTheme

  useEffect(() => {
    let cancelled = false
    ensureRdkit()
      .then(() => {
        if (!cancelled) {
          setReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (svg === null || !ready) {
      return
    }

    // Clear first, so a failed parse never leaves a stale drawing behind.
    svg.replaceChildren()
    setHasError(false)

    // Re-anchor the element on the fixed square before every draw. React only
    // writes the width/height attrs and style when the `size` PROP changes, so
    // without this a grown draw would leave the old dimensions behind.
    const wrapper = wrapperRef.current
    svg.setAttribute("width", String(size))
    svg.setAttribute("height", String(size))
    if (wrapper !== null) {
      wrapper.style.width = `${size}px`
      wrapper.style.height = `${size}px`
    }

    const rendered = renderStructure(smiles, {
      width: size,
      height: size,
      orientationDeg,
      mirror,
      theme: resolvedTheme,
      bondLength: 24,
      natural: grow,
      haworth,
      fischer,
    })
    if (rendered === null) {
      setHasError(true)
      onValidityChange?.(false)
      return
    }

    svg.setAttribute("viewBox", rendered.svg.getAttribute("viewBox") ?? `0 0 ${size} ${size}`)
    for (const child of Array.from(rendered.svg.childNodes)) {
      svg.appendChild(document.importNode(child, true))
    }
    onValidityChange?.(true)
    if (grow) {
      // Fully drawn (labels included): adaptive sizing can measure it.
      applyGrowBounds(wrapper, svg, size, maxWidth)
    }
    // onValidityChange is intentionally not a dependency: its identity can
    // change per parent render, and only real inputs should trigger a redraw.
  }, [ready, smiles, size, orientationDeg, mirror, resolvedTheme, grow, maxWidth, haworth, fischer])

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
