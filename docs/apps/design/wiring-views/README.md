# Wiring view redesign — reference

Approved design for the console `/wiring` redesign. **The `.dc.html` files are
the parity spec**: every color, padding, font-size and radius in them is a
literal, lifted from the real Tokyo theme. Implement against these values, do
not eyeball them, and do not round or snap anything to a 4/8px grid.

Published canvas (interactive): https://claude.ai/code/artifact/d753efeb-72fd-48ca-91e9-64798c66be32

## Artboards

| File | What it shows |
|---|---|
| `Main.dc.html` | **Pipeline tab** — the spine as slim one-line rows; structured summary strip; "Not run by this pipeline" collapsed by default. |
| `Detail.dc.html` | **Skill detail panel** (split view) — one place per skill with sub-tabs Slots & bindings / Compiled / History / Used-by. Rebind is INLINE (shown open on the `domain` slot). Replaces the 5 drawers. |
| `Surface.dc.html` | **Surface tab** — the roster promoted from a drawer: 2-col grid, filter bar, staged-changes footer with the `rt skills surface set` preview. |
| `Health.dc.html` | **Health tab** — `rt skills check` results grouped (recompile needed / never compiled / unwired) with stat cards. |

## Parity contract (do not deviate)

The `.dc.html` files hardcode `--tk-*` literals so the mockup is self-contained.
In the real components, use the theme tokens that resolve to those literals —
never re-hardcode the hex. The mapping (verified against `tokyo-theme.css` and
the theme on `main`):

| Design literal | Real token to use |
|---|---|
| `#e1e2e7` page bg / 28px grid | `bg.level1` / `#page-shell-content` grid (already global) |
| `#eff0f5` card | `bg.level2` |
| `#f6f6fa` well/nested | `bg.level3` |
| `#e6e6ec` hover/contrast | `bg.level4` |
| `#c8cad6` / `#d5d7e2` borders | `--tk-border` / `--tk-border-soft` |
| `#111` / `#8990b3` text | `text.gray` / `text.muted` |
| `#2e7de9` accent, `#587539` ok, `#f52a65` bad, `#8c6c3e` warn, `#7847bd` purple, `#007197` cyan | theme colors `accent` / `ok` / `bad` / `warn` / `purple` / `cyan` |
| status dots `#1f9d3a`/`#e08a00`/`#e5153f` | `--tk-dot-ok`/`--tk-dot-warn`/`--tk-dot-bad` |
| padding `18px` / `14px` / `12px`; radius `10px` card / `8px` inner / `6px` chip; row font `13.5px`, ref `11px`, label `10px` uppercase | Mantine `spacing`/`radius`/`fontSizes` steps that resolve to these — see `tokyo-theme.ts` |
| font | JetBrains Mono (theme `fontFamily`) |

**Verification method (required):** after building a surface, extract the
artboard's computed padding/radius/font-size/color and diff against the built
component's `getComputedStyle` — do not sign off by eye. This is how the runs
redesign caught four padding discrepancies at once.

## Regenerating the canvas

The 2.2 MB seeded `wiring-redesign.html` is a build artifact (gitignored).
Rebuild it from these sources with the `/design` skill's `seed-canvas.mjs`.
