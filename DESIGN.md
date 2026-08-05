# BiochemCalc Design System

## Color Tokens

### Light Mode (Porcelain Benchtop Lab)

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Background | `#F2F3EC` | `--background` | Page background |
| Card | `#FBFBF7` | `--card` | Card backgrounds, elevated surfaces |
| Foreground | `#202622` | `--foreground` | Primary text, body content |
| Primary | `#155E46` | `--primary` | Primary actions, headings, key UI elements |
| Accent/Ochre | `#9A5B17` | `--accent` | CTAs, success states, active indicators |
| Destructive | `#B42318` | `--destructive` | Delete actions, error states |
| Warning | `#A16207` | `--warning` | Warnings, alerts |
| Info | `#155E75` | `--info` | Information messages |
| Muted | `#E7EAE0` | `--muted` | Subtle backgrounds, hover states |
| Muted Foreground | `#5F6B64` | `--muted-foreground` | Secondary text, descriptions |
| Border | `#D8DCCE` | `--border` | Dividers, input borders |

### Dark Mode (Forest Lab)

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Background | `#101613` | `--background` | Page background |
| Card | `#161E19` | `--card` | Card backgrounds, elevated surfaces |
| Foreground | `#E4E8DE` | `--foreground` | Primary text, body content |
| Primary | `#3FA37E` | `--primary` | Primary actions, headings |
| Accent | `#D08C1F` | `--accent` | CTAs, active indicators |
| Destructive | `#FCA598` | `--destructive` | Error states (lighter for dark mode) |
| Warning | `#D4A017` | `--warning` | Warnings, alerts |
| Info | `#3FA3B8` | `--info` | Information messages |
| Muted | `#1B2420` | `--muted` | Subtle backgrounds |
| Muted Foreground | `#8A9489` | `--muted-foreground` | Secondary text |
| Border | `#243029` | `--border` | Dividers, input borders |

### Sidebar Panel
| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Sidebar Background | `#16281F` | `--sidebar-background` | Sidebar panel background |
| Sidebar Foreground | `#D9E2DA` | `--sidebar-foreground` | Sidebar text |

## Typography

- **Primary Font:** IBM Plex Sans (UI text, headings)
- **Mono Font:** IBM Plex Mono (numbers, micro-labels, code)
- **Tabular Numbers:** Applied via `tabular` utility class (`font-variant-numeric: tabular-nums`) for statistic readouts

## Spacing & Layout

- **Base Unit:** 4px (0.25rem)
- **Radius:** 4px (`--radius: 0.25rem`) - uniformly applied
- **Borders:** Hairline borders using `#D8DCCE` in light mode, `#243029` in dark mode
- **Shadows:** Near-zero, near-flat design (ultra-subtle tokens preserved for Dialog/dropdown/popover only)

## Motion

- **Color/State Transitions:** ≤150ms only
- **Entrance Animations:** None (removed all framer-motion staggered fades/scaled hovers)
- **Hover Scales:** None
- **Reduced Motion:** Respected throughout
- **Animation Philosophy:** Static, immediate, professional benchtop instrument feel

## Component Patterns

### Page Headers
- **h1:** `text-2xl font-semibold tracking-tight text-foreground`
- **Description:** `text-sm text-muted-foreground` (immediately follows h1)
- **Exception:** Home page retains its signature eyebrow label

### Cards
- Hairline borders for separation (no shadows except Dialog/dropdown/popover)
- Radius: 4px
- Background: Porcelain (#F2F3EC) in light mode

## Anti-Patterns

- ❌ No default-blue/slate shadcn stock look
- ❌ No staggered fade-up motion
- ❌ No emoji in UI
- ❌ No gradients
- ❌ No emojis as icons
- ❌ No layout-shifting animations
- ❌ Visible focus states must be maintained

## shadcn/ui Note

- Shadcn/ui components are restyled to match the benchtop lab instrument identity
- Not using stock New York/Slate themes
- All components follow the porcelain/forest color system

## Usage Guidelines

- **Statistics/Numeric Display:** Use `font-mono tabular` class for headline metrics
- **Secondary Text:** Use `text-muted-foreground` (not `text-foreground-secondary`)
- **Icons:** Lucide React only, consistent sizing
- **Czech Text:** Ensure proper rendering of diacritics (á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž)