"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Single-thumb slider. The thumb — not the presentational root — carries
 * `role="slider"` and the focus ring, so `aria-label` / `aria-labelledby`
 * passed here are forwarded onto the thumb to name the control.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center py-2",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-[4px] bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "block size-5 cursor-pointer rounded-full border-2 border-primary bg-card shadow-none",
        "transition-colors duration-150 hover:bg-primary/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
