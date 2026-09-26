---
name: glance-react design system (GDS)
description: >
  @mattstack/glance-react is the design system for its own React components:
  color palette, semantic tokens, dark/light mode, and the shadcn/Radix
  component set. Any app that installs this package should import its
  styles, tokens, and components rather than redefining equivalents. Read
  this before touching any CSS, Tailwind config, or color values in a
  package that consumes glance-react.
---

## Role

`@mattstack/glance-react` is the **single source of truth** for:

- Color palette (`lib/css/palette.css`)
- Semantic design tokens + dark/light mode (`lib/css/tokens.css`)
- shadcn/Radix UI components (`lib/components/`)
- Tailwind utility classes (`lib/css/styles.css`)
- Typography, spacing, and radius scales (`lib/css/tokens.css`)

**Never** define colors, shadow values, spacing tokens, or component styles in
a consumer app if an equivalent exists in glance-react.

---

## Consuming in a New App

### 1. Install the package

Inside this repo (a package added under `packages/*`), use the workspace protocol:

```json
{ "dependencies": { "@mattstack/glance-react": "workspace:*" } }
```

From an app in another repo, install the published npm package:

```bash
bun add @mattstack/glance-react
```

### 2. Import the stylesheet (one line)

```css
/* your-app/src/index.css */
@import '@mattstack/glance-react/styles.css';
```

This single import gives you everything:
- All GDS CSS custom properties (palette to tokens to shadcn bridge)
- Full `@theme inline` with all Tailwind color utilities (`bg-primary`, `text-muted-foreground`, semantic tokens, filled/subtle/outline/ghost utilities)
- `@custom-variant dark (&:is(.dark *))`, so `dark:` prefixes work
- `@source` pointing to its own `lib/`, so Tailwind scans glance-react's components automatically
- Dark/light mode switching via `html.dark` class

### 3. Add ThemeProvider (React)

```tsx
import { ThemeProvider } from 'next-themes';

<ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
  <App />
</ThemeProvider>
```

That's it. No `@theme inline` block needed in your app CSS.

### App-specific additions only

If your app needs tokens that aren't in the GDS, add a small `@theme inline` block for *only* those additions:

```css
@theme inline {
  --color-my-app-specific-thing: var(--some-gds-token);
}
```

Do **not** re-declare tokens that already exist in glance-react/styles.css.

---

## What NOT to do in consumer apps

| Don't | Do instead |
|---|---|
| Define your own `--primary`, `--foreground`, etc. | Import `@mattstack/glance-react/styles.css` |
| Add a `tailwind.config.js` with color definitions | Use the `@theme inline` bridge above |
| Write `.dark { ... }` overrides in the app | Fix the token in `packages/glance-react/lib/css/tokens.css` |
| Use raw hex or oklch values in CSS | Reference a `palette.css` var via `tokens.css` |
| Redefine shadcn components locally | Import from `@mattstack/glance-react` |
| Use `prose-neutral` or `prose-invert` with Tailwind Typography | Override `--tw-prose-*` vars using GDS tokens (`var(--foreground)` etc.) |

---

## GDS: this package's own token system

`GDS` is glance-react's internal name for its design-token system, not an
external product. It shows up in code as the `gds.*` CSS `@layer` names and
the `--gds-*` custom properties in `tokens.css`; a handful of bridge tokens
(such as `--graphite-purple`) also carry that internal naming. Treat both
names as local vocabulary scoped to this package.

## Dark Mode Token Architecture

The GDS is **dark-first**: `:root` defines dark mode values. Light mode is applied
via `html:not(.dark)`. This means:

- **Dark mode** = no class on `<html>` (or `.dark` added by next-themes)
- **Light mode** = next-themes removes `.dark`, GDS `html:not(.dark)` override activates

### The "foreground vs. fill" distinction

In the dark-mode token scale (`tokens.css`), the **`-default`** contrast tokens
(e.g., `--color-emphasis-default`) are designed as **background fill** colors.
They are too dark to use as foreground text on a dark background.

For foreground/text use in dark mode, always use:
- `--color-emphasis-higher-contrast` (blue-20, `#9dcaff`) for links, indicators
- `--text-color-emphasis` for emphasis text
- `--color-positive-higher-contrast` for positive/success text

The shadcn bridge tokens already route through the higher-contrast names in
both modes:
- `--primary` and `--sidebar-primary` both resolve to `--color-emphasis-higher-contrast`
- `--success` resolves to `--color-positive-higher-contrast`

What changes between modes is the *value* those higher-contrast tokens carry,
not which token the bridge points at: `--color-emphasis-higher-contrast` is
`blue-20` under the dark-mode `:root` block and `blue-60` under the
`html:not(.dark)` light-mode override in `tokens.css`.

---

## Reference

- Full token vocabulary and utility class patterns: [`ui-guidelines.md`](../ui-guidelines.md)
- Raw palette values: [`lib/css/palette.css`](../lib/css/palette.css)
- Semantic token assignments: [`lib/css/tokens.css`](../lib/css/tokens.css)
- Utility class definitions: [`lib/css/styles.css`](../lib/css/styles.css)
