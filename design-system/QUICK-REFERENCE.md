# BiochemCalc Design System - Quick Reference

> **One-page cheat sheet for developers and designers**  
> Full documentation: [`design-system/MASTER.md`](./MASTER.md)

---

## 🎨 Color Palette

### Light Mode - Porcelain Benchtop Lab

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#F2F3EC` | Page background |
| `--card` | `#FBFBF7` | Card backgrounds |
| `--foreground` | `#202622` | Primary text |
| `--primary` | `#155E46` | Primary actions, active states |
| `--accent` | `#9A5B17` | CTAs, indicators, active navigation |
| `--destructive` | `#B42318` | Errors, delete actions |
| `--warning` | `#A16207` | Warnings, alerts |
| `--info` | `#155E75` | Information messages |
| `--muted` | `#E7EAE0` | Subtle backgrounds |
| `--muted-foreground` | `#5F6B64` | **Secondary text** |
| `--border` | `#D8DCCE` | Borders, dividers |

### Dark Mode - Forest Laboratory

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#101613` | Page background |
| `--card` | `#161E19` | Card backgrounds |
| `--foreground` | `#E4E8DE` | Primary text |
| `--primary` | `#3FA37E` | Primary actions |
| `--accent` | `#D08C1F` | CTAs, indicators |
| `--destructive` | `#FCA598` | Errors |
| `--warning` | `#D4A017` | Warnings |
| `--info` | `#3FA3B8` | Information |
| `--muted` | `#1B2420` | Subtle backgrounds |
| `--muted-foreground` | `#8A9489` | **Secondary text** |
| `--border` | `#243029` | Borders, dividers |

### Sidebar Panel

| Token | Hex | Usage |
|-------|-----|-------|
| `--sidebar-background` | `#16281F` | Sidebar panel |
| `--sidebar-foreground` | `#D9E2DA` | Sidebar text |

---

## 📐 Typography

### Font Family

```css
/* Primary UI text and headings */
font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;

/* Numbers, code, micro-labels */
font-family: 'IBM Plex Mono', monospace;
```

**Font Formats:** Use Google Fonts or local files for IBM Plex Sans and IBM Plex Mono

### Type Scale

| Size | Token | Usage |
|------|-------|-------|
| **2XL** | `text-2xl` | **Page headings** - font-semibold tracking-tight |
| Base | `text-base` | Body text |
| SM | `text-sm` | **Descriptions, secondary text** |
| Mono | `font-mono tabular` | **Statistics, numbers, readouts** |

### Font Weights

| Weight | Usage |
|--------|-------|
| **400** | Body text |
| **500** | Buttons, labels |
| **600** | **Headings (font-semibold)** |
| 700 | Rare, avoid for page headers |

### Special: Tabular Numbers

**Apply `font-mono tabular` to all statistic-like numbers:**

```tsx
// Counts in headers
<span className="font-mono tabular">{filteredItems.length}</span>

// Badges with numbers  
<Badge className="font-mono tabular">{value} pt</Badge>

// Readouts
<div className="font-mono text-3xl tabular">{statistic}</div>
```

---

## 📏 Spacing System

**Base Unit:** 4px (0.25rem)

| Token | px | rem | Usage |
|-------|----|-----|-------|
| `--radius` | 4px | 0.25rem | **Universal radius** (cards, inputs, buttons) |
| `--space-4` | 16px | 1rem | **Standard padding** |
| `--space-6` | 24px | 1.5rem | Card padding, section gaps |

**Rule:** Apply 4px radius to EVERYTHING except sharp corners (tables, code blocks)

---

## □ Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| Default | 4px | **Everything** - cards, buttons, inputs, badges |
| None | 0px | Tables, code blocks, sharp containers |

---

## 🌈 Shadows

**KEY RULE: NO SHADOWS on cards/panels**

| Token | Usage |
|-------|-------|
| `shadow-none` | **All cards, panels, containers** |
| Subtle tokens | Dialog, DropdownMenu, Select, Tooltip only |

**Forbidden:** `shadow-sm`, `shadow-md`, `shadow-lg` on regular UI elements
**Allowed:** Only on floating/overlay elements (Dialog, dropdowns, popovers)

---

## ⏱️ Transitions & Animation

### What's REMOVED ❌
- All framer-motion usage
- Staggered fade-in animations
- Hover scale effects
- Layout-shifting transforms
- Entrance animations

### What's ALLOWED ✅
- Color transitions: ≤150ms
- Focus state changes: ≤150ms
- Hover color shifts: ≤150ms

### Transitions

```css
/* Default for interactive elements */
transition: color 150ms ease-in-out, background-color 150ms ease-in-out;

/* Maximum allowed duration */
--duration-normal: 150ms;
```

---

## 🏗️ Component Patterns

### Page Headers (ALL pages)

```tsx
// STANDARD pattern
<div>
  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
    {cs.page.title}
  </h1>
  <p className="text-sm text-muted-foreground mt-1">
    {cs.page.description}
  </p>
</div>

// EXCEPTION: Home page keeps signature eyebrow
<div>
  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent mb-2">
    PŘEHLED
  </div>
  <h1 className="text-2xl font-semibold tracking-tight">...</h1>
  <p className="text-muted-foreground max-w-2xl mt-1">...</p>
</div>
```

### Cards

```tsx
<Card className="border border-border rounded-[4px]">
  <CardHeader>
    <CardTitle className="text-base font-semibold tracking-tight">
      Title
    </CardTitle>
    <CardDescription className="text-sm text-muted-foreground">
      Description
    </CardDescription>
  </CardHeader>
  <CardContent>
    Content
  </CardContent>
</Card>
```

**Key:** No shadows, 4px radius, hairline border

---

## 🎯 Design Principles

### ✅ DO

- Use **IBM Plex Sans** for all UI text
- Use **IBM Plex Mono** for all numbers, code, micro-labels
- Add **`tabular`** class to all statistic numbers
- Use **`font-mono tabular`** for headline metrics
- Apply **4px radius** to all elements
- Use **`text-muted-foreground`** for secondary/descriptive text
- Use **hairline borders** for visual separation (not shadows)
- Respect **≤150ms transitions** for color changes
- Use **`font-semibold tracking-tight`** for page headers
- Keep **page headers at text-2xl** (never text-3xl or larger)

### ❌ DON'T

- Use **emojis anywhere** in UI → Use text or Lucide icons
- Use **framer-motion** → Static design only
- Use **shadows on cards/panels** → Borders only
- Use **font-bold for page headers** → Use font-semibold
- Use **text-3xl/text-4xl for pages** → Use text-2xl
- Use **`text-foreground-secondary`** → Use `text-muted-foreground`
- Use **hardcoded colors** → Use CSS variables
- Use **arbitrary radius values** → Use 4px
- Use **staggered animations** → No entrance animations
- Use **hover scale effects** → Static design
- Use **default shadcn styling** → Full restyle required

---

## 🚀 Implementation Checklist

### For Every New Component

- [ ] Colors use CSS variables (not hex/rgb)
- [ ] Spacing uses Tailwind tokens (not px values)
- [ ] Radius is 4px (`rounded-[4px]`)
- [ ] No shadows on cards/panels
- [ ] Page header follows `text-2xl font-semibold tracking-tight` pattern
- [ ] Statistics use `font-mono tabular`
- [ ] Secondary text uses `text-muted-foreground`
- [ ] No framer-motion imports or usage
- [ ] No layout-shifting animations
- [ ] Transitions ≤150ms if any

### For Statistic Numbers

- [ ] Applied `font-mono` class
- [ ] Applied `tabular` class  
- [ ] Used for headline metrics only (not body text numbers)
- [ ] Consistent with other statistics in the interface

---

## ♿ Accessibility

- Text contrast ≥ **4.5:1** in light and dark mode
- `cursor: pointer` on all clickable elements
- **44x44px** minimum touch targets
- **Reduced motion** respected throughout
- **Czech diacritics** render correctly in IBM Plex fonts
- **Keyboard navigation** works throughout
- **Focus indicators** visible and appropriate

---

## 📚 File References

- **Full Design System:** [`design-system/MASTER.md`](./MASTER.md)
- **CSS Tokens:** Defined in Tailwind config and CSS variables
- **Icon Library:** [Lucide React](https://lucide.dev)
- **IBM Plex Fonts:** [IBM Plex on Google Fonts](https://fonts.google.com/specimen/IBM+Plex+Sans)
- **Color Contrast Tester:** [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## 🇨🇿 Czech Localization

- **Diacritics:** á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž
- **Date Format:** DD.MM.YYYY (04.08.2026)
- **Time Format:** HH:MM:SS (15:09:38)
- **Number Format:** 1 234,56 (space thousands, comma decimal)
- **Font:** IBM Plex Sans and Mono fully support Czech characters ✓

---

*Generated: 2026-08-04 | Version: 2.1.0 | Project: BiochemCalc | Identity: Benchtop Lab Instrument*