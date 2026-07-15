# BiochemCalc Design System

## Color Tokens

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Primary | `#1E3A5F` | `--color-primary` | Headers, primary buttons, active navigation |
| Accent/CTA | `#059669` | `--color-accent` | Success states, generate actions, completed checkmarks |
| Background | `#F8FAFC` | `--color-background` | Page background |
| Foreground | `#0F172A` | `--color-foreground` | Body text |
| Muted | `#F1F3F5` | `--color-muted` | Card backgrounds, hover states |
| Border | `#E4E7EB` | `--color-border` | Dividers, input borders |
| Destructive | `#DC2626` | `--color-destructive` | Delete actions, error states |

## Typography

- **Font Family:** Geist Variable (via `@fontsource-variable/geist`)
- **Fallback:** system-ui, sans-serif
- **Scale:** Tailwind default type scale

## Spacing

- Tailwind default spacing scale
- Cards and sections use `p-4`, `p-6`, `gap-4`

## Components

- shadcn/ui with Style: New York, Base color: Slate, CSS variables enabled
- Button primary uses `--color-primary`
- Card uses `--color-background` with subtle border

## Anti-Patterns

- No emojis as icons
- No layout-shifting animations
- Visible focus states for keyboard navigation
