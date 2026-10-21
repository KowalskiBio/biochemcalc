import { useMemo } from "react"

import { drawProjection, type ProjectionSpec } from "@/lib/molecules/render/projection"
import { cn } from "@/lib/utils"

export interface ProjectionViewProps {
  /** Parsed projection description (see `parseProjection`). */
  spec: ProjectionSpec
  /**
   * Rotation of the depiction, in degrees — handed straight to
   * `drawProjection`, which keeps atom labels upright while transforming the
   * coordinates (same convention as StructureView's `orientationDeg`).
   */
  orientationDeg?: number
  /**
   * Mirror the depiction across its vertical axis. Flips stereochemistry, so
   * callers must only enable it for achiral molecules.
   */
  mirror?: boolean
  className?: string
  /**
   * Draw in the single Mistr ink — the theme's neutral atom ink (#16281F
   * light, #FCFCF8 dark) — instead of the surrounding text colour. The
   * projection has no atom palette to hide, but Mistr insists on one flat
   * ink across the whole depiction, projections included. Default false.
   */
  monochrome?: boolean
  /** Accessible name for the wrapper's `role="img"`. */
  ariaLabel: string
}

/**
 * Plain bond stroke in the drawing's own units; bold marks (the near edge of
 * a Haworth ring) scale ~2.2×, matching a heavy wedge against a plain bond.
 */
const STROKE_WIDTH = 1.5
const BOLD_STROKE_WIDTH = STROKE_WIDTH * 2.2

/**
 * Skeletal twin of StructureView for declarative projections (Haworth, …):
 * `drawProjection` resolves the spec into absolute lines and labels and this
 * component just inks them.
 *
 * Everything strokes/fills with `currentColor` against a transparent
 * background — the drawing follows the surrounding text color instead of a
 * baked-in light/dark theme. Mistr sets `monochrome` to pin that colour to
 * the app atom ink, matching what `applyTheme` does to the SMILES
 * depictions.
 */
export function ProjectionView({
  spec,
  orientationDeg,
  mirror,
  monochrome = false,
  className,
  ariaLabel,
}: ProjectionViewProps) {
  // `drawProjection` is a pure function of (spec, orientation, mirror), so
  // the element list is stable until a real input changes — parents memoize
  // the spec itself (e.g. parsed per molecule).
  const drawing = useMemo(
    () => drawProjection(spec, { rotateDeg: orientationDeg, mirror }),
    [spec, orientationDeg, mirror],
  )

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("relative inline-block", className)}
      style={{ width: drawing.width, height: drawing.height }}
    >
      <svg
        viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        width={drawing.width}
        height={drawing.height}
        aria-hidden="true"
        className={cn("text-foreground", monochrome && "text-[#16281F] dark:text-[#FCFCF8]")}
      >
        {drawing.elements.map((element, index) =>
          element.kind === "line" ? (
            <line
              // Element order is deterministic (pure projection), so an
              // indexed key never reorders under an unchanged spec.
              key={`l${index}`}
              x1={element.x1}
              y1={element.y1}
              x2={element.x2}
              y2={element.y2}
              stroke="currentColor"
              strokeWidth={element.bold ? BOLD_STROKE_WIDTH : STROKE_WIDTH}
              strokeLinecap="round"
            />
          ) : (
            <text
              key={`t${index}`}
              x={element.x}
              y={element.y}
              fontSize={11}
              dominantBaseline="central"
              textAnchor={element.anchor ?? "middle"}
              fill="currentColor"
            >
              {element.text}
            </text>
          ),
        )}
      </svg>
    </div>
  )
}
