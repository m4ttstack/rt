# Glitter diff highlighting

## Problem

Glitter's diff pane reads flat next to GitHub Desktop's (screenshot comparison,
2026-09-24):

- Add and del rows paint on the plain `Bg`. The only signal is a one-cell `+`
  or `-` and a mint or coral foreground, which syntax colours then override.
- The mark sits flush against the line numbers (`1+#`).
- Long lines truncate with `…`; Desktop wraps them.
- Syntax highlighting is wrong for anything line-anchored or multi-line.
  `highlightLine` tokenizes each diff line alone with no trailing `\n`, so
  chroma rules that match a whole line (markdown headings and list markers,
  line comments in several lexers) never fire, and a line inside a block
  comment or multi-line string has no idea it is inside one.
- The palette has no entries for chroma's `Generic*` tokens, so markdown
  headings, bold and italic paint in the base colour even when recognised.
- Del lines are never highlighted at all.

## Prior art

No Go package ships a diff view to import. The surveyed tools assemble chroma
themselves or hand off to delta:

- **Gitea** (`services/gitdiff`): highlights the whole old and new file with
  chroma, splits into lines, looks each diff line up by number. Per-line
  fallback above a size limit. Word emphasis via `sergi/go-diff`.
- **Crush** (`internal/ui/diffview`): chroma per line (same missing-newline
  gap), a `LineStyle` per line kind with separate gutter, symbol and code
  backgrounds. Truncates.
- **diffnav, gh-dash, lazygit**: shell out to delta or a pager.

This design follows Gitea for highlighting and Crush for row styling.

## Design

### 1. Row styling (rt-ui)

New theme tokens in `ui/internal/theme/theme.go`, each a blend of the kind's
accent into `Bg`:

| Token | Role |
|---|---|
| `DiffAddBg` | add row text area |
| `DiffAddGutterBg` | add row gutter (numbers), one step stronger |
| `DiffDelBg` | del row text area |
| `DiffDelGutterBg` | del row gutter, one step stronger |

`renderDiffLine` paints add and del rows edge to edge on these: the gutter
cells on the gutter token, the mark and text on the row token. Context rows
stay on `Bg`. Hover still replaces the row background with `HoverBg`; the
selected stage bar stays solid `Pink`. The mark gets its own three-cell
column (gap, `+`/`-`, gap) so it no longer touches the numbers or the text.
Plain text on add and del rows paints in `Text`; the tint, not a mint or
coral foreground, carries the kind. Exact blend values are set on the `DiffStates` board
first and read off it.

Highlighting keeps running while hovered: every token already carries the
row background, so the old SGR-reset concern does not apply once the hover
background is passed in as that background.

### 2. Whole-file highlighting

**Wire.** `MissionDiffModel` (TS) and `DiffModel` (Go) gain two optional
fields:

```
oldSource?: string   // full old-side file text; absent = unavailable
newSource?: string   // full new-side file text; absent = unavailable
```

**Driver.** A new git-core client verb reads a blob at a revision
(`git cat-file -s` to check size, then `git show <rev>:<path>`); the
working-tree side is a plain file read. Sources are fetched wherever the
driver fetches the diff itself and stored beside it, so a model push never
re-reads git. Per source:

| Diff | old side | new side |
|---|---|---|
| Changes, untracked | absent (empty file) | working-tree file |
| Changes, renamed | index (`:path`) | working-tree file |
| Changes, deleted | `HEAD:path` | absent |
| Changes, other | `HEAD:path` | working-tree file |
| History / Stash, one commit | `<sha>^:<oldPath or path>` (root: absent) | `<sha>:<path>` (deleted: absent) |
| History, range | `<oldest>^:<oldPath or path>` | `<latest>:<path>` |

A side is omitted when it exceeds 256 KiB, is binary, or the read fails. The
diff kinds `binary`, `oversized` and `none` never carry sources.

**rt-ui.** A highlighter tokenizes each present source once with the lexer
for `Lang`, splits the token stream into per-line token lists, and caches the
result keyed by a `hash/maphash` of `(lang, source)`, so the full-model push
on every poll tick costs a hash, not a re-tokenize. Rendering a diff line:

- context and add: new-side tokens at `NewNo`
- del: old-side tokens at `OldNo`

Each looked-up line's plain text must equal `DiffLine.Text`. On a mismatch
(the working tree changed between the diff read and the file read) or a
missing side, that line falls back to hunk-block highlighting.

**Hunk-block fallback.** Per hunk, the new-side lines (context and add) are
joined with `\n`, tokenized once and split back; likewise the old side
(context and del). Every line then gets its trailing newline and its
neighbours, so line-anchored rules fire even without sources.

**Palette.** `chromaStyleTable` grows entries for `GenericHeading`,
`GenericSubheading`, `GenericStrong` and `GenericEmph`, and its values widen
from a colour to a colour plus bold/italic so headings and emphasis can
carry weight. Colours come from the existing theme ramp; the board picks
them.

### 3. Soft wrap (rt-ui)

A line's text wraps at word boundaries to the pane's text width. `ansi.Wrap`
from `charmbracelet/x/ansi` (already a dependency) finds the break points on
the plain text; the highlighted spans are then sliced at those points, so a
token that crosses a break keeps its colour on both rows. (`ansi.Wrap` on a
styled string does not reopen styles on the next row, and it drops the
whitespace at each break, so it cannot be applied to the painted text
directly.)
Continuation rows paint the row's tint with an empty gutter and no mark.
Hunk headers stay clipped to one row.

A per-diff row index (rows per line and its prefix sums), cached by
`(diff identity, text width)`, maps between screen rows and diff lines:

- `diffTop` becomes a screen-row offset. `renderDiffLines` places it with
  `picker.ViewportAround`, passing the cursor line's first row and its extra
  rows as the trailing margin, so a tall cursor line is kept whole in view.
- `diffHit` maps a screen row to its line through the index, so a click on
  a continuation row hits that line (gutter clicks included).
- The cursor, the wheel (which moves the cursor) and staging stay
  line-based. Nothing outside `renderDiffLines`, `diffHit` and the tab
  scroll restore reads `diffTop`.

Every diff tab (Changes, History, Stash) renders through
`renderDiffPane`, so all three get the change at once.

## Out of scope

- Changed-word emphasis on paired del/add lines (`sergi/go-diff`, as Gitea).
  A follow-up once the tints land.
- Split (side-by-side) view.
- Highlighting inside hunk headers.

## Testing

- Go unit: tint tokens on add/del/context rows and their gutters; the mark
  gap; whole-file lookup by `OldNo`/`NewNo`; mismatch fallback; hunk-block
  fallback recognising a markdown heading; cache hit on an identical second
  push; wrap row counts; `diffHit` on a continuation row; the viewport
  keeping a tall cursor line whole.
- TS unit: the source table above, one case per row, plus the size cap and
  the binary/oversized omission.
- `bun run test:all`, so the glitter pty gate runs.
- Visual: the `DiffStates` board updated before code; after the build, a
  real diff captured at a narrow and a wide width and shown to Matt.
