# UI Guidelines

> Source of truth for all UI work in `@mattstack/glance-react` (packages/glance-react).

---

## Tech Stack

| Layer         | Technology                              |
| ------------- | ---------------------------------------- |
| Framework     | React 19                                |
| Build         | Vite                                    |
| Package Mgr   | Bun                                     |
| UI Components | shadcn/ui (Radix primitives + Tailwind) |
| CSS           | Tailwind CSS v4 + GDS tokens            |

---

## CSS Architecture

### File Structure

```
palette.css     Raw hex values for glance-react's own token system (GDS)
    ↓
tokens.css      Semantic assignments + shadcn bridge (maps GDS to shadcn tokens)
    ↓
styles.css      Tailwind @theme (3-tier color system) + @utility classes
    ↓
Components      Use Tailwind utilities, CVA variants, and surface utility classes
```

| File           | Contents                                                    | Editable? |
| -------------- | ------------------------------------------------------------ | --------- |
| `palette.css`  | Raw hex values; single source of truth for all colors        | No        |
| `tokens.css`   | Semantic token assignments, shadcn bridge, dark/light modes  | No        |
| `styles.css`   | Tailwind theme registration, surface utilities, base styles  | Yes       |
| `inter.css`    | Inter/InterVariable font-face declarations                   | No        |
| `mono.css`     | Monospace font-face declarations                              | No        |

`GDS` is this package's own internal name for its design-token system: it shows
up as the `gds.*` CSS `@layer` names and the `--gds-*` custom properties in
`tokens.css`. It is not an external design system; it lives entirely in this
package.

### 3-Tier Tailwind Theme

The `@theme inline` block in `styles.css` exposes colors in three tiers:

**Tier 1: Raw Palette** (shade numbers, like standard Tailwind):
```
bg-blue-500, text-red-300, border-green-700
```

**Tier 2: Smart Defaults** (bare name = theme-appropriate shade):
```
bg-blue, text-red, border-green
```

**Tier 3: Semantic Tokens** (domain vocabulary):
```
bg-emphasis, text-positive, border-caution, border-l-draft
```

> Always prefer Tier 3 (semantic) in component code. Use Tier 1/2 only when there's no semantic match.

### Dark Mode

GDS tokens auto-resolve via `data-theme="dark"` / `data-theme="light"` on `<html>`. No manual `.dark` overrides needed in component code.

---

## Semantic Color Vocabulary

All colors in components must use **semantic names**. Tailwind's default palette is supplemented, not replaced, but semantic tokens should always be preferred.

### Intent Colors (3 contrast levels each)

| Token      | Utilities                                            | Meaning                             |
| ---------- | ---------------------------------------------------- | ------------------------------------ |
| `emphasis` | `bg-emphasis`, `text-emphasis-bright`, `bg-emphasis-high` | Primary actions, info, selected (blue)  |
| `action`   | `bg-action`, `text-action-bright`, `bg-action-high`      | Generic action color (purple)           |
| `positive` | `bg-positive`, `text-positive-bright`, `bg-positive-high` | Success, additions, approved (green)    |
| `negative` | `bg-negative`, `text-negative-bright`, `bg-negative-high` | Errors, deletions, destructive (red)    |
| `caution`  | `bg-caution`, `text-caution-bright`, `bg-caution-high`    | Warnings, conflicts, blocked (amber)    |

### Domain Colors

| Token   | Aliases          | Meaning                                 |
| ------- | ---------------- | ----------------------------------------- |
| `merge` | action (purple)  | Git merge/publish operations              |
| `draft` | border (gray)    | Draft/inactive/unpublished state          |

Use `merge` for git merge/publish/push operations. Use `action` for non-merge purple actions. Use `draft` for muted inactive states (e.g., `border-l-draft`).

### Surface Colors

| Token     | Meaning                         |
| --------- | ---------------------------------- |
| `neutral` | Neutral interactive surfaces    |
| `neutral-hover` | Neutral hover state       |

---

## Surface Utility Classes

Pre-built utility classes for applying consistent background + foreground treatment. These are the **standard way** to color any surface element.

### Filled (`filled-*`)
Solid background + white foreground. Use for primary CTAs.

```tsx
<button className="filled-emphasis hover:bg-filled-emphasis-hover">Save</button>
<button className="filled-merge hover:bg-filled-merge-hover">Merge</button>
```

### Subtle (`subtle-*`)
Tinted background (25% opacity) + high-contrast foreground. Use for cards, banners, status regions.

```tsx
<div className="subtle-positive rounded-md p-2">Success message</div>
<div className="subtle-caution rounded-md p-2">Warning banner</div>
```

### Subtle High (`subtle-*-high`)
Higher contrast (40% opacity) for elements that stack on already-tinted surfaces (e.g., icon circles on subtle cards).

```tsx
<div className="subtle-neutral">                    {/* card background */}
  <div className="subtle-neutral-high rounded-full"> {/* icon circle */}
```

### Outline (`outline-*`)
Colored border + high-contrast foreground. Pair with `bg-transparent`.

```tsx
<span className="outline-positive border rounded-full px-2">Passed</span>
```

### Ghost (`ghost-*`)
Transparent background + colored text. Consumer adds their own hover.

```tsx
<button className="ghost-emphasis hover:bg-emphasis/15">Edit</button>
```

### Complete Matrix

| Color    | `filled-*` | `subtle-*` | `subtle-*-high` | `outline-*` | `ghost-*` |
| -------- | ---------- | ---------- | ----------------- | ----------- | --------- |
| emphasis | yes        | yes        | yes                | yes         | yes       |
| merge    | yes        | yes        | yes                | yes         | yes       |
| action   | yes        | yes        | yes                | yes         | yes       |
| positive | yes        | yes        | yes                | yes         | yes       |
| negative | yes        | yes        | yes                | yes         | yes       |
| caution  | yes        | yes        | yes                | yes         | yes       |
| neutral  | yes        | yes        | yes                | yes         | n/a       |

---

## MR Status to Token Mapping

All forge components use a consistent status to semantic color mapping:

| Status     | Border           | Header          | Icon              |
| ---------- | ------------------ | ----------------- | ------------------- |
| mergeable  | `border-l-positive` | `subtle-positive` | `subtle-positive-high` |
| merged     | `border-l-action`   | `subtle-action`   | `subtle-action-high`   |
| blocked    | `border-l-caution`  | `subtle-caution`  | `subtle-caution-high`  |
| closed     | `border-l-negative` | `subtle-negative` | `subtle-negative-high` |
| draft      | `border-l-draft`    | `subtle-neutral`  | `subtle-neutral-high`  |

---

## Component Rules

### Use Variants, Not Manual Classes

```tsx
// Correct: use component variant props
<Button variant="filled" color="merge" size="sm">Merge</Button>
<Badge variant="subtle" color="positive">Approved</Badge>

// Wrong: manual class composition
<Button className="bg-positive text-primary-foreground">Merge</Button>
```

### Use Surface Utilities for Custom Elements

```tsx
// Correct: reusable utility pattern
<div className="subtle-positive rounded-md p-2">Success</div>
<div className="filled-emphasis rounded-md px-4">Primary</div>

// Wrong: manual bg + text composition
<div className="bg-positive/25 text-positive-bright rounded-md p-2">Success</div>
```

### Use Semantic Tokens for Borders

```tsx
// Correct: semantic domain token
<div className="border-l-2 border-l-draft">Draft content</div>

// Wrong: primitive token
<div className="border-l-2 border-l-border">Draft content</div>
<div className="border-l-2 border-l-secondary">Draft content</div>
```

### Stacking: Use `-high` Variants

When placing a subtle element on top of another subtle surface, use the `-high` variant for contrast:

```tsx
// Correct: visible contrast
<div className="subtle-neutral">
  <div className="subtle-neutral-high rounded-full size-5">
    <Icon />
  </div>
</div>

// Wrong: invisible on tinted surface
<div className="subtle-neutral">
  <div className="subtle-neutral rounded-full size-5">
    <Icon />
  </div>
</div>
```

### Never Reference `btn-*` or `accent-*-bg/text` Tokens

These internal CSS custom properties are implementation details. Always use the semantic utilities:

| Don't use                 | Use instead          |
| -------------------------- | --------------------- |
| `bg-btn-merge`            | `filled-merge`      |
| `bg-btn-emphasis`         | `filled-emphasis`   |
| `bg-btn-neutral`          | `bg-neutral`        |
| `bg-btn-neutral-hover`    | `bg-neutral-hover`  |
| `text-btn-merge`          | `text-merge-bright` |
| `bg-accent-positive-bg`   | `subtle-positive`   |
| `bg-accent-negative-bg`   | `subtle-negative`   |

---

## General Code Rules

### 1. Use `cn()` for Class Name Merging

```tsx
<div className={cn('flex items-center', isActive && 'bg-accent')} />
```

### 2. Extend Tokens, Don't Hardcode

Add new tokens to `tokens.css` referencing `palette.css` vars. Never add one-off hex values to components.

### 3. Use Import Aliases

| Alias             | Path                |
| ----------------- | ---------------------- |
| `@/components`    | `lib/components`    |
| `@/components/ui` | `lib/components/ui` |
| `@/utils`         | `lib/utils`          |

### 4. Do Not Overwrite shadcn Components

When installing new shadcn components via CLI, **never overwrite existing files**. Our components contain customized CVA variants that would be lost.

### 5. Raw `bg-{color}` Is OK for Tiny Indicators

Pixel-level decorative dots (e.g., diff dots, status indicators) may use raw `bg-positive` / `bg-negative` without a utility wrapper. Anything larger than ~4px should use a surface utility.
