---
name: adopting-mantine-kit
description: Use when adding mantine-kit to an existing app, scaffolding a new app from it, vendoring its src/ui, or bringing a consumer app forward to a newer kit commit.
---

# Adopting mantine-kit

The kit is at `~/Documents/GitHub/mantine-kit`: a Mantine 9 / React 19 / Vite /
Bun UI template. It is private and pre-publish, so consumers adopt it by
scaffold or by vendoring `src/ui`, never via npm.

`AGENTS.md` in the kit is the authoritative mechanical guide (`§N` below refers
to it) and it is good. Read §9 to scaffold, §1/§7/§11 to vendor. **This skill
is the policy AGENTS.md does not carry: what you may decide alone, and what you
must bring back to the owner.**

To build UI once the kit is installed, use `building-with-mantine-kit` instead.

## Choose the path

| Situation                         | Path                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| New standalone app                | `bun create-cli/create.ts <dir>` (§9)                         |
| New member of a bun workspace     | same, `--workspace`, then `bun install` at the workspace ROOT |
| App that already has React set up | vendor `src/ui` (§1, §7, §11)                                 |

Reference consumers to copy from: any previously-adopted app under
`~/Documents/GitHub/<consumer-app>` -- look for the vendored `src/ui` under
`apps/ui` in a monorepo layout, or a top-level `ui/` directory in a simpler
layout, whichever matches the app you're adopting into.

## Rules that are not negotiable

**Versions are floors, not preferences.** React 19, Mantine 9, and the kit's
TypeScript and Vite majors. An app pinned lower gets raised first. Never vendor
onto an older toolchain and hope.

**Verify with the app's own installed toolchain.** Borrowing or symlinking the
kit's `node_modules` proves nothing about the app and produces a green result
for versions the app does not have. If you cannot install, say the work is
unverified rather than reporting a pass.

**Prettier ships with the kit** (§11). `.prettierrc` plus the sort-imports
plugin is the import-order authority the whole surface assumes, not optional
polish to skip when an app has no formatter.

**Never push a consumer repo.** Commit, then stop.

**Anchor every commit to a kit SHA** (`... (kit <sha>)`). That SHA is what the
next sync diffs from; without it the next agent has to guess the base.

**Friction goes in `FEEDBACK-<app>.md`** at the kit root, untracked, never
committed. If something stops you writing there (working in a sandbox, told
not to touch the kit), put the same friction in your final report instead.
Losing it is the failure; the file is just the usual home.

## Dropping parts of the copy

You may strip `**/*.stories.tsx` and `src/ui/storybook/` to avoid the Storybook
and testing-library dev set. If you do, you MUST also drop the storybook block
from `eslint.config.js`, and report what stopped being enforced. Dropping the
tests removes `loading-bar-sync.test.ts`, which is the only thing keeping
`index.html`'s `BEGIN/END SYNCED RULES` block byte-identical to
`src/boot/simple-loading-bar.css`.

## Syncing a consumer forward

Mechanically this is a diff against the last synced SHA, and you will derive it
fine. The parts you cannot derive:

1. **Untouchables are per-consumer and permanent.** A file the consumer has
   customized is never overwritten, only merged surgically. By design that
   list is now short: `design-system/app-theme.ts`,
   `design-system/app-colors.ts`, `styles/index.css`, and any re-skinned
   component. Ask the owner for the list; do not infer it.

   Two file pairs exist precisely to keep themselves off it, and a consumer
   still carrying deltas in the kit-owned half should be moved:

   - **Brand in `theme.ts` or `base-theme.ts`** predates `app-theme.ts`. Move
     the brand there and both kit files fast-forward again forever. This also
     restores `baseTheme` for the consumer, which is what `ThemeIsland` needs
     to render a dev route in the kit's own look.
   - **Brand color names in `mantine.d.ts` or `colors.ts`** predate
     `app-colors.ts`. Move the names there.
   - **A remapped `--ui-bg-*` ramp in `scheme-vars.css`** should override the
     live `--ui-*` slots and leave the kit-owned `--ui-base-*` layer alone, so
     the file still fast-forwards and `.ui-base-surfaces` still works. Watch
     for `--mantine-color-body: var(--ui-bg-1)` paired with an older kit's
     `--ui-bg-1: var(--mantine-color-body)`: that is a CSS cycle, and both
     properties silently fall back to their initial values.
2. **Prove drift per file before copying:**
   `git show <base-sha>:src/ui/<f> | cmp -s - <consumer>/src/ui/<f>`.
   Byte-identical is FF-OK and gets a verbatim `cp`. Anything else is
   LOCAL-DELTA and gets a hand-merge.
3. **A local absence is not a decision.** If a consumer's customized file lacks
   something the kit has, that is usually drift, not intent.
4. **Appearance changes are the owner's call, and they arrive two ways.**
   Through a LOCAL-DELTA merge (a new theme default like `Group`'s wrap or
   `Badge`'s text transform): hold it and ask before adopting, even when
   adopting is defensible. Through an FF-OK copy (`scheme-vars.css` ramp
   values, `index.css` adding an overrides import): still copy it, since the
   file has no local drift, but call it out by name in your report rather
   than letting it ride in a file count. Never let "it was byte-identical"
   stand in for "nothing will look different."
5. Run the consumer's full gates, commit once citing the kit SHA. If you
   cannot install and therefore cannot run them, report the work as
   unverified. Never describe unrun gates as passing.

## Red flags

- "The app is on an older TypeScript, I will work around it"
- "Typecheck passed" when you installed nothing
- "Prettier is not part of the UI system"
- "This theme block was missing, so they must have removed it deliberately"
- "This new default only changes appearance slightly"

All of these mean: stop and ask the owner.
