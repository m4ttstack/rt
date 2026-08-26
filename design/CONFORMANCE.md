# Design conformance

**The artboards under `artboards/` are the contract, not a mood board.** Every
value in them was lifted from console's resolved theme, not eyeballed: palette,
grid and `@font-face` from `tokyo-theme.css`; sizes, spacing and radii from
`app-theme.ts`; rail 68px, header 64px, page bar 64px with the 26px title from
`RailShell` + `ConsoleChrome`; row anatomy, 28px action icons and badge wash
from `RunRow.tsx`.

So a mismatch is never a taste disagreement. It means the component stopped
deriving from the theme and started carrying its own numbers.

## The rule

**No UI task is done until its components appear in `audit.mjs`'s `TARGETS`
and that audit passes.** "It looks right" is not a report. Neither is a
screenshot on its own: a screenshot proves two things differ, never which
declaration is wrong.

```bash
python3 design/extract-spec.py     # only if build.py changed

# 1. get the page-side probe and run it through Fast Browser's browser_evaluate,
#    pointing its `filename` at an absolute path under /Users/matt/.fast-browser
node design/audit.mjs --probe

# 2. diff what it captured against the artboards
node design/audit.mjs /Users/matt/.fast-browser/chat-shots/computed.json
```

There is no browser driver installed here on purpose: the browser we have is
Fast Browser over the real Chrome, which is also the one that can reach
`https://chat.mattstack`. Hence the two steps.

A component with no `TARGETS` entry is an unaudited component. Adding the entry
is part of the task, not follow-up.

## What the audit cannot see, and you must

Numbers are the cheap half. Check these by eye against the artboard, at both
schemes and both widths (1440 and 390):

- **Optical alignment.** The spec puts `margin-top: 6px` on `.member .dot`
  precisely because mathematical centering looked wrong against a two-line row.
- **Overflow and truncation.** `.truncate` and `.path` (which is `direction:
  rtl` so a long worktree path truncates from the *left*, keeping the leaf
  visible) only reveal themselves on real data. Long handles, long away
  messages, deep paths.
- **Empty and degenerate states.** No rooms, no buddies, a room of one, a
  buddy with no branch, an away message that is longer than the row.
- **Both colour schemes.** `--wash` is 10% in light and 15% in dark, and the
  mention badge deliberately swaps to accent shade 7 in light so it passes
  contrast at 10px. A component that only reads well in dark is half done.

  The audit covers this now: the probe records the scheme it was captured in,
  and expected values resolve against `.app.dark` automatically. Capture once
  per scheme; the same TARGETS list serves both. `--scheme dark` forces it
  when you want to re-check a light capture.

## The values that get sloppy, and what they actually are

Read `spec.json` for the authoritative set. These are the ones that get
approximated:

| thing | value | the wrong-but-plausible version |
| --- | --- | --- |
| status dot | **8px** | 6px, the health dot from console |
| action icon | **28px** square, 6px radius | 24px or 32px |
| phone control | **44px** | 40px, below the hit-target floor |
| message row | `gap: 9.6px`, `padding: 8.4px 0` | 8px / 10px rounded |
| member row | `gap: 7.2px`, `padding: 7.2px 0` | 8px |
| room row | `height: 34px`, `padding: 0 9.6px` | 32px / 36px |
| message body | `font-size: 12.16px` | 12px |
| small text | `11.2px`, extra-small `10.56px` | 11px / 10px |
| badge / mention / unread | `height: 18px`, `radius: 10px` | 20px, or a pill radius |
| tag | `height: 14px`, `radius: 7px`, `8.5px` type | 16px |
| chip | `height: 22px`, `radius: 6px` | 24px |
| separators | `1px solid var(--border-soft)` between rows | `--border`, the heavier one |

**The odd numbers are the point.** 7.2px is `0.45rem`, 9.6px is `0.6rem`,
11.2px is `0.7rem`, 12.16px is `0.76rem`, 4.8px is `0.3rem`. They are Mantine
rem values resolved at a 16px root. If you find yourself typing `8px` because
7.2px looks like a mistake, you are about to break the theme relationship the
whole design rests on.

**Prefer the theme token to the literal.** `gap="xs"` that resolves to 7.2px is
right; a hardcoded `gap={7.2}` that happens to match today is a value that will
not follow the theme when it moves. The audit compares computed output, so both
pass it now, and only one of them survives the next token change.

## The theme this rests on

The artboards were generated from **console's resolved tokyo theme**, which
this app now consumes as `@mattstack/mantine-tokyo` through the kit's brand
slots (`src/ui/design-system/app-theme.ts` and `app-colors.ts`), with its css
imported from `src/app/styles/tokyo-theme.css`.

That is what makes everything below achievable. A component that derives from
the theme matches the artboard *by construction*. Before this package was
wired, matching the design meant transcribing numbers by hand, which is
precisely the failure the audit exists to catch — so if you ever find the
tokens missing, fix the theme rather than hardcoding your way to a passing
audit.

The package is consumed from npm as `@mattstack/mantine-tokyo@^0.1.0`. It
started as a sibling `file:` path while unpublished; that worked on one
machine and could never work in CI, since console is private.

## Colours

Never a hex literal in a component. Every colour in the spec is a token
(`var(--muted)`, `var(--border-soft)`, `var(--dot-ok)`) or a `color-mix` off
one. The app reaches them through the theme — the tokyo virtual colours
(`var(--mantine-color-bad-text)`) and `var(--tk-*)` — never through the raw
hexes listed here.

**The audit checks colour.** It resolves the artboard's own `var()`s from the
palette `spec.json` carries, unfolds a `color-mix(... N%, transparent)` to an
alpha, and compares channel by channel. So `background` and `color` are real
assertions, not "verified by eye". That check was added after the daemon
banner shipped with Mantine's generic `red` — `rgb(255,206,217)` over
`rgb(172,0,51)` where the design wanted `#f52a65` at 10% — which passed a
by-eye review because both are, broadly, red. Do not exempt a colour in
`why:` without a reason that survives being read back.

Status colour pairs, which are easy to swap:

| status | dot | text |
| --- | --- | --- |
| live / listening | `--dot-ok` | `--ok` |
| idle | `--dot-warn` | `--warn` |
| deaf | `--dot-bad` | `--bad` |
| offline | transparent, `1px solid var(--border)` | `--muted` |

The dot ramp and the text ramp are **different colours on purpose** — the dots
are saturated for signal at 8px, the text is the readable ramp. Using one for
both is the most common way this gets flattened.

## Two things drawn that are deliberately not built

Both are marked in the plan. Do not implement them because the artboard shows
them:

- the `not joined` badge on a room (needs an all-rooms source the store does
  not have)
- focusing a herdr pane from a member row (no route addresses a pane by id)
