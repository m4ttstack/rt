# Oat UI Migration Design

## Goal

Rebuild the local-apps board around Oat's semantic HTML conventions while retaining Alpine.js as the client-side state and interaction layer. Preserve every existing board capability and API interaction.

## Scope

The migration covers the board shell, styles, vendored UI assets, Alpine markup, and asset-serving tests. It does not change status discovery, server routes, API payloads, polling cadence, or management authorization.

## Architecture

The board remains a server-served static HTML shell plus a small Alpine component:

- `board.html` owns semantic structure and Oat component markup.
- `board.js` owns polling, derived state, user actions through Alpine, and
  Lucide's one-time icon replacement before Alpine starts.
- `board-assets.ts` serves exact-name vendored assets.
- Oat supplies base styling and its minimal JavaScript enhancements.
- A pinned, tree-shaken Lucide bundle supplies the board's SVG icons.

Oat and Alpine remain independent. The Oat bundle registers its web components, dialog compatibility behavior, tooltip enhancement, and global helpers. Lucide runs `createIcons({ inTemplates: true })` before Alpine loads so icons in Alpine templates are converted once and cloned as SVG elements. Alpine continues to register the `board` component on `alpine:init` and renders all dynamic text through `x-text`.

## Oat Integration

Vendor the current Oat `oat.min.css` and `oat.min.js` bundles in `src/vendor`. Replace both Halfmoon stylesheets with Oat's stylesheet and load Oat's script alongside the existing vendored Alpine script. Build a pinned Lucide 1.27.0 browser bundle from only the icons the board uses and serve it from the same exact-name asset allowlist.

Use Oat's documented components directly:

- Semantic headings and text instead of Bootstrap typography utilities.
- `role="alert"` and `data-variant` for proxy notices.
- `.table` as the responsive overflow container around native tables.
- `.badge` and `data-variant` for health and service states.
- Native checkbox inputs with `role="switch"` for publishing.
- Native `<dialog>` with a semantic form for password editing.
- Oat `.small`, `.outline`, `.ghost`, `.icon`, and `data-variant` button conventions.
- `aria-busy="true"` with `data-spinner="small"` for restart activity.
- Oat's native `title`-to-tooltip enhancement for short descriptions where
  its pseudo-elements cannot enlarge a scroll container.

Do not introduce Oat components that the board does not need.

## Lucide Integration

Use Lucide's Vanilla JavaScript package and documented `createIcons()` API.
Import only the icons used by the board, bundle them with Bun as a classic
browser script, and pin the package to version 1.27.0. Set common icon
attributes through `createIcons({ attrs: ... })`, and use
`inTemplates: true` because the board rows are authored inside native
`<template>` elements for Alpine.

Use `data-lucide` placeholders for external links, port overrides, reset
actions, passwords, service restarts, and stderr disclosure. Icons are
decorative by default. Icon-only buttons keep their accessible names on the
button with `aria-label`, following Lucide's accessibility guidance.

## Markup and Layout

The page uses a board-specific max-width main container because Oat's `.container` belongs to its 12-column grid system rather than acting as a generic page shell. Tables remain the primary information layout so the board retains its current compact operational overview.

The app table, stray-service table, and tunnel table keep their current columns and Alpine templates. Each native table is wrapped only in Oat's documented `.table` container. Oat owns the table width, row separators, padding, hover state, typography, and horizontal overflow. No board-specific table panel or forced table width remains.

Oat's `title` enhancement renders an absolutely positioned tooltip with
pseudo-elements. On an edge-aligned control, those hidden pseudo-elements
increase scroll width even when the tooltip is not visible. Rightmost restart
buttons and the right-aligned header action therefore use visible text or
`aria-label` without `title`. Other contextual tooltips remain where they do
not create an empty overflow tail.

The password overlay becomes a real modal dialog. Alpine creates it only when `pwModal` exists, calls `showModal()` after insertion, and clears state when the dialog closes or is canceled. Form submission remains bound to `savePassword()`.

Recent stderr uses Oat's documented `<ot-dropdown>` popover pattern instead
of a board-specific positioned hover card. This keeps the detail in the top
layer, keyboard reachable, and styled entirely by Oat.

## Custom Styling Boundary

Remove the Halfmoon/Radix token bridge completely and adopt Oat's default automatic light/dark theme. Keep only board-specific CSS for:

- Alpine's `x-cloak`;
- the board's maximum page width;
- no-wrap operational table cells;
- the inline port editor's constrained width.

Everything else uses Oat's semantic defaults and documented utilities,
including `.hstack`, `.vstack`, `.gap-*`, `.mt-*`, `.mb-*`, `.text-light`,
`.text-lighter`, `.align-right`, `.unstyled`, `.small`, `.outline`, `.ghost`,
and `.icon`.

## Behavior and Data Flow

All existing Alpine state and network behavior remains:

1. Poll `/api/status` every five seconds.
2. Reconcile service restart state.
3. Render apps, strays, and tunnels from derived getters.
4. Post existing form-encoded actions for restart, publish, port overrides, passwords, and proxy restart.
5. Preserve last-good data during transient fetch failures.
6. Preserve proxy stale/auto-heal notices and restart waiting behavior.

The only client logic removed is the Halfmoon-specific `data-bs-theme` synchronization. Oat uses `color-scheme` and `light-dark()` to follow the operating-system preference automatically.

## Accessibility

Retain semantic table headings and link labels. Add explicit accessible labels to icon-only restart, reset, and stderr controls. Use native switches, popovers, and a native modal dialog for keyboard and focus behavior. Keep status text visible rather than encoding state through color alone. Lucide icons remain hidden from assistive technology because their parent controls carry the accessible names.

## Error Handling

Network error behavior is unchanged. Proxy notices render as Oat alerts with success or error variants. Password save failures continue to create a persistent board notice. Busy controls remain disabled while work is in flight.

## Verification

Update asset tests to require Oat and reject Halfmoon references. Verify:

- both vendored Oat assets are allowlisted and plausibly sized;
- the pinned, tree-shaken Lucide bundle is allowlisted and initialized with
  `inTemplates: true` before Alpine;
- unknown and traversal asset names remain rejected;
- the HTML uses Oat's documented semantic component markers;
- the HTML uses Lucide placeholders instead of hand-authored SVG or Unicode
  action glyphs;
- Halfmoon/Bootstrap classes and theme attributes are absent;
- tables use only Oat's `.table` wrapper and have no forced width or
  board-specific panel;
- edge controls do not create tooltip-based document or table overflow;
- Alpine registration and the ban on dynamic `innerHTML` remain;
- the full Bun test suite passes;
- the running page loads without browser console errors and retains table, switch, port edit, restart, notice, and dialog behavior.
