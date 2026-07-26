# Oat UI Migration Design

## Goal

Rebuild the local-apps board around Oat's semantic HTML conventions while retaining Alpine.js as the client-side state and interaction layer. Preserve every existing board capability and API interaction.

## Scope

The migration covers the board shell, styles, vendored UI assets, Alpine markup, and asset-serving tests. It does not change status discovery, server routes, API payloads, polling cadence, or management authorization.

## Architecture

The board remains a server-served static HTML shell plus a small Alpine component:

- `board.html` owns semantic structure and Oat component markup.
- `board.js` owns polling, derived state, and user actions through Alpine.
- `board-assets.ts` serves exact-name vendored assets.
- Oat supplies base styling and its minimal JavaScript enhancements.

Oat and Alpine remain independent. The Oat bundle registers its web components, dialog compatibility behavior, tooltip enhancement, and global helpers. Alpine continues to register the `board` component on `alpine:init` and renders all dynamic text through `x-text`.

## Oat Integration

Vendor the current Oat `oat.min.css` and `oat.min.js` bundles in `src/vendor`. Replace both Halfmoon stylesheets with Oat's stylesheet and load Oat's script alongside the existing vendored Alpine script. Keep the server's exact-name asset allowlist.

Use Oat's documented components directly:

- Semantic headings and text instead of Bootstrap typography utilities.
- `role="alert"` and `data-variant` for proxy notices.
- `.table` as the responsive overflow container around native tables.
- `.badge` and `data-variant` for health and service states.
- Native checkbox inputs with `role="switch"` for publishing.
- Native `<dialog>` with a semantic form for password editing.
- Oat `.small`, `.outline`, `.ghost`, `.icon`, and `data-variant` button conventions.
- `aria-busy="true"` with `data-spinner="small"` for restart activity.
- Oat's native `title`-to-tooltip enhancement for short descriptions.

Do not introduce Oat components that the board does not need.

## Markup and Layout

The page uses a board-specific max-width main container because Oat's `.container` belongs to its 12-column grid system rather than acting as a generic page shell. Tables remain the primary information layout so the board retains its current compact operational overview.

The app table, stray-service table, and tunnel table keep their current columns and Alpine templates. Visual cards around tables are removed because Oat cards add content padding that conflicts with edge-to-edge data tables; a small board-specific table panel supplies only border, radius, background, and overflow clipping.

The password overlay becomes a real modal dialog. Alpine creates it only when `pwModal` exists, calls `showModal()` after insertion, and clears state when the dialog closes or is canceled. Form submission remains bound to `savePassword()`.

## Custom Styling Boundary

Remove the Halfmoon/Radix token bridge completely and adopt Oat's default automatic light/dark theme. Keep only board-specific CSS for:

- page width and responsive padding;
- compact header and section labels;
- table panel clipping;
- monospace port cells and inline port editor sizing;
- status dots;
- the multiline stderr hover/focus card;
- right-aligned action cells and no-wrap operational data;
- muted/disabled public-link presentation;
- alert command layout;
- visually hidden accessible labels where needed.

Custom styles use Oat variables such as `--space-*`, `--text-*`, `--border`, `--muted-foreground`, `--success`, `--warning`, and `--danger`.

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

Retain semantic table headings and link labels. Add explicit accessible labels to icon-only restart and reset controls. Use native switches and a native modal dialog for keyboard and focus behavior. Keep status text visible rather than encoding state through color alone. The stderr detail remains available on pointer hover and keyboard focus.

## Error Handling

Network error behavior is unchanged. Proxy notices render as Oat alerts with success or error variants. Password save failures continue to create a persistent board notice. Busy controls remain disabled while work is in flight.

## Verification

Update asset tests to require Oat and reject Halfmoon references. Verify:

- both vendored Oat assets are allowlisted and plausibly sized;
- unknown and traversal asset names remain rejected;
- the HTML uses Oat's documented semantic component markers;
- Halfmoon/Bootstrap classes and theme attributes are absent;
- Alpine registration and the ban on dynamic `innerHTML` remain;
- the full Bun test suite passes;
- the running page loads without browser console errors and retains table, switch, port edit, restart, notice, and dialog behavior.
