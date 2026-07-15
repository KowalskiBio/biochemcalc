# BiochemCalc Design System - Quick Reference

> **One-page cheat sheet for developers and designers**
> Full documentation: [`design-system/MASTER.md`](./MASTER.md)

---

## 🎨 Color Palette

### Primary Colors (Trust & Professionalism)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#1E40AF` | Primary buttons, headings, key UI |
| `--color-primary-light` | `#3B82F6` | Hover states |
| `--color-on-primary` | `#FFFFFF` | Text on primary backgrounds |

### Secondary Colors (Success & Growth)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-secondary` | `#059669` | Success messages, confirmations |
| `--color-secondary-light` | `#10B981` | Success hover |

### Accent Colors (Clarity & Biochemistry)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-accent` | `#0891B2` | Links, interactive elements, CTAs |
| `--color-accent-light` | `#0EA5E9` | Link hover |

### Neutral Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-background` | `#F8FAFC` | Page background |
| `--color-foreground` | `#0F172A` | Primary text |
| `--color-foreground-secondary` | `#4B5563` | Secondary text |
| `--color-foreground-muted` | `#9CA3AF` | Placeholders, hints |
| `--color-muted` | `#F1F5F9` | Card backgrounds |
| `--color-border` | `#E5E7EB` | Borders, dividers |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#059669` | Success states |
| `--color-warning` | `#D97706` | Warnings |
| `--color-destructive` | `#DC2626` | Errors, delete actions |
| `--color-info` | `#0284C7` | Information messages |

---

## 📐 Typography

### Font Family

```css
font-family: var(--font-sans);
/* Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ... */
```

**Google Fonts Import:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### Type Scale

| Size | Token | px | rem | Usage |
|------|-------|----|-----|-------|
| XS | `--text-xs` | 12px | 0.75rem | Captions, labels |
| SM | `--text-sm` | 14px | 0.875rem | Secondary text, form labels |
| **Base** | `--text-base` | **16px** | **1rem** | **Body text** |
| LG | `--text-lg` | 18px | 1.125rem | Emphasized text |
| XL | `--text-xl` | 20px | 1.25rem | Subheadings |
| 2XL | `--text-2xl` | 24px | 1.5rem | Section headings |
| 3XL | `--text-3xl` | 30px | 1.875rem | Hero subheadings |
| 4XL | `--text-4xl` | 36px | 2.25rem | Main headings |
| 5XL | `--text-5xl` | 48px | 3rem | Hero titles |

### Font Weights

| Weight | Token | Usage |
|--------|-------|-------|
| Light | `--font-light` (300) | Display text |
| Normal | `--font-normal` (400) | Body text |
| Medium | `--font-medium` (500) | Buttons, labels |
| **Semibold** | `--font-semibold` (600) | **Headings** |
| Bold | `--font-bold` (700) | Strong emphasis |

---

## 📏 Spacing System

**Base Unit:** 4px (0.25rem)

| Points | Token | px | rem | Usage |
|--------|-------|----|-----|-------|
| 1 | `--space-1` | 4px | 0.25rem | Micro gaps |
| 2 | `--space-2` | 8px | 0.5rem | Small gaps, icon spacing |
| 3 | `--space-3` | 12px | 0.75rem | Compact padding |
| **4** | `--space-4` | **16px** | **1rem** | **Standard padding** |
| 5 | `--space-5` | 20px | 1.25rem | Medium gaps |
| 6 | `--space-6` | 24px | 1.5rem | Card padding |
| 8 | `--space-8` | 32px | 2rem | Section gaps |
| 10 | `--space-10` | 40px | 2.5rem | Large gaps |
| 12 | `--space-12` | 48px | 3rem | Hero padding |

---

## □ Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-none` | 0px | Sharp corners |
| `--radius-sm` | 4px | Inputs, small buttons |
| **`--radius-md`** | **8px** | **Default (cards, buttons)** |
| `--radius-lg` | 12px | Large cards |
| `--radius-xl` | 16px | Modals, hero |
| `--radius-full` | 9999px | Circular |

---

## 🌈 Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-none` | `none` | Flat |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| **`--shadow-md`** | `0 4px 6px -1px rgba(0,0,0,0.1)` | **Cards, buttons** |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1)` | Modals |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1)` | Hero |

---

## ⏱️ Transitions

### Timing Functions

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | **Default** |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Exit animations |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Entrance animations |

### Durations

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 100ms | Micro-interactions |
| **`--duration-normal`** | **200ms** | **Default (hover, focus)** |
| `--duration-slow` | 300ms | Modals, complex |
| `--duration-slower` | 400ms | Page transitions |

### Common Transitions

```css
transition: var(--transition-all);           /* All properties, 200ms */
transition: var(--transition-colors);       /* Colors only, 200ms */
transition: var(--transition-opacity);      /* Opacity only, 200ms */
transition: var(--transition-transform);    /* Transform only, 200ms */
```

---

## 📱 Breakpoints

| Token | Width | Device |
|-------|-------|--------|
| `--breakpoint-xs` | 0px | Mobile (portrait) |
| `--breakpoint-sm` | 640px | Mobile (landscape) |
| `--breakpoint-md` | 768px | Tablet (portrait) |
| `--breakpoint-lg` | 1024px | Tablet (landscape) |
| `--breakpoint-xl` | 1280px | Desktop |
| `--breakpoint-2xl` | 1536px | Large desktop |

---

## 🏗️ Component Tokens

### Buttons

```css
/* Sizes */
--btn-padding-sm: 8px 16px;    /* Small */
--btn-padding-md: 12px 24px;   /* Medium (default) */
--btn-padding-lg: 16px 32px;   /* Large */

/* Style */
--btn-radius: 8px;
--btn-font-weight: 500;
```

### Cards

```css
--card-radius: 12px;
--card-padding: 24px;
--card-shadow: var(--shadow-sm);
--card-shadow-hover: var(--shadow-md);
```

### Inputs

```css
--input-padding: 12px 16px;
--input-radius: 8px;
--input-font-size: 16px;
--input-border: 1px solid var(--color-border);
```

### Modals

```css
--modal-radius: 16px;
--modal-padding: 32px;
--modal-shadow: var(--shadow-xl);
--modal-max-width: 500px;
--modal-scrim: rgba(0, 0, 0, 0.5);
```

---

## 🎯 Design Principles

### ✅ DO

- Use **Inter** for all text
- Use **CSS variables** for all colors/spacing
- Maintain **4.5:1 contrast** minimum
- Use **200ms transitions** for hover/focus
- Add **`cursor: pointer`** to all clickable elements
- Import Google Fonts with **`display=swap`**

### ❌ DON'T

- Use **emojis as icons** → Use Lucide (`lucide-react`)
- Use **hardcoded colors** → Use tokens
- Use **arbitrary spacing** → Use spacing tokens
- Use **`!important`** → Avoid at all costs
- Use **`margin: 13px`** → Use `--space-3` or `--space-4`
- Forget **keyboard navigation** → Focus states required

---

## 🚀 Quick Start

### 1. Import Tokens

```css
/* In your main CSS file */
@import url('src/styles/tokens.css');
```

### 2. Use Tokens in CSS

```css
.button {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: var(--transition-colors);
}

.button:hover {
  background: var(--color-primary-light);
}
```

### 3. Use Tokens in HTML

```html
<button class="btn btn-primary">
  <svg class="icon" width="16" height="16"><use href="#icon-save"/></svg>
  <span>Uložit</span>
</button>
```

---

## ♿ Accessibility Checklist

- [ ] Text contrast >= **4.5:1** (normal), >= **3:1** (large)
- [ ] `cursor: pointer` on all clickable elements
- [ ] `alt` text on all meaningful images
- [ ] Labels on all form fields
- [ ] Focus indicators visible
- [ ] Keyboard navigation works
- [ ] Touch targets >= **44x44px**
- [ ] Reduced motion respected
- [ ] Dynamic text size supported
- [ ] Czech diacritics render correctly

---

## 📚 Resources

- **Full Design System:** [`design-system/MASTER.md`](./MASTER.md)
- **CSS Tokens:** [`src/styles/tokens.css`](../src/styles/tokens.css)
- **Icon Library:** [Lucide React](https://lucide.dev)
- **Font Family:** [Inter on Google Fonts](https://fonts.google.com/specimen/Inter)
- **Color Palette Tester:** [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## 🇨🇿 Czech Localization Notes

- **Diacritics:** á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž
- **Date Format:** DD.MM.YYYY (08.07.2026)
- **Time Format:** HH:MM:SS (15:09:38)
- **Number Format:** 1 234,56 Kč (space thousands, comma decimal)
- **Font:** Inter fully supports Czech characters ✓

---

*Generated: 2026-07-08 | Version: 1.0.0 | Project: BiochemCalc*