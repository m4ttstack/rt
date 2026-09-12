# MR row density study, direction B approved 2026-09-12

A polish pass on the board's MR row after the 2026-09-12 four-line row
went live (`docs/design/mr-row/README.md`, "Rulings after live use"). Not a
redesign: the same four lines and the anchored corner, tuned for the two
things that were still wrong in daily use, too much metadata reading as
busy, and state colors that did not distinguish states.

Approved by Matt on 2026-09-12 ("B's design is approved"). The `.pen` file
and the renders here are the reference for implementation.

## What lives here

| file | what it is |
| --- | --- |
| `board.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/*.{dark,light}.png` | 2x exports of every board, both themes, refreshed after each change |

Boards on the canvas, left column dark, the column at x=1520 light:

- `00 · Overview`: the same hot row drawn five ways (today, A, B, C, D)
- `01 · State pill system`: one hue per review state, four pill styles
- `A · Flags are facts`, `C · Two lines`, `D · No boxes, aligned rail`:
  the rejected directions, kept for the record
- `B · The header line earns its keep`: the approved direction, rest and
  hover side by side

The column at x=3040 (light at x=4560) proofs B against every state the
row can show, on shapes taken from the live board (titles to 97
characters, branches to 68, up to 27,407 commits behind, approvals
required up to 12), with invented names throughout:

- `B0 · Threads token and the comments drawer`
- `B1 · Agent lanes`: review, respond, doctor, orphans
- `B2 · Decisions and social`: gates in every delivery outcome, nudges,
  held notes, peers, humans
- `B3 · Standing states`: the author's ten lines beside the reviewer's nine
- `B4 · Mechanical and stress`: long title and branch, huge diff and behind
  counts, partial approvals, auto-merge, draft, four flags at once, a
  three-deep stack, the author-grouped view

## The rulings

Everything below is drawn in B and its scenario boards; the laws in
`docs/design/mr-row/README.md` still hold underneath.

- **The header line always has a job.** The author tag moves up from the
  facts line to the header's left edge, muted (not purple), with an
  avatar. The mechanical flags sit beside it as colored words with a 12px
  icon, never as chips: `conflicts` (orange, git-merge), `ci failing`
  (red, circle-x), `ci running` (amber, loader), `stacked` (cyan, layers),
  `draft` (dim, pencil), `auto-merge` (green, zap). The Slack marks and the
  pill hold the corner as before.
- **Conflicts and ci failing never share a color.** Conflicts is orange
  (Tokyo Night `#ff9e64` / `#b15c00`), ci failing is red.
- **Behind count moves to the header line**, after the flags, as a muted
  `↓ N behind` (arrow icon plus word). The facts line is then identity
  only: `!iid`, branch, `+adds −dels`, so the green/red diff is the only
  colored number on it.
- **One hue per pill state, soft fill.** Four states: needs review amber,
  N/M approved cyan, approved green, changes requested red. Soft-fill
  style (tinted background, colored uppercase text, no border), 10px/700,
  4px radius. `commented` and `comments resolved` are conversation
  states, carried by the threads token, not the pill; draft is a flag.
- **The pill owns the approval axis only.** It stops saying "commented";
  the conversation lives in the threads token.
- **The threads token is the drawer's entry and reads at full weight.**
  A 12px message icon plus `N threads` in foreground color, 500 weight.
  New activity since the drawer was last opened: accent, 700, plus a 6px
  accent dot. A qualifier follows the count as its own colored span, no
  glyph between them (the no-separator law): threads awaiting the seat
  on their own MR read `N await you` in amber, 600; the author having
  replied to the seat's thread on someone else's MR reads `author
  replied` in accent, 600. Hover underlines the count.
- **All clear is the words and the sun.** `all clear ☀`, no tagline.
- **Hover replaces the dot with main's bespoke square checkbox**: 13px,
  1.5px muted stroke at 55% opacity, near-square corners, centered on the
  dot's point. The row tints, and the ticket and copy tools plus the
  secondary verbs appear left of the primary verb, which never moves.
- **Stacked children indent 20px** (`--stack-indent`); the rail is 2px in
  the cyan tint, drops from the parent's dot, and its arm ends at the
  child dot's edge.
- **Clipping order.** The header clips from the right (flags before marks
  and pill), the title from the right, the branch at 34ch before the diff,
  so the pill, the diff and the age never move.
- **Author-grouped view.** With the author tag gone, the ticket id takes
  its slot on the header line (muted, with an arrow). With no ticket
  either, the header holds only the flags.

## Implementation touch points

`apps/board/src/client/board/RowView.tsx` (line 0 and line 2 contents),
`StatusLine.tsx` (all-clear detail), `row-status.ts` (`statusPhrase` hues
and the commented state), `CommentsDrawer.tsx` (`ThreadsLink` states),
`chips.tsx` / flag rendering, and the row block of `apps/board/src/style.css`
(pill soft fill, flag words, header line, threads token, checkbox). The
fixture at `apps/board/tests/fixture` plus `bun run capture:compare` are the
visual parity gate, compared against `renders/B-*.png` and the `B0`-`B4`
renders.

Implemented on branch `mr-row-b`.
