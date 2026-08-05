# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** BiochemCalc  
**Design Identity:** Benchtop Lab Instrument  
**Category:** Teacher-Facing Biochemistry Assignment Generator  
**Audience:** Czech Biochemistry Teachers (Professional Educators)  
**Date:** 2026-08-04

---

## Global Rules

### Design Philosophy

BiochemCalc embodies **precision, clarity, and trust** - qualities essential for benchtop laboratory instrumentation. The design system prioritizes:

- **Professional Authority**: Colors and typography that convey laboratory precision and reliability
- **Czech Context**: Culturally appropriate design for Czech educators  
- **Benchtop Instrument Aesthetic**: Green-tinted porcelain, forest controls, ochre indicators
- **Accessibility First**: WCAG AAA compliance for all color choices
- **Educator-Friendly**: Clean, uncluttered interfaces that don't distract from biochemistry content

### Color Palette

#### Light Mode - Porcelain Benchtop

| Role | Hex | CSS Variable | Usage | Accessibility |
|------|-----|--------------|-------|---------------|
| Background | `#F2F3EC` | `--background` | Page background | Porcelain base |
| Card | `#FBFBF7` | `--card` | Card backgrounds | Elevated porcelain |
| Foreground | `#202622` | `--foreground` | Primary text | Near-black forest ink |
| Primary | `#155E46` | `--primary` | Primary actions, active states | Deep forest green |
| Accent | `#9A5B17` | `--accent` | CTAs, active indicators | Laboratory ochre |
| Destructive | `#B42318` | `--destructive` | Errors, delete actions | Alert red |
| Warning | `#A16207` | `--warning` | Warnings, alerts | Amber warning |
| Info | `#155E75` | `--info` | Information messages | Technical blue-green |
| Muted | `#E7EAE0` | `--muted` | Subtle backgrounds | Soft porcelain |
| Muted Foreground | `#5F6B64` | `--muted-foreground` | Secondary text | Soft forest |
| Border | `#D8DCCE` | `--border` | Borders, dividers | Hairline porcelain |

#### Dark Mode - Forest Laboratory

| Role | Hex | CSS Variable | Usage | Accessibility |
|------|-----|--------------|-------|---------------|
| Background | `#101613` | `--background` | Page background | Dark forest |
| Card | `#161E19` | `--card` | Card backgrounds | Deep panel |
| Foreground | `#E4E8DE` | `--foreground` | Primary text | Porcelain on forest |
| Primary | `#3FA37E` | `--primary` | Primary actions | Vital green |
| Accent | `#D08C1F` | `--accent` | CTAs, indicators | Warm ochre |
| Destructive | `#FCA598` | `--destructive` | Errors | Soft alert |
| Warning | `#D4A017` | `--warning` | Warnings | Warm amber |
| Info | `#3FA3B8` | `--info` | Information | Cool technical |
| Muted | `#1B2420` | `--muted` | Subtle backgrounds | Deep forest |
| Muted Foreground | `#8A9489` | `--muted-foreground` | Secondary text | Subdued porcelain |
| Border | `#243029` | `--border` | Borders, dividers | Hairline depth |

#### Sidebar Panel

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Sidebar Background | `#16281F` | `--sidebar-background` | Sidebar panel |
| Sidebar Foreground | `#D9E2DA` | `--sidebar-foreground` | Sidebar text |

**Color Rationale:**
- **Porcelain Background (#F2F3EC)**: Clean laboratory surface, subtle green undertone evokes chemical glassware
- **Forest Ink (#202622)**: Deep, authoritative, professional - the color of permanent marker on lab notebooks
- **Ochre Accent (#9A5B17)**: Laboratory indicator lights, caution tape, chemical staining - warm contrast against cool porcelain
- **Neutral System**: Carefully balanced to maintain professional appearance while avoiding clinical sterility

### Typography

**Font Family:**
- **Primary Font:** IBM Plex Sans
- **Mono Font:** IBM Plex Mono  
- **Fallback:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

**Why IBM Plex?**
- Exceptional readability at all sizes
- Designed for technical and scientific contexts
- Comprehensive weight range with true italics
- Professional, clean aesthetic
- Excellent Czech character support (accented characters)
- IBM's design heritage aligns with laboratory equipment

**Type Scale:**

| Token | Size (px) | Size (rem) | Line Height | Usage |
|-------|-----------|------------|-------------|-------|
| `--text-xs` | 12px | 0.75rem | 1.5 (18px) | Captions, labels |
| `--text-sm` | 14px | 0.875rem | 1.5 (21px) | Secondary text, descriptions |
| `--text-base` | 16px | 1rem | 1.625 (26px) | **Body text** |
| `--text-lg` | 18px | 1.125rem | 1.556 (28px) | Emphasized text |
| `--text-xl` | 20px | 1.25rem | 1.5 (30px) | Subheadings |
| `--text-2xl` | 24px | 1.5rem | 1.417 (34px) | **Page headings** |
| `--text-3xl` | 30px | 1.875rem | 1.333 (40px) | Section headings (rare) |

**Font Weights:**

| Token | Weight | Usage |
|-------|--------|-------|
| `--font-normal` | 400 | Body text, default |
| `--font-medium` | 500 | Emphasis, buttons |
| `--font-semibold` | 600 | **Headings** |
| `--font-bold` | 700 | Rare, strong emphasis only |

**Special Typography:**
- **Tabular Numbers:** `font-variant-numeric: tabular-nums` applied via `.tabular` class
- **Monospace:** IBM Plex Mono for all numeric readouts, code, micro-labels
- **Statistic Display:** Always combine `font-mono tabular` for headline metrics

**Typography Best Practices:**
- **Czech Text:** Ensure proper rendering of accented characters (á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž)
- **Line Length:** Keep body text between 45-75 characters per line
- **Hierarchy:** Use semantic heading levels with appropriate size and weight
- **Contrast:** Maintain minimum 4.5:1 contrast ratio for all text
- **Page Headers:** `text-2xl font-semibold tracking-tight text-foreground`
- **Sub-section Headers:** `text-base font-semibold tracking-tight text-foreground`

### Spacing System

**Base Unit:** 4px (0.25rem)

| Token | Value (px) | Value (rem) | Usage |
|-------|------------|-------------|-------|
| `--space-0` | 0px | 0rem | Reset |
| `--space-1` | 4px | 0.25rem | Micro gaps, icon padding |
| `--space-2` | 8px | 0.5rem | Small gaps, inline spacing |
| `--space-3` | 12px | 0.75rem | Compact padding |
| `--space-4` | 16px | 1rem | **Standard** |
| `--space-6` | 24px | 1.5rem | Card padding, section gaps |
| `--space-8` | 32px | 2rem | Large gaps |
| `--space-12` | 48px | 3rem | Section margins |

**Spacing Guidelines:**
- Use spacing tokens consistently - avoid arbitrary pixel values
- Maintain vertical rhythm by using spacing tokens from the scale
- Prefer even-numbered spacing tokens for predictable patterns
- Component internal spacing: use space-2 to space-6
- Component external spacing (margins): use space-6 to space-12
- **Radius: 4px universally applied (--radius: 0.25rem)**

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-none` | 0px | Sharp corners (code blocks, tables) |
| `--radius` | 4px | **Universal default** - all cards, inputs, buttons |
| `--radius-full` | 9999px | Circular elements |

### Shadows

**Design Approach:** Near-flat design with hairline borders providing separation. Shadows are **NOT used** except for floating elements (Dialog, DropdownMenu, Select content, Tooltip).

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-none` | `none` | **Default - all cards and panels** |
| Ultra-subtle tokens | Preserved | Dialog/dropdown/popover only |

**Key Rule:** No shadow-sm, shadow-md, or shadow-lg on regular cards/panels. Borders carry all visual separation.

### Transitions & Animation

**Design Philosophy:** Static, immediate, professional. The interface behaves like precision laboratory equipment - no unnecessary motion.

**What's Removed:**
- ❌ All framer-motion usage (staggered fades, hover scales)
- ❌ Entrance animations
- ❌ Layout-shifting animations

**What's Allowed:**
- ✅ Color/state transitions ≤150ms
- ✅ Focus state changes
- ✅ Hover color shifts (150ms max)

**Timing Functions:**

| Token | Value | Usage |
|-------|-------|-------|
| Standard | `var(--ease-in-out)` | Default transitions |

**Durations:**

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 100ms | Micro-interactions |
| `--duration-normal` | 150ms | **Maximum allowed** (hover, focus) |

**Animation Rules:**
- **Reduced Motion:** Respect `prefers-reduced-motion: reduce`
- **Performance:** Use `transform` and `opacity` only when absolutely necessary
- **Principle:** When in doubt, don't animate

---

## Component Specs

### Page Structure Pattern

```tsx
// Standard page header
<div>
  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
    {pageTitle}
  </h1>
  <p className="text-sm text-muted-foreground mt-1">
    {pageDescription}
  </p>
</div>

// Exception: Home page keeps its signature eyebrow
<div>
  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent mb-2">
    PŘEHLED
  </div>
  <h1 className="text-2xl font-semibold tracking-tight">...</h1>
  <p className="text-muted-foreground max-w-2xl mt-1">...</p>
</div>
```

### Card Usage

- **Background:** Porcelain (#F2F3EC light) / Dark panel (#161E19 dark)
- **Border:** Hairline using border tokens
- **Radius:** 4px always
- **Shadow:** None (except Dialog/dropdown/popover)
- **Hover:** No transform, color change only if interactive

### Buttons

- Primary: Uses `--primary` color
- Secondary: Uses `--muted` background with border
- Destructive: Uses `--destructive` color
- **Radius:** 4px
- **Hit area:** Minimum 44x44px touch targets

### Statistic Numbers

**Always apply `font-mono tabular` to:**
- Count displays in headers
- Numeric readouts in stat panels
- Any headline metric
- Point values, variable counts, etc.

**Example:**
```tsx
<span className="font-mono tabular">{count}</span> items
<Badge className="font-mono tabular">{value} pt</Badge>
```

---

## Style Guidelines

### Design Style: Benchtop Laboratory Instrument

**Style Name:** Precision Flat

**Keywords:**
- Clean, instrument-panel aesthetic
- Hairline borders, sharp precision
- No decorative shadows
- Static, immediate response
- Professional laboratory equipment

**Best For:**
- Educational biochemistry applications
- Teacher-facing tools
- Professional scientific software
- Data entry and calculation interfaces

**Key Effects:**
- Hairline borders for precise visual separation
- Simple state changes (color only, no movement)
- Minimal icon usage - only when functionally necessary
- Focus on data clarity and input precision

### Layout Principles

- **Mobile-First:** Design for smallest screens first
- **Responsive Breakpoints:** 640px, 768px, 1024px, 1280px
- **Max Content Width:** 1280px for desktop
- **Sidebar:** Fixed 232px width, forest panel (#16281F)
- **Top Bar:** Solid background, mono breadcrumbs
- **Radius:** 4px universally
- **Selection:** Ochre (#9A5B17) accent

---

## Anti-Patterns (Do NOT Use)

### Forbidden UI Elements

- ❌ **Emojis anywhere in UI** — Use text descriptions or Lucide icons only
- ❌ **Emojis as icons** — Use SVG icons (Lucide only)
- ❌ **Animated GIFs** — Use static images or no images
- ❌ **Auto-playing videos** — User must initiate all media
- ❌ **Pop-up advertisements** — Never in educational tools
- ❌ **Default shadcn New York/Slate styling** — All components must be restyled

### Forbidden CSS Practices

- ❌ **`!important` declarations** — Only in absolute emergencies
- ❌ **Magic numbers** — Always use design tokens
- ❌ **Inline styles** — Use Tailwind classes
- ❌ **Duplicate selectors** — Consolidate CSS rules
- ❌ **Hardcoded colors** — Always use CSS variables
- ❌ **Arbitrary spacing** — Always use spacing tokens
- ❌ **Shadows on cards/panels** — Use borders only
- ❌ **font-bold for page headers** — Use font-semibold tracking-tight
- ❌ **text-3xl, text-4xl for page headers** — Use text-2xl only

### Forbidden Interaction Patterns

- ❌ **Missing cursor:pointer** — All clickable elements must have it
- ❌ **Hover-only affordances** — Must work on touch devices
- ❌ **Layout-shifting hovers** — Avoid transforms that move other content
- ❌ **Staggered fade-in animations** — No framer-motion entrance animations
- ❌ **Hover scale effects** — No transform: scale() on hover
- ❌ **Instant state changes** — Use ≤150ms transitions for color changes only
- ❌ **Invisible focus states** — Focus must be visible for keyboard users
- ❌ **Broken back button** — Navigation must respect browser history
- ❌ **Scroll hijacking** — Never override native scroll behavior

### Forbidden Quality Issues

- ❌ **Low contrast text** — Minimum 4.5:1 contrast ratio
- ❌ **Broken links** — All links must resolve
- ❌ **Orphaned words** — Prevent single words on new lines
- ❌ **Overlapping content** — Z-index management required
- ❌ **Mixed secondary text classes** — Use `text-muted-foreground` not `text-foreground-secondary`

---

## Czech Localization Notes

### Typography

- Ensure proper rendering of Czech diacritics: **á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž**
- Test with actual Czech text: "Biochemie pro studenty středních škol"
- Line height should accommodate ascenders and descenders with diacritics
- IBM Plex Sans and Mono fully support all Czech characters natively

### Date/Time Formatting

- **Date Format:** DD.MM.YYYY (04.08.2026)
- **Time Format:** HH:MM:SS (15:09:38)
- **Number Format:** 1 234,56 (space thousands, comma decimal)
- **Currency:** Kč (Czech koruna)

### Cultural Considerations

- **Color Associations:** same as Western conventions (red=stop, green=go)
- **Imagery:** Use culturally neutral scientific imagery (laboratory equipment, molecules, DNA)
- **Avoid:** Religious or political symbols, bright yellow + black combination (warning signs)

---

##(shadcn/ui) Integration

**Current Status:** shadcn/ui is fully restyled for the BiochemCalc identity.

**Key Changes from Stock:**
- **Theme:** Custom porcelain/forest palette (not Slate/New York)
- **Colors:** All tokens mapped to BiochemCalc color system
- **Radius:** Uniform 4px (not default 6px or 8px)
- **Shadows:** Removed from cards/panels, preserved only for floating elements
- **Motion:** All entrance animations removed, state transitions limited to ≤150ms
- **Buttons:** Restyled with hairline borders and 4px radius
- **Cards:** Flat design with hairline borders, no shadows

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-07-08 | 1.0.0 | Initial design system |
| 2026-08-04 | 2.0.0 | Phase 1: Benchtop lab identity established - porcelain background, forest panel, ochre accents, 4px radius, hairline borders |
| 2026-08-04 | 2.1.0 | Phase 2: Consistency sweep - removed all framer-motion, normalized headers, flattened shadows, added tabular numbers, fixed color tokens |