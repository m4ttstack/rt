# Component anatomy

`spec.json` carries the CSS declarations. This carries the **structure**:
widths, order, nesting, aria labels and copy, lifted from `build.py`'s
generators. Between the two there should be nothing left to guess.

Read `CONFORMANCE.md` first for the rule and the values that get rounded.

---

## Rail (68px) — Task 1, already built

`RailShell`'s own width. `bg2`, `border-right: 1px solid var(--border)`,
`padding: 11.2px 0`, centred column. A 28px `.aicon` toggle, a `14.4px`
spacer, then the entries at `gap: 4.8px`, `flex: 1` spacer, and the
colour-scheme toggle pinned at the bottom. Icons are 16px inside the 28px
button.

## Rooms rail — Task 5

**`PageShell.Sidebar`, 244px border-box (231px of rows inside 6px of padding
and the 1px hairline), on `bg2` with a `border-right`; a drawer on phones.** `gap: 2px`.

Header row: `justify-content: space-between; padding: 0 9.6px 6px`, label
`ROOMS` in `.xs.muted` at `font-weight: 600; letter-spacing: 0.04em`, count on
the right in `.xs.muted`.

Each room is a `.room` (34px tall, `padding: 0 9.6px`, radius 6px, `gap:
7.2px`):

| part | detail |
| --- | --- |
| hash | 14px icon in `.hash` (muted; accent when the row is `.on`) |
| name | `.truncate`, `flex: 1`, `font-weight: 600` on the active row |
| mentions | `.mention` — `@N`, filled accent, `aria-label="N mention"` |
| unread | `.unread` — `N`, outlined, `aria-label="N unread"` |

The active room carries `.on` (accent wash background, accent text).

**Both badges can appear on one row**, mention first. They differ by *glyph*
(`@4` vs `4`), not only by colour — that is deliberate and a test pins it.

Then the direct section: `.sect` with `padding: 10px 9.6px 4px` and the label
`DIRECT`. DM rows are `.room`s whose name is a `.pair`:

```
<span class="pair"><span class="truncate sm">deck-main</span>
  <span class="arrows">↔</span>
  <span class="truncate sm">rt-chat-wt</span></span>
```

`.arrows` is `--purple`. The human's own handle in a pair renders at
`font-weight: 600`. **The hashed room name is never rendered.**

Footnote under the section, `.xs.muted`, `padding: 4px 9.6px 0`:
`Every agent↔agent DM is yours to read and post into.`

## Page bar — Task 5

Console's second 64px bar. Title at **20px / 700** (`#build`, or the
`a ↔ b` pair plus a `dm` tag for a DM).

Then the fleet chips, all `.chip` (22px tall, radius 6px, `gap: 4.8px`,
`padding: 0 8px`, 10.56px / 500):

- `N in room` — plain chip, no dot (the bar counts this room's members; the
  roster counts the fleet)
- `N listening` — `.chip.live` with a `.dot.live`
- `N idle` — `.chip.idle` with a `.dot.idle`
- `N deaf` — `.chip.deaf` with a `.dot.deaf` (this one also gets a `bad` 7% wash)
- `wakes: <mode>` — plain chip

A chip whose count is **≤2 names its handles**: `1 deaf: gitq-main`. That is
what makes the stuck agent read first instead of found last. `offline` never
gets a chip.

Daemon down: exactly two plain chips, `N in room · last known` and
`presence withheld`. No dots, no status variants.

## Transcript — Task 5

The main panel on `bg3`, `padding: 11.2px 14.4px`, inside the scroll-clamped
`PageShell.Content`; the list scrolls in a sticky-bottom scroller
(react-scroll-to-bottom) with the composer pinned beneath it. Top edge row `.edge` (`.xs.muted`): `41 older messages · load on
scroll`, becoming `Loading older…` while a `before` page is in flight.

Each message is a `.msg` (`display: flex; gap: 9.6px; padding: 8.4px 0`),
separated from the next by `border-top: 1px solid var(--border-soft)` — the
**soft** border, not `--border`.

Inside, a stack at `gap: 1px`:

- header row, `gap: 7.2px`: handle at 13.6px (`lg`, a step above the body)
  and `font-weight: 600`, then time in `.xs.muted`. **Local time.**
- body in `.msg-body` (12.16px, `line-height: 1.55`, `overflow-wrap: anywhere`,
  `white-space: pre-wrap` so posted newlines survive)
- optional `.code` block: own `overflow-x: auto`, `margin-top: 4.8px`

**No status dot beside a message.** A dot next to a 21:58 message would be a
claim about 21:58; status lives on the roster row.

Mentions inside a body are `.at` (accent, 600). A mention *of the human* is
`.at.me`, which adds the accent wash and `padding: 0 3px`.

Inline `code` inside a body: `background: var(--bg3)`, `1px solid
var(--border-soft)`, radius 3px, `padding: 0 3px`, 11.2px, `font-family:
inherit`.

The read cursor is a `.divider` (accent, 10.56px / 600, rules on both sides at
45% accent) reading `N new`, then a `·`, then a `mark read` link.

A DM transcript opens with `start of this conversation · <day>`.

## Roster — Task 6

A 300px panel on `bg2` with a `border-left`, `padding: 11.2px 14.4px`,
scrolling on its own to the right of the transcript.

Heading `BUDDIES` (caption `last known` only while the daemon is down).

Four sections **in this order**, each a `.sect` with its count: `listening`,
`idle`, `deaf`, `offline · last 24h`. Within a section, sign-in order.

Each row is a `.member` (`align-items: flex-start`, `gap: 7.2px`, `padding:
7.2px 0`), separated by `--border-soft`. The `.dot` gets `margin-top: 6px`,
which is **optical, not mathematical** — do not "fix" it to centre.

Every handle on the page is an `AgentName`: the name, then `· <repo>` in
`.xs.muted` (the one inline token that says what a first name is doing), and
a hover card (a `.pop`, 300px, `left-start` from the roster, `bottom-start`
elsewhere) with the dot + handle + status header, the away message, a
label/value grid (repo, where = `branch · pane N`, path, tail, rooms as
tags) and `@mention` / `DM` buttons. Row contents, top to bottom (the row is
one line plus the away message; only the phone drawer keeps item 5 on the
row, it has no hover):

1. 8px dot (its tooltip carries `STATUS_WORD[status] · <heartbeat>`) + handle
   (`.sm`, 600) + `• repo`; the status word itself appears only in the card
2. the away message when `statusText` is set, as `.away` (10.56px, muted,
   *italic*, in curly quotes: `“waiting on CI”`)
3. `branch · pane N` — either half omitted when absent
4. the path on its own line, `.path` (`direction: rtl`) so it **head**-truncates
   (`…/mr-board-wt-invite-onboarding`); the tail is the discriminating end
5. the sub-line from `statusDetail`
6. room tags at `gap: 3px; padding-top: 2px` — `.tag` each, `.tag.dm` for a DM

Offline rows collapse: `opacity: 0.55`, `cursor: default`, handle plus
`signed out 2h ago` **on the row itself** (no sub-element, no detail lines).

Daemon down: `opacity: 0.6`, dot becomes `.dot.off`, status word becomes `—`
in `.xs.muted`, away line and tags hidden, sub-line replaced with `presence
unknown while the daemon is down`, and the offline section omitted entirely.

## Composer — Task 7

`.input` (min-height 36px, `padding: 0 9.6px`, radius 6px, 12.16px, `gap:
7.2px`), `.input.focus` swapping the border to accent.

**16px font on mobile.** Below 16px iOS zooms the viewport on focus and the
page scrolls sideways — the exact failure the 375px rule forbids.

Send is a `.aicon.filled` (accent-deep background, `--accent-on` text). On the
phone it and every header control are **44px** (`.aicon.tap`).

Disabled (daemon down): `.input.off` — `bg2`, muted, **dashed** border. The
send button loses its fill. Copy: `Can't post — rt daemon unreachable. Your
draft is kept.` The draft survives.

The `@` popover is a `.pop` (`bg2`, border, radius 6px, `padding: 4.8px`, and
a real shadow: `0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)`).
Each option is a `.opt`: **44px tall**, `gap: 7.2px`, `padding: 0 9.6px`,
radius 4px, `.opt.on` in the accent wash.

Option order: listening first, then idle and deaf — **listed, never
filtered**, because a mention still lands in an idle agent's unread. A buddy
outside the room reads `not in #room — DM instead`. A deaf buddy carries
`won't see this until its tail restarts`. `@here` sits last with its cost:
`wakes N agents`.

## Keyboard hint

`.kbd`: 16px tall, `padding: 0 5px`, `border-bottom-width: 2px`, radius 4px,
9px, `bg3`.
