# Radix App Migration: Group D (board)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For board only, move its stylesheets off the transitional aliases (`--fg`, `--muted-text`, `--accent`, `--tk-muted-text`, `--gate-*`, ...) onto the ramp names the tokens package now emits, chosen per role and per size band, so that the namespace lint runs at `error` everywhere and no text reads a fill token.

**Architecture:** Part A of the ramps plan (branch `radix-palette`, Tasks 0 to 3) emits every new name and keeps every old name as an alias with the new value, so the apps already render the Radix palette; this plan is the rename that lets the aliases retire. One codemod in `packages/tokens/scripts/migrate-tokens.ts` does the property-aware renames and lists the declarations whose size band it cannot infer; each group then resolves that list by hand, flips its lint tier, and screenshots its key screens in both schemes. This file is Group D only. The other five groups run in their own worktrees from their own plan files; never touch their paths.

**Tech Stack:** bun, TypeScript, `css-tree` (codemod parser, tokens devDependency), the `local/token-namespaces` and `local/token-namespaces-css` ESLint rules from the ramps plan (Tasks 10 and 11) where they have landed, Fast Browser for screenshots.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md` (§4 semantic surfaces, §5 text roles, §6 size bands, §7 hue tokens, §7.2 lines and the card-scope rule, §8.1 namespaces, §9 aliases and migration).

## Base and branching

This group branches from `radix-palette` at or after the commit that lands Task 3 of the ramps plan (the tokyo emission). Check before provisioning: `git show origin/radix-palette:packages/tokyo/src/tokyo-theme.css | grep -c -- '--tk-text-4:'` must print `2`. Provision with `rt worktree provision --repo 'remote:github.com%2Fm4ttstack%2Fapp-kit' --name radix-migrate-<group> --branch radix-migrate-<group>` and rebase the branch onto `origin/radix-palette` before starting. Open the PR against `radix-palette`; when `radix-palette` merges to main, retarget the PR to main (the stacked-PR routine).

Group A (app-kit and the codemod) is the only ordering constraint: Groups B to F run the codemod it adds, so they start after Group A's first task is committed on its branch and cherry-pick that one commit, or wait for Group A to merge into `radix-palette`.

## Global Constraints

- Every colour is a Radix step from `packages/tokens`; no task types a hex. A rename is always onto a `--text-*`, `--fill-*`, `--surface-*` role, `--line-*` role, `--page`, `--raised`, `--border*` or `--tk-*` mirror name.
- Size bands (spec §6): `display` 17px, `title` 15.3, `body` 14.45 take `--text-2` (neutral) or `--text-<hue>`; `meta` 13.26 takes `--text-3`; `small` 11.9 and `micro` 10.54 take `--text-4` or `--text-<hue>-small`. A declaration whose rendered size is unknown takes `--text-3` (neutral) or `--text-<hue>-small` (hue) and is listed in the group's report. In app-kit apps the tokyo mirrors apply: `--tk-text-2/3/4`, `--tk-text-<hue>`, `--tk-text-<hue>-small`.
- Property classes (spec §8.1): `color` takes text tokens only; `background*` and `fill` take `--fill-*`, surface roles or washes; `border*`, `outline*`, `scrollbar-color` take `--border*` or `--line-*` roles; `--fill-*` never appears in `color`.
- The old names stay emitted as aliases until every group has merged; no group removes an alias.
- The repo is public; every screenshot, fixture and story string is invented data.
- No em dashes or en dashes anywhere; comments state constraints the code cannot show.
- Run `bun run format` before every commit. Commit after every task with the message given.
- A group's PR is green on CI, CodeRabbit-reviewed, and its two screenshots (light, dark) of the group's key screen are attached to the PR description before it asks for merge.

## Mapping table (the codemod's data; every group reads it)

| old (tui-kit alias) | property class | new |
| --- | --- | --- |
| `--fg` | color | `--text-1` |
| `--muted-text`, `--text-muted-on-card` | color | by band: `--text-2` / `--text-3` / `--text-4` |
| `--muted` | color | by band, same as `--muted-text` (this was the bug) |
| `--muted` | background, border, fill | unchanged (`--muted` is the neutral fill, slate 9) |
| `--accent-text`, `--red-text` | color | `--text-accent`, `--text-bad`; small band adds `-small` |
| `--accent`, `--green`, `--red`, `--amber`, `--purple`, `--cyan` | color | `--text-<hue>`, small band adds `-small` (`green`→`ok`, `red`→`bad`, `amber`→`warn`) |
| same six | background, fill, border | `--fill-<hue>`; a `:hover` rule's background takes `--fill-<hue>-hover` |
| `--dot-ok`, `--dot-warn`, `--dot-bad` | any | `--fill-ok`, `--fill-warn`, `--fill-bad` |
| `--bg` | background | `--page` |
| `--surface-inset`, `--surface-overlay` | background | unchanged; `--inset` and `--overlay` are NOT emitted (the spec section 4 block showing them is labelled illustrative). Renaming to them paints the element transparent. |
| `--border-on-card`, `--border-soft-on-card`, `--border-control-on-card` | border | keep the alias in card scopes (see the board's Task D2); elsewhere `--border`, `--border-soft`, `--border-control` |
| `--tk-fg`, `--tk-muted-text`, `--tk-muted-on-card` | color | `--tk-text-1`; by band `--tk-text-2/3/4` |
| `--tk-muted` | color | by band `--tk-text-2/3/4`; other properties unchanged |
| `--tk-accent-text`, `--tk-red-text`, `--tk-green-text`, `--tk-amber-text` | color | `--tk-text-accent/bad/ok/warn` (+`-small` in the small band) |
| `--tk-accent`, `--tk-green`, `--tk-red`, `--tk-amber`, `--tk-purple`, `--tk-cyan` | color | `--tk-text-<hue>` (+`-small`) |
| same six | background, fill, border | `--tk-fill-<hue>` (hover: `--tk-fill-<hue>-hover`) |
| `--tk-dot-*` | any | `--tk-fill-*` |
| `--tk-bg` | background | `--tk-page` is not emitted; `--tk-bg` stays (it is the page) |
| `--ui-text-muted` | color | unchanged (it becomes `--ui-text-3`, Task A2) |
| `--ui-text-dimmed` | color | `--ui-text-4` (Task A2 re-points the alias too) |

Band inference: the codemod reads `font-size` from the same rule; if absent, from another rule in the same file whose selector is a prefix of this one (`.tui-review-mr-meta` inherits from `.tui-review-mr`); if still absent, unresolved. Sizes map to bands by nearest step in px at the file's root (17px for the board, 16px for app-kit apps and tui-kit): `>= 14` body, `12.5 to 14` meta, `< 12.5` small. `rem`/`em` values convert at the root; `var(--type-<step>)` and `var(--tk-fs-<n>)` map by name (`--tk-fs-lead` body, `--tk-fs-2xs` and `--tk-fs-small` and smaller are small).

## File structure

- Group A (app-kit + codemod): create `packages/tokens/scripts/migrate-tokens.ts` and `packages/tokens/test/migrate-tokens.test.ts`; modify `packages/tokyo/src/tokyo-theme.css` (`--ui-text-1..4`, `--ui-text-dimmed`), `packages/ui/presets/eslint-local/no-dimmed-xs.js` (+ `.d.ts`, test), `packages/ui/presets/eslint.js`, `AGENTS.md`; run the codemod over `packages/ui/src`.
- Group B (chat): `apps/chat/src/**/*.{css,tsx}` via the codemod, the unresolved list by hand.
- Group C (console + boxscore): the same, plus `no-dimmed-xs` fixes.
- Group D (board): `apps/board/src/style.css` and `src/client/**/*.tsx` via the codemod; the `--gate-*` block; `eslint.config.js` board tier to `error`.
- Group E (tui-kit recipes): `packages/tui-kit/src/recipes/**/*.module.css` via the codemod; the three known warnings; `eslint.config.js` tui-kit tier to `error`; `packages/tui-kit/docs/token-census.md` note.
- Group F (deck): `apps/deck/core/board/board.css`, `apps/deck/core/gateway-pages.tsx`; regenerate `apps/deck/core/generated/*` after Group D merges.

---

---

## Group D: board

### Task D1: Codemod the board

**Files:**
- Modify: `apps/board/src/style.css` (census: 66 `--fg`, 79 `--muted-text`, 25 `--accent-text`, 47 `--accent`, 39 `--border`, 26 `--card`, and the rest of the table), `apps/board/src/client/**/*.tsx` (style objects), `apps/board/src/client/board/icons.tsx` (fills)

- [ ] **Step 1: Dry run**

Run: `bun run tokens:migrate apps/board/src/style.css apps/board/src/client/**/*.tsx --root=17 | tee .superpowers/migrate-board.txt`. The board's root is 17px (`html { font-size: 17px }`), so the `--root=17` flag matters: `--type-meta` (0.78rem, 13.26px) lands in the meta band, `--type-small` (0.7rem, 11.9px) in small.

- [ ] **Step 2: Write and resolve**

Write, then resolve the `UNRESOLVED` list by hand. The review sheet rules (`.tui-review-*`) declare `font-size` per rule, so most resolve; the MR row rules inherit from `.tui-mr-row` and resolve by prefix. Board CSS lines 3631, 3683, 3994 and 4046 use `--muted` as `color:` (the bug the spec opened with); they take the band token like any other.

### Task D2: Retire the `--gate-*` block

- [ ] In `apps/board/src/style.css` lines 1870 to 1902, the `--gate-*` re-alias block on the review sheet's root: delete the six colour aliases (`--gate-edge`, `--gate-control-edge`, `--gate-muted`, `--gate-key-bg`, `--gate-soft-edge`, `--gate-modal-ground`) and replace them with the card-scope rule from the spec:

```css
.tui-review-sheet {
  --border: var(--border-on-card);
  --border-soft: var(--border-soft-on-card);
  --border-control: var(--border-control-on-card);
}
```

  then rename every `var(--gate-edge)` to `var(--border)`, `var(--gate-control-edge)` to `var(--border-control)`, `var(--gate-soft-edge)` to `var(--border-soft)`, `var(--gate-muted)` to the band token of its rule (`--text-3` on meta rules, `--text-4` on small ones), `var(--gate-key-bg)` to `var(--inset)`, `var(--gate-modal-ground)` to `var(--overlay)`. The font, gap, pad and radius `--gate-*` aliases stay; they are not colours.

### Task D3: Verify, lint tier, screenshots, PR

- [ ] Run: `bun run tui-kit:build && bun run board:typecheck && bun run board:test && bun run board:build`. If the ramps plan's Task 11 has landed on `radix-palette`, change the board's CSS block in `eslint.config.js` from `'warn'` to `'error'` and run `bun run lint`; expected zero board warnings (the two known lines at 3644 and 3667 are `--border` in a non-border property and get a role that fits: a divider painted as `background` becomes `var(--line-3)` only inside the tokens file, so here it becomes `border-top: 1px solid var(--border-soft)` on the element instead). If Task 11 has not landed, leave the tier and say so in the PR.
- [ ] Serve the board (deck serves `apps/board`; rebuild first) and screenshot the MR list and an open review sheet in both schemes; attach.
- [ ] Commit `board: ramp names by size band; gate block replaced by the card-scope rule` and open `radix-migrate-board` against `radix-palette`.

---

## After all groups merge

- The aliases (`--fg`, `--muted-text`, `--accent-text`, `--red-text`, `--dot-*`, `--bg`, `--text-muted-on-card`, the `*OnCard` line names, `--tk-muted-text`, `--tk-*-text`, `--tk-dot-*`) can retire from `soribashi.config.ts`, `generate.ts` and `tokyo-theme.css` in one commit, with `token-existence.test.ts` and the consumption gate as the proof nothing reads them. That commit is its own PR on `radix-palette`, after every group is in.
- The lint tiers are all `error`; delete the `warn` block from `eslint.config.js`.

## Self-review

Spec coverage: §4 roles (`--page`, `--inset`, `--overlay`, card-scope rule) in D2 and the table; §5 and §6 bands in the codemod and every group's resolve step; §7 hue tokens and fills in the table; §7.2 lines and the card scope in D2 and E; §8.1 namespaces enforced by the lint flips in D3 and E; §9 alias retirement after all groups. Not covered on purpose: the 22 type primitives and the `--type-*`/`--text-*` pairing lint, both out of scope in the spec.

Placeholder scan: none. Type consistency: `planRenames`, `rewriteCss`, `renameInTsx` are the codemod's exports and the only interfaces Groups B to F use.
