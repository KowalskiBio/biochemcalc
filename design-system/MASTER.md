# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** BiochemCalc
**Generated:** 2026-07-08 15:09:38
**Category:** Teacher-Facing Biochemistry Assignment Generator
**Audience:** Czech Biochemistry Teachers (Professional Educators)

---

## Global Rules

### Design Philosophy

BiochemCalc embodies **precision, clarity, and trust** - qualities essential for biochemistry education. The design system prioritizes:

- **Professional Trust**: Colors and typography that convey authority and reliability
- **Czech Context**: Culturally appropriate design for Czech educators
- **Biochemistry Focus**: Subtle molecular/biochemical inspiration in the palette
- **Accessibility First**: WCAG AAA compliance for all color choices
- **Educator-Friendly**: Clean, uncluttered interfaces that don't distract from content

### Color Palette

**Primary Palette - Professional Biochemistry Trust**

| Role | Hex | CSS Variable | Usage | Accessibility Notes |
|------|-----|--------------|-------|---------------------|
| Primary | `#1E40AF` | `--color-primary` | Primary actions, headings, key UI elements | 7:1 contrast on white |
| Primary Light | `#3B82F6` | `--color-primary-light` | Hover states, secondary emphasis | 6.5:1 contrast on white |
| On Primary | `#FFFFFF` | `--color-on-primary` | Text on primary background | Passes WCAG AAA |
| Secondary | `#059669` | `--color-secondary` | Success states, confirmations | 4.5:1+ contrast |
| Secondary Light | `#10B981` | `--color-secondary-light` | Success hover, highlights | Maintains contrast |
| Accent | `#0891B2` | `--color-accent` | Links, interactive elements, CTAs | 4.5:1+ contrast |
| Accent Light | `#0EA5E9` | `--color-accent-light` | Link hover, active states | Clear visual feedback |

**Neutral Palette**

| Role | Hex | CSS Variable | Usage | Notes |
|------|-----|--------------|-------|-------|
| Background | `#F8FAFC` | `--color-background` | Page backgrounds | Subtle blue undertone |
| Foreground | `#0F172A` | `--color-foreground` | Primary text | Deep charcoal, not pure black |
| Foreground Secondary | `#4B5563` | `--color-foreground-secondary` | Secondary text, descriptions | Readable but subordinate |
| Foreground Muted | `#9CA3AF` | `--color-foreground-muted` | Placeholders, hints, disabled text | Low emphasis |
| Muted | `#F1F5F9` | `--color-muted` | Card backgrounds, elevated surfaces | Subtle elevation |
| Muted Dark | `#E5E7EB` | `--color-muted-dark` | Borders, dividers | Clear separation |
| Border | `#E5E7EB` | `--color-border` | UI borders, separators | Neutral and professional |
| Border Strong | `#D1D5DB` | `--color-border-strong` | High-emphasis borders | When clarity is critical |

**Semantic Colors**

| Role | Hex | CSS Variable | Usage | Contrast Ratio |
|------|-----|--------------|-------|----------------|
| Success | `#059669` | `--color-success` | Success messages, checkmarks | 4.5:1 on white |
| Success Light | `#D1FAE5` | `--color-success-light` | Success backgrounds | Subtle tint |
| Warning | `#D97706` | `--color-warning` | Warnings, alerts | 4.5:1 on white |
| Warning Light | `#FEF3C7` | `--color-warning-light` | Warning backgrounds | Subtle tint |
| Error/Destructive | `#DC2626` | `--color-destructive` | Errors, delete actions | 7:1 on white |
| Error Light | `#FEE2E2` | `--color-destructive-light` | Error backgrounds | Subtle tint |
| Info | `#0284C7` | `--color-info` | Information messages | 4.5:1 on white |
| Info Light | `#DBEAFE` | `--color-info-light` | Info backgrounds | Subtle tint |

**Gradient Accents (Sparingly Used)**

| Name | Value | CSS Variable | Usage |
|------|-------|--------------|-------|
| Primary Gradient | `linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)` | `--gradient-primary` | Hero sections, feature highlights |
| Biochemistry Gradient | `linear-gradient(135deg, #059669 0%, #0891B2 100%)` | `--gradient-biochem` | Accent backgrounds |

**Color Rationale:**
- **Primary Blue (#1E40AF)**: Conveys trust, stability, and professionalism - essential for educational tools
- **Secondary Green (#059669)**: Represents growth, learning, and positive outcomes
- **Accent Cyan (#0891B2)**: Adds a molecular/biochemical feel (water = life), also represents clarity
- **Neutrals**: Carefully selected to avoid sterility while maintaining professionalism

### Typography

**Font Family:**
- **Primary Font:** Inter
- **Fallback Stack:** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif`
- **Google Fonts URL:** `https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap`

**Why Inter?**
- Exceptional readability at all sizes
- Comprehensive weight range (300-700)
- Professional, clean aesthetic
- Excellent Czech character support (accented characters)
- Variable font available for performance optimization
- Widely used in educational and professional applications

**Type Scale:**

| Token | Size (px) | Size (rem) | Line Height | Letter Spacing | Usage |
|-------|-----------|------------|-------------|----------------|-------|
| `--text-xs` | 12px | 0.75rem | 1.5 (18px) | 0.02em | Captions, labels, small helpers |
| `--text-sm` | 14px | 0.875rem | 1.5 (21px) | 0.01em | Secondary text, form labels |
| `--text-base` | 16px | 1rem | 1.625 (26px) | 0 | Body text, paragraphs |
| `--text-lg` | 18px | 1.125rem | 1.556 (28px) | -0.01em | Emphasized text, large body |
| `--text-xl` | 20px | 1.25rem | 1.5 (30px) | -0.01em | Subheadings, card titles |
| `--text-2xl` | 24px | 1.5rem | 1.417 (34px) | -0.02em | Section headings |
| `--text-3xl` | 30px | 1.875rem | 1.333 (40px) | -0.02em | Hero subheadings |
| `--text-4xl` | 36px | 2.25rem | 1.278 (46px) | -0.02em | Main headings |
| `--text-5xl` | 48px | 3rem | 1.167 (56px) | -0.03em | Hero titles |

**Font Weights:**

| Token | Weight | Usage |
|-------|--------|-------|
| `--font-light` | 300 | Decorative, large display text |
| `--font-normal` | 400 | Body text, default |
| `--font-medium` | 500 | Emphasis, buttons, labels |
| `--font-semibold` | 600 | Headings, important text |
| `--font-bold` | 700 | Strong emphasis, titles |

**Typography Best Practices:**
- **Czech Text:** Ensure proper rendering of accented characters (á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ž)
- **Line Length:** Keep body text between 45-75 characters per line for optimal readability
- **Hierarchy:** Use semantic heading levels (h1 > h2 > h3 > h4) with appropriate size and weight
- **Contrast:** Maintain minimum 4.5:1 contrast ratio for all text

### Spacing System

**Base Unit:** 4px (0.25rem)

| Token | Value (px) | Value (rem) | Usage |
|-------|------------|-------------|-------|
| `--space-0` | 0px | 0rem | Reset spacing |
| `--space-1` | 4px | 0.25rem | Micro gaps, icon padding |
| `--space-2` | 8px | 0.5rem | Small gaps, inline spacing |
| `--space-3` | 12px | 0.75rem | Compact padding |
| `--space-4` | 16px | 1rem | **Standard padding** (most common) |
| `--space-5` | 20px | 1.25rem | Medium gaps |
| `--space-6` | 24px | 1.5rem | Card padding, section gaps |
| `--space-8` | 32px | 2rem | Large gaps, section margins |
| `--space-10` | 40px | 2.5rem | XL gaps |
| `--space-12` | 48px | 3rem | Section margins, hero padding |
| `--space-16` | 64px | 4rem | Large sections |
| `--space-20` | 80px | 5rem | Hero sections |
| `--space-24` | 96px | 6rem | Page margins |

**Spacing Guidelines:**
- Use spacing tokens consistently - avoid arbitrary pixel values
- Maintain vertical rhythm by using spacing tokens from the scale
- Prefer even-numbered spacing tokens for predictable patterns
- Component internal spacing: use smaller tokens (space-2 to space-6)
- Component external spacing (margins): use larger tokens (space-6 to space-16)

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-none` | 0px | Sharp corners (tables, code blocks) |
| `--radius-sm` | 4px | Subtle rounding (inputs, small buttons) |
| `--radius-md` | 8px | **Default rounding** (cards, buttons, containers) |
| `--radius-lg` | 12px | Pronounced rounding (large cards, modals) |
| `--radius-xl` | 16px | Soft rounding (hero containers, feature cards) |
| `--radius-2xl` | 24px | Strong rounding (pills, badges) |
| `--radius-full` | 9999px | Circular elements (avatars, circular buttons) |

### Shadows

**Design Approach:** Flat design with subtle shadows for depth. Shadows are used sparingly to maintain clean aesthetic while providing necessary hierarchy.

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-none` | `none` | Flat elements |
| `--shadow-sm` | `0 1px 2px 0 rgba(0, 0, 0, 0.05)` | Subtle lift (cards, elevated surfaces) |
| `--shadow-md` | `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)` | Standard depth (cards, dropdowns) |
| `--shadow-lg` | `0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)` | Pronounced depth (modals, flyouts) |
| `--shadow-xl` | `0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)` | Maximum depth (hero, featured content) |

**Color Adaptive Shadows:** Shadows adapt to light/dark mode by using CSS color-mix() for consistent visibility.

### Transitions & Animation

**Timing Functions:**

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default easing (most transitions) |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Exit animations, movement |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Entrance animations |
| `--linear` | `linear` | Continuous animations (spinners) |

**Durations:**

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-instant` | 0ms | Immediate feedback |
| `--duration-fast` | 100ms | Micro-interactions, tap feedback |
| `--duration-normal` | 200ms | **Default duration** (hover states, focus states) |
| `--duration-slow` | 300ms | Modal opens, complex transitions |
| `--duration-slower` | 400ms | Page transitions, large expansions |
| `--duration-slowest` | 500ms | Maximum duration (rarely used) |

**Transition Properties:**

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-all` | `all 200ms var(--ease-in-out)` | General transitions |
| `--transition-colors` | `color 200ms var(--ease-in-out), background-color 200ms var(--ease-in-out), border-color 200ms var(--ease-in-out)` | Color changes |
| `--transition-opacity` | `opacity 200ms var(--ease-in-out)` | Fade effects |
| `--transition-shadow` | `box-shadow 200ms var(--ease-in-out)` | Shadow changes |
| `--transition-transform` | `transform 200ms var(--ease-in-out)` | Movement, scaling |

**Animation Rules:**
- **Reduced Motion:** Respect `prefers-reduced-motion: reduce`
- **No Animation Class:** `.reduce-motion` disables all non-essential animations
- **Performance:** Use `transform` and `opacity` for smooth animations
- **Avoid:** Animating `width`, `height`, `top`, `left` (triggers layout recalculations)

### Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | 0 | Default layer |
| `--z-raised` | 10 | Slightly elevated (card hover) |
| `--z-dropdown` | 100 | Dropdowns, popovers |
| `--z-sticky` | 200 | Sticky headers/footers |
| `--z-fixed` | 300 | Fixed position elements |
| `--z-modal-backdrop` | 400 | Modal overlay/scrim |
| `--z-modal` | 500 | Modal dialog |
| `--z-tooltip` | 600 | Tooltips, popups |
| `--z-notification` | 700 | Notifications, toasts |
| `--z-max` | 9999 | Maximum priority |

---

## Component Specs

### Buttons

**Base Styles:**
```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: 1;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-all);
  white-space: nowrap;
  border: none;
  text-decoration: none;
}

.btn:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

**Variants:**

```css
/* Primary - Main actions, CTAs */
.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--color-primary-light);
}

/* Secondary - Alternative actions */
.btn-secondary {
  background-color: var(--color-muted);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-muted-dark);
}

/* Accent - Important but secondary actions */
.btn-accent {
  background-color: var(--color-accent);
  color: var(--color-on-primary);
}

.btn-accent:hover:not(:disabled) {
  background-color: var(--color-accent-light);
}

/* Outline - Subtle actions */
.btn-outline {
  background-color: transparent;
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--color-muted);
  border-color: var(--color-border-strong);
}

/* Ghost - Minimal emphasis */
.btn-ghost {
  background-color: transparent;
  color: var(--color-foreground);
}

.btn-ghost:hover:not(:disabled) {
  background-color: var(--color-muted);
}

/* Destructive - Dangerous actions */
.btn-destructive {
  background-color: var(--color-destructive);
  color: var(--color-on-primary);
}

.btn-destructive:hover:not(:disabled) {
  background-color: #B91C1C;
}

/* Icon Button */
.btn-icon {
  padding: var(--space-2);
  width: var(--space-10);
  height: var(--space-10);
}

/* Size Variants */
.btn-sm {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
}

.btn-lg {
  padding: var(--space-4) var(--space-8);
  font-size: var(--text-base);
}
```

**Button Sizes:**

| Size | Padding | Font Size | Usage |
|------|---------|-----------|-------|
| Small | 8px 16px | 12px | Toolbar actions, dense layouts |
| Medium | 12px 24px | 14px | **Default** (most buttons) |
| Large | 16px 32px | 16px | Primary CTAs, important actions |

### Cards

```css
.card {
  background-color: var(--color-muted);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: var(--transition-shadow);
  border: 1px solid var(--color-border);
}

.card:hover {
  box-shadow: var(--shadow-md);
}

.card-interactive {
  cursor: pointer;
}

.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.card-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--color-foreground);
  margin-bottom: var(--space-3);
}

.card-description {
  font-size: var(--text-sm);
  color: var(--color-foreground-secondary);
  margin-bottom: var(--space-4);
}
```

### Inputs

```css
.input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--color-foreground);
  background-color: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: var(--transition-colors);
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light-10);
}

.input:disabled {
  background-color: var(--color-muted);
  color: var(--color-foreground-muted);
  cursor: not-allowed;
}

.input::placeholder {
  color: var(--color-foreground-muted);
}

/* Input Variants */
.input-error {
  border-color: var(--color-destructive);
}

.input-success {
  border-color: var(--color-success);
}

.input-warning {
  border-color: var(--color-warning);
}
```

**Label Styles:**
```css
.label {
  display: block;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-foreground);
  margin-bottom: var(--space-2);
}

.label-required:after {
  content: "*";
  color: var(--color-destructive);
  margin-left: var(--space-1);
}

.label-description {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-foreground-muted);
  margin-top: var(--space-1);
}
```

### Forms

```css
.form-field {
  margin-bottom: var(--space-5);
}

.form-error {
  font-size: var(--text-sm);
  color: var(--color-destructive);
  margin-top: var(--space-2);
}

.form-success {
  font-size: var(--text-sm);
  color: var(--color-success);
  margin-top: var(--space-2);
}

.form-hint {
  font-size: var(--text-xs);
  color: var(--color-forecast-muted);
  margin-top: var(--space-1);
}
```

### Modals & Dialogs

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  z-index: var(--z-modal-backdrop);
  animation: fade-in 200ms var(--ease-out);
}

.modal {
  background-color: var(--color-background);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  z-index: var(--z-modal);
  animation: slide-up 300ms var(--ease-out);
}

.modal-header {
  margin-bottom: var(--space-6);
}

.modal-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--color-foreground);
}

.modal-body {
  margin-bottom: var(--space-8);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.modal-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-foreground-muted);
  padding: var(--space-2);
}

.modal-close:hover {
  color: var(--color-foreground);
}
```

### Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.badge-primary {
  background-color: var(--color-primary-light-10);
  color: var(--color-primary);
}

.badge-secondary {
  background-color: var(--color-secondary-light-10);
  color: var(--color-secondary);
}

.badge-success {
  background-color: var(--color-success-light);
  color: var(--color-success);
}

.badge-warning {
  background-color: var(--color-warning-light);
  color: var(--color-warning);
}

.badge-destructive {
  background-color: var(--color-destructive-light);
  color: var(--color-destructive);
}

.badge-info {
  background-color: var(--color-info-light);
  color: var(--color-info);
}

.badge-muted {
  background-color: var(--color-muted);
  color: var(--color-foreground-muted);
}
```

### Tooltips

```css
.tooltip {
  position: relative;
  display: inline-block;
}

.tooltip-content {
  position: absolute;
  z-index: var(--z-tooltip);
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  color: var(--color-background);
  background-color: var(--color-foreground);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  animation: fade-in 150ms var(--ease-out);
}

.tooltip-content:after {
  content: "";
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--color-foreground);
}
```

### Alerts

```css
.alert {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  border: 1px solid;
}

.alert-icon {
  flex-shrink: 0;
}

.alert-content {
  flex: 1;
}

.alert-title {
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-1);
}

.alert-description {
  font-size: var(--text-sm);
}

.alert-info {
  background-color: var(--color-info-light);
  color: var(--color-info);
  border-color: var(--color-info-light-10);
}

.alert-success {
  background-color: var(--color-success-light);
  color: var(--color-success);
  border-color: var(--color-success-light-10);
}

.alert-warning {
  background-color: var(--color-warning-light);
  color: var(--color-warning);
  border-color: var(--color-warning-light-10);
}

.alert-destructive {
  background-color: var(--color-destructive-light);
  color: var(--color-destructive);
  border-color: var(--color-destructive-light-10);
}
```

### Tabs

```css
.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-6);
}

.tab {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-foreground-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: var(--transition-colors);
}

.tab:hover {
  color: var(--color-foreground);
}

.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
  animation: fade-in 200ms var(--ease-out);
}
```

### Tables

```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.table th,
.table td {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.table th {
  font-weight: var(--font-semibold);
  color: var(--color-foreground-secondary);
  background-color: var(--color-muted);
}

.table tbody tr:hover {
  background-color: var(--color-muted);
}

.table tbody tr.selected {
  background-color: var(--color-primary-light-10);
}

.table th:first-child,
.table td:first-child {
  padding-left: 0;
}

.table th:last-child,
.table td:last-child {
  padding-right: 0;
}
```

---

## Style Guidelines

### Design Style: Flat Design with Professional Touch

**Style Name:** Professional Flat

**Keywords:**
- Clean, minimalist, typography-focused
- No excessive shadows or gradients
- Clear lines, simple shapes
- Professional, trustworthy, educational

**Best For:**
- Educational applications
- Teacher-facing tools
- Professional SaaS products
- Biochemistry and scientific applications

**Key Effects:**
- Subtle shadows for depth (not decorative)
- Simple hover states (color shifts, opacity changes)
- Clean transitions (150-300ms)
- Minimal icon usage - only when necessary
- Focus on content clarity

### Page Pattern: Structured Content

**Pattern Name:** Educational Dashboard

**Structure:**
1. **Header:** Logo, navigation, user menu
2. **Sidebar:** Main navigation (collapsible on mobile)
3. **Main Content:** Primary workspace
4. **Footer:** Copyright, links

**Layout Principles:**
- **Mobile-First:** Design for smallest screens first
- **Responsive Breakpoints:** 375px, 768px, 1024px, 1440px
- **Max Content Width:** 1280px for desktop
- **Gutters:** 24px on mobile, 32px on tablet+, 48px on desktop

### Layout Grid

```css
.container {
  width: 100%;
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--gutter);
}
```

**Breakpoints:**

| Token | Min-Width | Usage |
|-------|-----------|-------|
| `--breakpoint-xs` | 0px | Mobile (portrait) |
| `--breakpoint-sm` | 640px | Mobile (landscape) |
| `--breakpoint-md` | 768px | Tablet (portrait) |
| `--breakpoint-lg` | 1024px | Tablet (landscape)/Small desktop |
| `--breakpoint-xl` | 1280px | Desktop |
| `--breakpoint-2xl` | 1536px | Large desktop |

### Iconography

**Icon Set:** Lucide React (`lucide-react`)

**Why Lucide:**
- Open-source, actively maintained
- Clean, minimalist design
- Consistent with Flat Design aesthetic
- Excellent icon coverage for educational/scientific use
- Community-driven, no licensing concerns

**Icon Sizes:**

| Context | Size | Token |
|---------|------|-------|
| Small UI | 14px | `--icon-sm` |
| **Default** | **16px** | `--icon-md` |
| Buttons | 18px | `--icon-lg` |
| Large UI | 20px | `--icon-xl` |
| Display | 24px+ | Custom |

**Icon Usage Rules:**
- Always use consistent icon set (NO mixing icon libraries)
- Maintain consistent size within a context
- Use `cursor-pointer` on clickable icons
- Provide text labels or aria-labels for accessibility
- Never use icons alone for critical actions

**Icon + Text Spacing:**
- Gap between icon and text: `var(--space-2)` (8px)
- Icon-first in LTR languages (Czech = LTR)

---

## Anti-Patterns (Do NOT Use)

### Forbidden UI Elements

- ❌ **Emojis as icons** — Use SVG icons (Lucide only)
- ❌ **Animated GIFs** — Use static images or SVG animations
- ❌ **Auto-playing videos** — User must initiate playback
- ❌ **Pop-up advertisements** — Never in educational tools
- ❌ **Dark mode by default** — Light mode is default; dark mode optional

### Forbidden CSS Practices

- ❌ **`!important` declarations** — Only in absolute emergencies
- ❌ **Magic numbers** — Always use design tokens
- ❌ **Inline styles** — Use classes or CSS-in-JS
- ❌ **Duplicate selectors** — Consolidate CSS rules
- ❌ **Unused CSS** — Regularly purge unused styles
- ❌ **Hardcoded colors** — Always use CSS variables
- ❌ **Arbitrary spacing** — Always use spacing tokens

### Forbidden Interaction Patterns

- ❌ **Missing cursor:pointer** — All clickable elements must have it
- ❌ **Hover-only affordances** — Must work on touch devices
- ❌ **Layout-shifting hovers** — Avoid transforms that move other content
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus must be visible for keyboard users
- ❌ **Broken back button** — Navigation must respect browser history
- ❌ **Scroll hijacking** — Never override native scroll behavior

### Forbidden Quality Issues

- ❌ **Low contrast text** — Minimum 4.5:1 contrast ratio
- ❌ **Broken links** — All links must resolve
- ❌ **Orphaned words** — Prevent single words on new lines
- ❌ **Widows** — Prevent single lines at top of page
- ❌ **Overlapping content** — Z-index management required
- ❌ **Hidden content on mobile** — Progressive enhancement only

---

## Pre-Delivery Checklist

### Visual Quality

- [ ] No emojis used as icons (Lucide SVG only)
- [ ] All icons from consistent icon set (Lucide)
- [ ] Official branding follows guidelines
- [ ] Pressed-state visuals do not shift layout
- [ ] Semantic theme tokens used consistently (no hardcoded colors)

### Interaction

- [ ] All tappable elements provide clear pressed feedback
- [ ] Touch targets meet minimum size (44x44px mobile, 48x48dp desktop)
- [ ] Micro-interaction timing: 150-300ms with native easing
- [ ] Disabled states are visually clear and non-interactive
- [ ] Screen reader focus order matches visual order
- [ ] All interactive labels are descriptive
- [ ] Gesture regions avoid nested/conflicting interactions

### Accessibility

- [ ] Primary text contrast >= 4.5:1 in both light and dark mode
- [ ] Secondary text contrast >= 3:1 in both modes
- [ ] Dividers/borders distinguishable in both themes
- [ ] Modal/drawer scrim opacity: 40-60% (legible foreground)
- [ ] Both light and dark themes tested
- [ ] All images have meaningful alt text
- [ ] Form fields have proper labels and hints
- [ ] Color is not the only information conveyor
- [ ] Reduced motion respected without layout breakage
- [ ] Dynamic text size supported without layout issues
- [ ] Keyboard navigation works throughout
- [ ] Focus indicators visible and appropriate

### Layout

- [ ] Safe areas respected for headers, footers, sidebars
- [ ] Scroll content not hidden behind fixed bars
- [ ] Verified on: 375px, 414px, 768px, 1024px, 1440px, 1920px
- [ ] Verified in both portrait and landscape orientations
- [ ] Horizontal insets adapt correctly by device size
- [ ] 4/8px spacing rhythm maintained
- [ ] Long-form text measure readable (45-75 chars/line)
- [ ] No horizontal scroll on any viewport

### Performance

- [ ] Images optimized (WebP format)
- [ ] Images have declared dimensions or aspect-ratio
- [ ] Lazy loading for below-the-fold content
- [ ] Fonts use `font-display: swap` or `optional`
- [ ] Third-party scripts loaded async/defer
- [ ] No layout thrashing (batch DOM reads/writes)
- [ ] Lists with 50+ items are virtualized
- [ ] Main thread work per frame < 16ms

### Code Quality

- [ ] All color references use design tokens
- [ ] All spacing uses system tokens
- [ ] All components follow composition patterns
- [ ] Consistent naming conventions (kebab-case for classes)
- [ ] No console logs in production
- [ ] No commented-out code
- [ ] Proper error boundaries

---

## Czech Localization Notes

### Typography

- Ensure proper rendering of Czech diacritics: **á, č, ď, é, ě, í, ň, ó, ř, š, ť, ú, ů, ý, ძ**
- Test with actual Czech text: "Biochemie pro studenty středních škol"
- Line height should accommodate ascenders and descenders with diacritics
- Font must support all Czech characters natively (Inter does)

### Date/Time Formatting

- Czech date format: **DD.MM.YYYY** (not MM/DD/YYYY)
- Czech time format: **HH:MM:SS** (24-hour clock)
- Czech number formatting: **1 234,56 Kč** (space thousands, comma decimal)

### Cultural Considerations

- **Color Associations:**
  - Red: Attention, stop (same as Western)
  - Green: Safe, positive (same as Western)
  - Blue: Trust, professionalism (strong positive)
  - Purple: Royalty, quality (neutral)
  - Avoid: Bright yellow + black combination (warning signs)

- **Imagery:**
  - Use culturally neutral scientific imagery
  - Avoid religious or political symbols
  - Laboratory equipment, molecules, DNA are safe

---

## Biochemistry-Specific Design

### Color Symbolism in Biochemistry

When using accent colors, consider:
- **Blue (#1E40AF):** Water, hydrophilic, aqueous solutions
- **Green (#059669):** Growth, plants, photosynthesis, health
- **Cyan (#0891B2):** Oxygen, water, cellular processes
- **Purple (#7C3AED):** (Use sparingly) pH indicators, some stains

### Molecular/Scientific Iconography

**Recommended Lucide Icons:**
- `flask-conical` - Laboratory equipment
- `microscope` - Research, analysis
- `dna-2` - Genetics, molecular biology
- `atom` - Chemistry, atoms
- `test-tube` - Experiments, lab work
- `brain` - Neuroscience, cognition
- `heart` - Physiology, health
- `activity` - Biological activity, monitoring
- `bar-chart-3` - Data, analytics
- `file-text` - Documents, assignments
- `book-open` - Learning, education
- `graduation-cap` - Academic, teacher
- `users` - Students, groups
- `settings` - Configuration
- `help-circle` - Help, support

### Assignment Generator UI Patterns

**Form Layouts:**
- Multi-step forms with clear progress indication
- Field groups for related options
- Real-time preview of generated assignments
- Clear validation messages

**Preview Styles:**
- Readable at a glance
- Proper formatting for printing
- Consistent with Czech educational standards

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-07-08 | 1.0.0 | Initial design system for BiochemCalc |
