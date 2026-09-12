# MR row redesign, approved 2026-09-12

The board's MR row rebuilt from first principles after the chips-on-chips
design stopped scaling. Approved by Matt on 2026-09-12; the artboards and
the baseline screenshots here are the reference for implementation.

## What lives here

| file | what it is |
| --- | --- |
| `build.mjs` | the design source: one shared CSS block plus every artboard's markup. Edit this, re-run `node build.mjs`, re-seed. Never edit the `.dc.html` outputs by hand. |
| `*.dc.html` | generated artboards: `Main` (the design), `RestHover`, `Density`, `DirectionB` and `DirectionC` (the rejected directions, kept for the record), `StatesLanes`, `StatesAttention`, `StatesAmbient`, `StatesStress` |
| `canvas.json` | layout and the two pages (Directions, All states) |
| `baseline/*.{light,dark}.png` | the approved renders, one pair per artboard, captured at device scale from the served artboards |

The hosted canvas (a Claude Design artifact) is a convenience, not the
record; re-seed one from these files whenever it is wanted.

## The laws

Validated against Matt's daily use before the design was drawn.

1. **Temperature.** Hot = his move is the bottleneck. Warm = live and
   moving without him. Settled = done or history. Rest shows hot and warm
   and live workflow marks; settled is summoned (hover, menu).
2. **Zoom.** Glance (edge bars) -> rest -> hover (all verbs, context card)
   -> menu / decision queue. The queue is the gate seat; the row only
   points at it. Nothing skips a level.
3. **One predicate.** Identity line, facts line, a single status line. The
   hottest fact wins the line; "+N active" points at the rest. Rows are a
   fixed height, always.
4. **Color is a verb.** Amber decide, red repair, purple wait, green read.
   Workflow marks stay mono; the Slack logo is the one brand-colored mark.
   One hue per row edge.
5. **Position is meaning.** Urgency at the edge, identity line 1, evidence
   line 2, status below. A hot line's primary verb sits on it at rest;
   secondary verbs wait for hover.

## The anatomy, as approved

- Row: 92px fixed (78px in the compact variant), 12/16 padding, 40px
  gutter holding only the status dot; the 3px attention bar is flush to
  the row's left edge and spans its full height.
- Line 1: title (500 weight), then the Slack ladder marks, then the state
  pill. The brand-colored Slack logo appears once the MR is posted; the
  furthest reaction stage joins it as a mono fill icon (looking 👀,
  commented, approved).
- Line 2, left flow: `!iid` (brighter, 500) then branch (muted) then
  `+adds −dels` (desaturated green/red). Right rail: thread count as an
  accent link (bold full accent when new activity waits, faint blue
  otherwise; opens the comments drawer) then the age (smaller, dimmer) as
  the corner anchor.
- Line 3: the status word in its temperature color, detail in muted, the
  next verb at the right end (accent when hot, muted when warm). No lane
  prefix except where the bare word is ambiguous ("review running…"). The
  spinner is a 9px arc ring, never a dot. Quiet rows read "all clear"
  plus a filled sun and "enjoy the sunshine", with "open ↗" at the corner.
- No separator glyphs anywhere: every junction steps in size, weight, or
  color instead.
- Icons: 14px, fill style throughout; never emoji on the row (the context
  card keeps reaction emoji).

## Visual parity gate for implementation

Implementation is not done until the real board renders match these
baselines. The gate, run with Fast Browser against the served board (not
the artboards):

1. Seed the board with the same fixture rows the `Main` artboard shows
   (a hot interrupted review, a running review, a decide gate, an own MR
   with a live peer and new threads, a quiet approved MR).
2. Screenshot the row list at device scale in light and dark
   (`browser_take_screenshot` with `scale: "device"`; set
   `document.documentElement.style.colorScheme` to flip themes).
3. Compare against `baseline/main.{light,dark}.png` side by side: row
   height, the three lines' x positions, the right rail's anchors, the
   icon family, the status-line colors. Look at the pixels; do not sign
   off from the DOM.
4. Repeat for the state inventory (`states-*.png`) as each lane lands.

Differences in font rendering across the artboard's system stack and the
app's real stack are expected; differences in layout, spacing, color or
weight are defects.

## Implemented

`apps/board/src/client/board/row-status.ts` derives the status line,
`slack-ladder.ts` the marks, `threads-seen.ts` the thread newness,
`StatusLine.tsx` renders the line, `RowView.tsx` the row. The fixture board
(`apps/board/tests/fixture`) carries every state drawn here, and
`bun run capture:compare` holds the recorded baselines.
