# Glitter Diff Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make glitter's diff pane read like GitHub Desktop's: tinted add/del rows, whole-file syntax highlighting (with a hunk-block fallback), and soft-wrapped long lines.

**Architecture:** git-core reads the old and new file contents beside each displayed diff; the mission driver forwards them as two optional fields on the diff model. rt-ui tokenizes each source once with chroma (cached by content hash), looks each diff line up by line number, falls back to per-hunk tokenizing, and paints rows on new theme tints. Wrapping is a per-diff row index that the renderer, the viewport and the hit test all share.

**Tech Stack:** Go (Bubble Tea v2, lipgloss v2, chroma v2, charmbracelet/x/ansi), TypeScript on Bun (git-core, mission driver).

**Spec:** `docs/superpowers/specs/2026-09-24-glitter-diff-highlighting-design.md`

## Global Constraints

- Source size cap: 256 KiB per side (`DIFF_SOURCE_MAX_BYTES = 256 * 1024`); a side over the cap, binary (contains NUL), or unreadable is omitted.
- Diff kinds `binary`, `oversized`, `none` never carry sources.
- Colours only from `ui/internal/theme/theme.go` tokens; no inline hex anywhere in `ui/internal/views/`.
- Every scroll offset and thumb goes through `ui/internal/views/picker/scroll.go`; every text clip goes through `clip`/`clipOn` (`ui/internal/views/mission/topbar.go`). Do not hand-roll a second copy.
- The TS CLI stays UI-free: no styling or ANSI in `lib/` or `packages/git-core/`.
- Comments state constraints only (clean-code rule): no narration, no task numbers, no review history in source.
- No em or en dashes in code, comments, or commit messages.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Go tests: `cd ui && go test ./internal/...`. TS tests: `bun run test`. Before the final task: `bun run test:all`.
- After any change under `ui/`, `bun run ui:build` so the worktree's `ui/dist/rt-ui` is current.

## Review Focus

1. **CRLF files.** A source with `\r\n` endings must still match its diff lines; `tokenizeLines` strips one trailing `\r` per line and the text comparison trims it on both sides (Task 3 and Task 5 tests).
2. **Working tree edited between the diff read and the file read.** A line whose source text differs from `DiffLine.Text` must fall back to hunk-block highlighting, never paint the wrong line's tokens (Task 5 test).
3. **A token that crosses a wrap break** (a long string literal) keeps its colour on both rows, and no characters are lost or duplicated at the break (Task 8 test).
4. **Clicking a continuation row** of a wrapped line hits that line, in the gutter as well as the text (Task 8 test).
5. **A cursor line taller than the pane** (one line wrapping to more rows than fit) must not loop or panic in the viewport; its first row stays at the top (Task 8 test).

---

### Task 1: Design board (controller-owned)

Done by the controller, not a subagent: visual work stays with the controller.

**Files:**
- Modify: `docs/design/mission/mission.pen` (via the pencil MCP only; never Read/Grep a `.pen`)
- Modify: `docs/design/mission/DiffStates.png`

- [ ] **Step 1:** Open the `DiffStates` board with the pencil MCP. Add a Changes diff showing: context, add, del, a selected add (pink bar), a hovered del, a wrapped add line (two continuation rows), a markdown heading, a bold span.
- [ ] **Step 2:** Paint with these starting values and adjust by eye against the GitHub Desktop screenshot; record the final values back into Tasks 2 and 3 of this plan before dispatch:
  - `DiffAddBg = blendToward(Mint, Bg, 0.84)`, `DiffAddGutterBg = blendToward(Mint, Bg, 0.72)`
  - `DiffDelBg = blendToward(Coral, Bg, 0.84)`, `DiffDelGutterBg = blendToward(Coral, Bg, 0.72)`
  - `GenericHeading` Pink bold, `GenericSubheading` PinkSoft bold, `GenericStrong` Text bold, `GenericEmph` TextSoft italic
- [ ] **Step 3:** Export `DiffStates.png`, show it to Matt, and wait for his OK.
- [ ] **Step 4:** Commit: `git add docs/design/mission && git commit -m "design: glitter diff tints, wrap and markdown weights"`

---

### Task 2: Theme tints

**Files:**
- Modify: `ui/internal/theme/theme.go` (after `GutterHoverBar`)
- Test: `ui/internal/theme/theme_test.go`

**Interfaces:**
- Produces: `theme.DiffAddBg`, `theme.DiffAddGutterBg`, `theme.DiffDelBg`, `theme.DiffDelGutterBg` (all `color.Color`)

- [ ] **Step 1: Write the failing test** (append to `theme_test.go`)

```go
func TestDiffTintsSitBetweenBgAndTheirAccent(t *testing.T) {
	for name, c := range map[string]struct{ tint, gutter, accent color.Color }{
		"add": {DiffAddBg, DiffAddGutterBg, Mint},
		"del": {DiffDelBg, DiffDelGutterBg, Coral},
	} {
		if Hex(c.tint) == Hex(Bg) || Hex(c.gutter) == Hex(Bg) {
			t.Fatalf("%s tint collapsed onto Bg", name)
		}
		if dist(c.gutter, Bg) <= dist(c.tint, Bg) {
			t.Fatalf("%s gutter must be one step stronger than its row tint", name)
		}
		if dist(c.gutter, c.accent) >= dist(Bg, c.accent) {
			t.Fatalf("%s gutter must lean toward its accent", name)
		}
	}
}

func dist(a, b color.Color) int {
	ar, ag, ab, _ := a.RGBA()
	br, bg, bb, _ := b.RGBA()
	d := func(x, y uint32) int { v := int(x>>8) - int(y>>8); return v * v }
	return d(ar, br) + d(ag, bg) + d(ab, bb)
}
```

(Add `"image/color"` to the test file's imports if absent.)

- [ ] **Step 2:** Run `cd ui && go test ./internal/theme/ -run TestDiffTints` and expect a compile failure (undefined `DiffAddBg`).

- [ ] **Step 3: Implement**

```go
// diffTintBlend and diffGutterBlend sink a diff kind's accent toward Bg:
// the row reads as tinted, not as a highlight, and the number column sits
// one visible step stronger so the gutter reads as its own strip.
const (
	diffTintBlend   = 0.84
	diffGutterBlend = 0.72
)

var (
	DiffAddBg       = blendToward(Mint, Bg, diffTintBlend)
	DiffAddGutterBg = blendToward(Mint, Bg, diffGutterBlend)
	DiffDelBg       = blendToward(Coral, Bg, diffTintBlend)
	DiffDelGutterBg = blendToward(Coral, Bg, diffGutterBlend)
)
```

- [ ] **Step 4:** Run the test; expect PASS.
- [ ] **Step 5:** Commit: `rt-ui theme: diff add/del row and gutter tints`

---

### Task 3: Line tokenizer, palette weights, newline fix

**Files:**
- Modify: `ui/internal/views/mission/highlight.go`
- Test: `ui/internal/views/mission/highlight_test.go`

**Interfaces:**
- Produces:
  - `type tokStyle struct { fg color.Color; bold, italic bool }` (nil `fg` = paint in the caller's base)
  - `type span struct { text string; style tokStyle }`
  - `var chromaStyleTable map[chroma.TokenType]tokStyle`
  - `func tokenizeLines(lang, src string) [][]span`: one entry per line of `src` (a trailing `\n` does not add an empty last line), newline characters removed, one trailing `\r` per line removed. An empty or unknown `lang` returns each line as a single unstyled span.
  - `func paintSpans(spans []span, base, bg color.Color) string`: every span rendered over `bg`, unstyled spans in `base`.
  - `func spansText(spans []span) string`
  - `highlightLine(lang, text string, base, bg color.Color) string` keeps its signature and becomes `paintSpans(first line of tokenizeLines(lang, text+"\n"), base, bg)`.

- [ ] **Step 1: Write the failing tests** (append to `highlight_test.go`; update `allowedHighlightSGR` to range over `c.fg` instead of `c`, skipping nil)

```go
func TestTokenizeLinesRecognisesAMarkdownHeading(t *testing.T) {
	lines := tokenizeLines("markdown", "# Title\nplain\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d", len(lines))
	}
	if spansText(lines[0]) != "# Title" || spansText(lines[1]) != "plain" {
		t.Fatalf("line text changed: %q / %q", spansText(lines[0]), spansText(lines[1]))
	}
	want := chromaStyleTable[chroma.GenericHeading]
	if !sameColor(lines[0][0].style.fg, want.fg) || !lines[0][0].style.bold {
		t.Fatalf("heading painted %+v, want %+v", lines[0][0].style, want)
	}
}

func TestTokenizeLinesSplitsAMultiLineToken(t *testing.T) {
	lines := tokenizeLines("go", "a := `one\ntwo`\n")
	if len(lines) != 2 || spansText(lines[0]) != "a := `one" || spansText(lines[1]) != "two`" {
		t.Fatalf("got %+v", lines)
	}
	last := lines[1][0].style.fg
	if !sameColor(last, chromaStyleTable[chroma.LiteralString].fg) {
		t.Fatalf("second half of the raw string lost its colour: %v", last)
	}
}

func TestTokenizeLinesStripsCarriageReturns(t *testing.T) {
	lines := tokenizeLines("go", "x := 1\r\ny := 2\r\n")
	if spansText(lines[0]) != "x := 1" || spansText(lines[1]) != "y := 2" {
		t.Fatalf("CR survived: %q / %q", spansText(lines[0]), spansText(lines[1]))
	}
}

func TestTokenizeLinesEmptyLangIsPlain(t *testing.T) {
	lines := tokenizeLines("", "a\nb")
	if len(lines) != 2 || len(lines[0]) != 1 || lines[0][0].style.fg != nil {
		t.Fatalf("got %+v", lines)
	}
}

func TestHighlightLineMarkdownHeadingIsColoured(t *testing.T) {
	out := highlightLine("markdown", "# Title", theme.TextSoft, theme.Bg)
	if !strings.Contains(out, fgSGR(chromaStyleTable[chroma.GenericHeading].fg)) {
		t.Fatalf("heading not coloured:\n%q", out)
	}
}
```

Also add this helper to `highlight_test.go` (colours from chroma and from the theme are different concrete types, so compare by hex; Tasks 5 and 8 use it too):

```go
func sameColor(a, b color.Color) bool {
	return a != nil && b != nil && theme.Hex(a) == theme.Hex(b)
}
```

(Import `github.com/alecthomas/chroma/v2` in the test file.)

- [ ] **Step 2:** Run `cd ui && go test ./internal/views/mission/ -run 'TestTokenizeLines|TestHighlightLine'`; expect compile failure.

- [ ] **Step 3: Implement** in `highlight.go`:

```go
type tokStyle struct {
	fg           color.Color
	bold, italic bool
}

type span struct {
	text  string
	style tokStyle
}

var chromaStyleTable = map[chroma.TokenType]tokStyle{
	chroma.Keyword:           {fg: theme.Lav},
	chroma.KeywordType:       {fg: theme.Lav},
	chroma.NameFunction:      {fg: theme.Cyan},
	chroma.NameClass:         {fg: theme.Blue},
	chroma.NameBuiltin:       {fg: theme.Blue},
	chroma.LiteralString:     {fg: theme.Mint},
	chroma.LiteralNumber:     {fg: theme.Peach},
	chroma.Comment:           {fg: theme.Faint},
	chroma.Operator:          {fg: theme.TextSoft},
	chroma.Punctuation:       {fg: theme.TextSoft},
	chroma.Error:             {fg: theme.Coral},
	chroma.GenericHeading:    {fg: theme.Pink, bold: true},
	chroma.GenericSubheading: {fg: theme.PinkSoft, bold: true},
	chroma.GenericStrong:     {fg: theme.Text, bold: true},
	chroma.GenericEmph:       {fg: theme.TextSoft, italic: true},
}

func buildChromaStyle() *chroma.Style {
	entries := chroma.StyleEntries{}
	for tt, s := range chromaStyleTable {
		e := theme.Hex(s.fg)
		if s.bold {
			e = "bold " + e
		}
		if s.italic {
			e = "italic " + e
		}
		entries[tt] = e
	}
	return chroma.MustNewStyle("rt", entries)
}

func styleFor(tt chroma.TokenType) tokStyle {
	e := chromaStyle.Get(tt)
	s := tokStyle{bold: e.Bold == chroma.Yes, italic: e.Italic == chroma.Yes}
	if e.Colour.IsSet() {
		s.fg = lipgloss.Color(e.Colour.String())
	}
	return s
}

// tokenizeLines tokenizes src as one text so line-anchored and multi-line
// lexer rules see real newlines, then cuts the token stream back into lines.
func tokenizeLines(lang, src string) [][]span {
	src = strings.TrimSuffix(src, "\n")
	plain := func() [][]span {
		var out [][]span
		for _, l := range strings.Split(src, "\n") {
			out = append(out, []span{{text: strings.TrimSuffix(l, "\r")}})
		}
		return out
	}
	if lang == "" {
		return plain()
	}
	lx := lexers.Get(lang)
	if lx == nil {
		return plain()
	}
	it, err := chroma.Coalesce(lx).Tokenise(nil, src+"\n")
	if err != nil {
		return plain()
	}
	out := [][]span{nil}
	for tok := it(); tok != chroma.EOF; tok = it() {
		st := styleFor(tok.Type)
		for i, piece := range strings.Split(tok.Value, "\n") {
			if i > 0 {
				out = append(out, nil)
			}
			if piece != "" {
				out[len(out)-1] = append(out[len(out)-1], span{text: piece, style: st})
			}
		}
	}
	if n := len(out); n > 1 && len(out[n-1]) == 0 {
		out = out[:n-1]
	}
	for i := range out {
		out[i] = trimCR(out[i])
	}
	return out
}

func trimCR(line []span) []span {
	if n := len(line); n > 0 && strings.HasSuffix(line[n-1].text, "\r") {
		line[n-1].text = strings.TrimSuffix(line[n-1].text, "\r")
		if line[n-1].text == "" {
			line = line[:n-1]
		}
	}
	return line
}

func spansText(spans []span) string {
	var b strings.Builder
	for _, s := range spans {
		b.WriteString(s.text)
	}
	return b.String()
}

// paintSpans renders every span over bg: a token without its own
// background would punch a hole in the row's fill.
func paintSpans(spans []span, base, bg color.Color) string {
	var b strings.Builder
	for _, s := range spans {
		st := lipgloss.NewStyle().Background(bg).Foreground(base)
		if s.style.fg != nil {
			st = st.Foreground(s.style.fg)
		}
		b.WriteString(st.Bold(s.style.bold).Italic(s.style.italic).Render(s.text))
	}
	return b.String()
}

func highlightLine(lang, text string, base, bg color.Color) string {
	lines := tokenizeLines(lang, text+"\n")
	if len(lines) == 0 {
		return paintSpans(nil, base, bg)
	}
	return paintSpans(lines[0], base, bg)
}
```

Note: the old `lexers.Fallback` path becomes the plain path; `TestHighlightLineUnknownLexerFallsBackToPlain` keeps passing because plain paints in `base`. If an existing test asserts `highlightLine("", "", ...)` output exactly, keep that output identical.

- [ ] **Step 4:** Run `cd ui && go test ./internal/views/mission/`; expect PASS (all existing highlight tests included).
- [ ] **Step 5:** Commit: `rt-ui mission: tokenize diff text with real newlines; markdown weights in the palette`

---

### Task 4: Tinted diff rows

**Files:**
- Modify: `ui/internal/views/mission/diff.go` (`renderDiffLine`, `renderDiffLines`, `lineMarkAndColor`; add `diffMarkWidth`)
- Test: `ui/internal/views/mission/render_test.go`, `history_test.go` (update expectations that pinned the old layout)

**Interfaces:**
- Consumes: `span`, `paintSpans`, `tokenizeLines` (Task 3); theme tints (Task 2)
- Produces:
  - `const diffMarkWidth = 3` (gap, mark, gap)
  - `func diffRowBgs(kind string, hover bool) (gutter, row color.Color)`
  - `func renderDiffRows(d DiffModel, line DiffLine, spans []span, width int, hover, gutterHover bool) []string` (one row per call in this task; Task 7 makes it return more)
  - `renderDiffLine(d, line, width, hover, gutterHover) string` stays as a wrapper: `strings.Join(renderDiffRows(d, line, lineSpans(d.Lang, line), width, hover, gutterHover), "\n")`
  - `func lineSpans(lang string, line DiffLine) []span`: `tokenizeLines(lang, line.Text+"\n")[0]`, or `[]span{{text: line.Text}}` when that is empty.

- [ ] **Step 1: Write the failing tests** (append to `render_test.go`)

```go
func TestDiffAddRowPaintsTintAndGutterTint(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "add", NewNo: 7, Text: "x"}, 40, false, false)
	for _, want := range []string{bgSGR(theme.DiffAddBg), bgSGR(theme.DiffAddGutterBg)} {
		if !strings.Contains(out, want) {
			t.Fatalf("add row missing %s:\n%q", want, out)
		}
	}
	if strings.Contains(out, bgSGR(theme.Bg)) {
		t.Fatalf("add row leaks plain Bg:\n%q", out)
	}
}

func TestDiffDelRowPaintsDelTint(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "del", OldNo: 3, Text: "y"}, 40, false, false)
	if !strings.Contains(out, bgSGR(theme.DiffDelBg)) || !strings.Contains(out, bgSGR(theme.DiffDelGutterBg)) {
		t.Fatalf("del row missing its tints:\n%q", out)
	}
}

func TestDiffContextRowStaysOnBg(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "context", OldNo: 1, NewNo: 1, Text: "z"}, 40, false, false)
	if strings.Contains(out, bgSGR(theme.DiffAddBg)) || strings.Contains(out, bgSGR(theme.DiffDelBg)) {
		t.Fatalf("context row tinted:\n%q", out)
	}
}

func TestDiffMarkSitsInItsOwnColumn(t *testing.T) {
	out := ansi.Strip(renderDiffLine(DiffModel{}, DiffLine{Kind: "add", NewNo: 12, Text: "body"}, 40, false, false))
	if !strings.Contains(out, "12 + body") {
		t.Fatalf("want number, gap, mark, gap, text; got %q", out)
	}
}

func TestDiffHoverKeepsHighlighting(t *testing.T) {
	d := DiffModel{Lang: "go"}
	out := renderDiffLine(d, DiffLine{Kind: "add", NewNo: 1, Text: `s := "hi"`}, 60, true, false)
	if !strings.Contains(out, fgSGR(chromaStyleTable[chroma.LiteralString].fg)) {
		t.Fatalf("hovered row lost syntax colour:\n%q", out)
	}
	if !strings.Contains(out, bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered row not on HoverBg:\n%q", out)
	}
}

func TestDiffDelLineIsHighlighted(t *testing.T) {
	d := DiffModel{Lang: "go"}
	out := renderDiffLine(d, DiffLine{Kind: "del", OldNo: 1, Text: `s := "hi"`}, 60, false, false)
	if !strings.Contains(out, fgSGR(chromaStyleTable[chroma.LiteralString].fg)) {
		t.Fatalf("del row not highlighted:\n%q", out)
	}
}
```

- [ ] **Step 2:** Run `cd ui && go test ./internal/views/mission/ -run 'TestDiff'`; expect FAIL.

- [ ] **Step 3: Implement** in `diff.go`. Replace `renderDiffLine` and `lineMarkAndColor`:

```go
const diffMarkWidth = 3

func diffRowBgs(kind string, hover bool) (gutter, row color.Color) {
	switch {
	case hover:
		return theme.HoverBg, theme.HoverBg
	case kind == "add":
		return theme.DiffAddGutterBg, theme.DiffAddBg
	case kind == "del":
		return theme.DiffDelGutterBg, theme.DiffDelBg
	}
	return theme.Bg, theme.Bg
}

func lineMark(kind string) (string, color.Color, color.Color) {
	switch kind {
	case "add":
		return "+", theme.Mint, theme.Text
	case "del":
		return "-", theme.Coral, theme.Text
	}
	return " ", theme.TextSoft, theme.TextSoft
}

func lineSpans(lang string, line DiffLine) []span {
	if lines := tokenizeLines(lang, line.Text+"\n"); len(lines) > 0 && len(lines[0]) > 0 {
		return lines[0]
	}
	return []span{{text: line.Text}}
}

func renderDiffLine(d DiffModel, line DiffLine, width int, hover, gutterHover bool) string {
	return strings.Join(renderDiffRows(d, line, lineSpans(d.Lang, line), width, hover, gutterHover), "\n")
}

func renderDiffRows(d DiffModel, line DiffLine, spans []span, width int, hover, gutterHover bool) []string {
	if width < 1 {
		return []string{""}
	}
	if line.Kind == "hunk" {
		bg := theme.Surface
		if hover {
			bg = theme.HoverBg
		}
		// Clipped to one row: a wrapped header would desync diffHit.
		return []string{lipgloss.NewStyle().Width(width).Background(bg).Foreground(theme.Lav).Render(clip(" "+line.Text, width))}
	}
	gutterBg, rowBg := diffRowBgs(line.Kind, hover)
	gOn := lipgloss.NewStyle().Background(gutterBg)
	on := lipgloss.NewStyle().Background(rowBg)

	bar, barStyle := " ", gOn
	switch {
	case d.ReadOnly:
	case line.Selected:
		bar, barStyle = theme.GlyphBar, barStyle.Foreground(theme.Pink)
	case gutterHover:
		bar, barStyle = theme.GlyphBar, barStyle.Foreground(theme.GutterHoverBar)
	}
	gutter := barStyle.Render(bar) + numCell(gOn, line.OldNo) + numCell(gOn, line.NewNo)

	mark, markCol, base := lineMark(line.Kind)
	markCell := on.Render(" ") + on.Foreground(markCol).Render(mark) + on.Render(" ")
	textW := max(width-diffGutterWidth-diffMarkWidth, 0)
	text := clipOn(paintSpans(spans, base, rowBg), textW, on)
	return []string{on.Width(width).Render(clipOn(gutter+markCell+text, width, on))}
}
```

In `renderDiffLines`, replace the `renderDiffLine(...)` call with `renderDiffRows(m.model.Diff, lines[idx], lineSpans(m.model.Diff.Lang, lines[idx]), contentW, hover, hover && m.hoverGutter)[0]`. Remove the old doc comment's SGR-reset paragraph (it no longer holds). Delete `lineMarkAndColor` once nothing references it.

Existing tests that pinned `" +"`-adjacent layout or "no highlight on hover" update to the new layout; do not delete a test to make it pass, change its expectation to the new rule.

- [ ] **Step 4:** Run `cd ui && go test ./internal/views/mission/`; expect PASS.
- [ ] **Step 5:** `bun run ui:build`, then commit: `rt-ui mission: tint add/del diff rows, give the mark its own column`

---

### Task 5: Whole-file and hunk-block highlighting (rt-ui)

**Files:**
- Create: `ui/internal/views/mission/diff_highlight.go`
- Create: `ui/internal/views/mission/diff_highlight_test.go`
- Modify: `ui/internal/views/mission/model.go` (`DiffModel`)
- Modify: `ui/internal/views/mission/mission.go` (add `diffHL diffHighlighter` field)
- Modify: `ui/internal/views/mission/diff.go` (`renderDiffLines` uses it)

**Interfaces:**
- Consumes: `tokenizeLines`, `spansText`, `span` (Task 3); `renderDiffRows` (Task 4)
- Produces:
  - `DiffModel.OldSource *string \`json:"oldSource,omitempty"\``, `DiffModel.NewSource *string \`json:"newSource,omitempty"\``
  - `type diffHighlighter struct` with `func (h *diffHighlighter) forDiff(d DiffModel) [][]span` returning a slice aligned with `d.Lines` (nil entry = paint flat), or nil when `d.Lang == ""` or `d.Kind != "text"`.

- [ ] **Step 1: Write the failing tests** (`diff_highlight_test.go`)

```go
package mission

import (
	"testing"

	"github.com/alecthomas/chroma/v2"
)

func strp(s string) *string { return &s }

func TestForDiffUsesTheWholeFileSoABlockCommentStaysAComment(t *testing.T) {
	src := "/*\nstill a comment\n*/\nx := 1\n"
	d := DiffModel{Kind: "text", Lang: "go", NewSource: strp(src), Lines: []DiffLine{
		{Kind: "hunk", Text: "@@ -1,0 +2,1 @@"},
		{Kind: "add", NewNo: 2, Text: "still a comment"},
	}}
	var h diffHighlighter
	spans := h.forDiff(d)
	if !sameColor(spans[1][0].style.fg, chromaStyleTable[chroma.Comment].fg) {
		t.Fatalf("line 2 should inherit the block comment: %+v", spans[1])
	}
}

func TestForDiffDelLineReadsTheOldSide(t *testing.T) {
	d := DiffModel{Kind: "text", Lang: "go", OldSource: strp("a := \"s\"\n"), NewSource: strp("a := 1\n"), Lines: []DiffLine{
		{Kind: "hunk", Text: "@@"},
		{Kind: "del", OldNo: 1, Text: `a := "s"`},
		{Kind: "add", NewNo: 1, Text: "a := 1"},
	}}
	var h diffHighlighter
	spans := h.forDiff(d)
	if spansText(spans[1]) != `a := "s"` || spansText(spans[2]) != "a := 1" {
		t.Fatalf("sides crossed: %q / %q", spansText(spans[1]), spansText(spans[2]))
	}
}

func TestForDiffMismatchFallsBackToHunkBlock(t *testing.T) {
	d := DiffModel{Kind: "text", Lang: "markdown", NewSource: strp("edited since\n"), Lines: []DiffLine{
		{Kind: "hunk", Text: "@@"},
		{Kind: "add", NewNo: 1, Text: "# Heading"},
	}}
	var h diffHighlighter
	spans := h.forDiff(d)
	if spansText(spans[1]) != "# Heading" {
		t.Fatalf("painted the stale source line: %q", spansText(spans[1]))
	}
	if !spans[1][0].style.bold {
		t.Fatalf("hunk-block fallback did not recognise the heading: %+v", spans[1])
	}
}

func TestForDiffWithoutSourcesUsesHunkBlocks(t *testing.T) {
	d := DiffModel{Kind: "text", Lang: "markdown", Lines: []DiffLine{
		{Kind: "hunk", Text: "@@"},
		{Kind: "context", OldNo: 1, NewNo: 1, Text: "intro"},
		{Kind: "add", NewNo: 2, Text: "## Sub"},
	}}
	var h diffHighlighter
	if s := h.forDiff(d)[2]; !s[0].style.bold {
		t.Fatalf("subheading not recognised: %+v", s)
	}
}

func TestForDiffCRLFSourceStillMatches(t *testing.T) {
	d := DiffModel{Kind: "text", Lang: "go", NewSource: strp("/*\r\nc\r\n*/\r\n"), Lines: []DiffLine{
		{Kind: "hunk", Text: "@@"},
		{Kind: "add", NewNo: 2, Text: "c\r"},
	}}
	var h diffHighlighter
	if s := h.forDiff(d)[1]; !sameColor(s[0].style.fg, chromaStyleTable[chroma.Comment].fg) {
		t.Fatalf("CRLF source failed to match: %+v", s)
	}
}

func TestForDiffCachesTokenizedSources(t *testing.T) {
	src := "x := 1\n"
	mk := func() DiffModel {
		return DiffModel{Kind: "text", Lang: "go", NewSource: strp(src), Lines: []DiffLine{{Kind: "hunk"}, {Kind: "add", NewNo: 1, Text: "x := 1"}}}
	}
	var h diffHighlighter
	h.forDiff(mk())
	n := h.tokenized
	h.forDiff(mk())
	if h.tokenized != n {
		t.Fatalf("an identical second push re-tokenized the source (%d -> %d)", n, h.tokenized)
	}
}

func TestForDiffNoLangIsNil(t *testing.T) {
	var h diffHighlighter
	if h.forDiff(DiffModel{Kind: "text", Lines: []DiffLine{{Kind: "add", Text: "x"}}}) != nil {
		t.Fatal("no lang should paint flat")
	}
}
```

- [ ] **Step 2:** Run `cd ui && go test ./internal/views/mission/ -run TestForDiff`; expect compile failure.

- [ ] **Step 3: Implement**

`model.go`, inside `DiffModel`:

```go
	// OldSource/NewSource are the whole old- and new-side files; nil when the
	// driver could not supply one (over its size cap, binary, or absent).
	OldSource *string `json:"oldSource,omitempty"`
	NewSource *string `json:"newSource,omitempty"`
```

`diff_highlight.go`:

```go
package mission

import (
	"hash/maphash"
	"strings"
)

// diffHighlightCacheCap bounds the tokenized-text cache: every model push
// re-sends the sources, so the cache only has to span a few selections.
const diffHighlightCacheCap = 8

type diffHighlighter struct {
	seed      maphash.Seed
	cache     map[uint64][][]span
	tokenized int
	lastKey   *DiffLine
	lastN     int
	last      [][]span
}

func (h *diffHighlighter) tokenize(lang, src string) [][]span {
	if h.cache == nil {
		h.seed = maphash.MakeSeed()
		h.cache = map[uint64][][]span{}
	}
	key := maphash.String(h.seed, lang+"\x00"+src)
	if lines, ok := h.cache[key]; ok {
		return lines
	}
	if len(h.cache) >= diffHighlightCacheCap {
		h.cache = map[uint64][][]span{}
	}
	lines := tokenizeLines(lang, src)
	h.cache[key] = lines
	h.tokenized++
	return lines
}

// forDiff keys on the decoded Lines backing array: each model push decodes
// a fresh one, so a repeat frame of the same model reuses the result.
func (h *diffHighlighter) forDiff(d DiffModel) [][]span {
	if d.Lang == "" || d.Kind != "text" || len(d.Lines) == 0 {
		return nil
	}
	if h.lastKey == &d.Lines[0] && h.lastN == len(d.Lines) {
		return h.last
	}
	var oldLines, newLines [][]span
	if d.OldSource != nil {
		oldLines = h.tokenize(d.Lang, *d.OldSource)
	}
	if d.NewSource != nil {
		newLines = h.tokenize(d.Lang, *d.NewSource)
	}
	out := make([][]span, len(d.Lines))
	missing := false
	for i, l := range d.Lines {
		if l.Kind == "hunk" {
			continue
		}
		src, no := newLines, l.NewNo
		if l.Kind == "del" {
			src, no = oldLines, l.OldNo
		}
		if s, ok := sourceLine(src, no, l.Text); ok {
			out[i] = s
			continue
		}
		missing = true
	}
	if missing {
		h.fillHunkBlocks(d, out)
	}
	h.lastKey, h.lastN, h.last = &d.Lines[0], len(d.Lines), out
	return out
}

func sourceLine(lines [][]span, no int, want string) ([]span, bool) {
	if no < 1 || no > len(lines) {
		return nil, false
	}
	s := lines[no-1]
	return s, spansText(s) == strings.TrimSuffix(want, "\r")
}

// fillHunkBlocks tokenizes each hunk's new side (context + add) and old side
// (context + del) as one text apiece, for the lines no source could answer.
func (h *diffHighlighter) fillHunkBlocks(d DiffModel, out [][]span) {
	flush := func(idx []int, texts []string) {
		if len(idx) == 0 {
			return
		}
		lines := h.tokenize(d.Lang, strings.Join(texts, "\n")+"\n")
		for j, i := range idx {
			if out[i] == nil && j < len(lines) {
				out[i] = lines[j]
			}
		}
	}
	var newIdx, oldIdx []int
	var newTxt, oldTxt []string
	end := func() {
		flush(newIdx, newTxt)
		flush(oldIdx, oldTxt)
		newIdx, oldIdx, newTxt, oldTxt = nil, nil, nil, nil
	}
	for i, l := range d.Lines {
		switch l.Kind {
		case "hunk":
			end()
		case "del":
			oldIdx, oldTxt = append(oldIdx, i), append(oldTxt, l.Text)
		case "add":
			newIdx, newTxt = append(newIdx, i), append(newTxt, l.Text)
		default:
			newIdx, newTxt = append(newIdx, i), append(newTxt, l.Text)
			oldIdx, oldTxt = append(oldIdx, i), append(oldTxt, l.Text)
		}
	}
	end()
}
```

Note: a context line is appended to both sides; `flush` only fills entries still nil, so the new side (flushed first) wins for context lines.

`mission.go`: add `diffHL diffHighlighter` to the `Mission` struct beside `diffCursor`/`diffTop`.

`diff.go` `renderDiffLines`: before the loop, `hl := m.diffHL.forDiff(m.model.Diff)`; per line, `spans := lineSpans(m.model.Diff.Lang, lines[idx])` then `if hl != nil && hl[idx] != nil { spans = hl[idx] }`, and pass `spans` to `renderDiffRows`.

- [ ] **Step 4:** Run `cd ui && go test ./internal/views/mission/`; expect PASS.
- [ ] **Step 5:** `bun run ui:build`, commit: `rt-ui mission: whole-file diff highlighting with a hunk-block fallback`

---

### Task 6: git-core reads diff sources

**Files:**
- Create: `packages/git-core/src/diff-sources.ts`
- Create: `packages/git-core/src/__tests__/diff-sources.test.ts`
- Modify: `packages/git-core/src/types.ts` (`StagingDiff`, `GitClient`)
- Modify: `packages/git-core/src/staging.ts` (`getStagingDiff`)
- Modify: `packages/git-core/src/history.ts` (`getCommitDiff`, `getCommitRangeDiff`)
- Modify: `packages/git-core/src/client.ts` (pass `opts` through)

**Interfaces:**
- Produces:
  - `export interface DiffSources { old?: string; new?: string }`
  - `export interface DiffReadOpts { withSources?: boolean }`
  - `StagingDiff.sources?: DiffSources`
  - `GitClient.stagingDiff(path: string, opts?: DiffReadOpts)`, `commitDiff(file, sha, opts?: DiffReadOpts)`, `commitRangeDiff(file, shas, opts?: DiffReadOpts)`
  - `export const DIFF_SOURCE_MAX_BYTES = 256 * 1024`

- [ ] **Step 1: Write the failing tests** (`diff-sources.test.ts`)

```ts
import { describe, expect, it } from "bun:test";
import { rename, unlink } from "node:fs/promises";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";
import { DIFF_SOURCE_MAX_BYTES } from "../diff-sources.ts";

describe("diff sources", () => {
  it("modified: old is HEAD, new is the working tree", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.ts", "a\n");
      await sb.commitAll("base");
      await sb.write("f.ts", "b\n");
      const diff = await createGitClient(sb.dir).stagingDiff("f.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "a\n", new: "b\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("untracked: no old side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("seed.txt", "s\n");
      await sb.commitAll("base");
      await sb.write("n.ts", "new\n");
      const diff = await createGitClient(sb.dir).stagingDiff("n.ts", { withSources: true });
      expect(diff.sources?.old).toBeUndefined();
      expect(diff.sources?.new).toBe("new\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("deleted: no new side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("d.ts", "gone\n");
      await sb.commitAll("base");
      await unlink(`${sb.dir}/d.ts`);
      const diff = await createGitClient(sb.dir).stagingDiff("d.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "gone\n", new: undefined });
    } finally {
      await sb.cleanup();
    }
  });

  it("renamed: old side is the index", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.ts", "one\n");
      await sb.commitAll("base");
      await rename(`${sb.dir}/a.ts`, `${sb.dir}/b.ts`);
      await sb.git(["add", "-A"]);
      await sb.write("b.ts", "one\ntwo\n");
      const diff = await createGitClient(sb.dir).stagingDiff("b.ts", { withSources: true });
      expect(diff.sources).toEqual({ old: "one\n", new: "one\ntwo\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("over the cap: side omitted", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("big.txt", "x\n");
      await sb.commitAll("base");
      await sb.write("big.txt", "y".repeat(DIFF_SOURCE_MAX_BYTES + 1));
      const diff = await createGitClient(sb.dir).stagingDiff("big.txt", { withSources: true });
      expect(diff.sources?.old).toBe("x\n");
      expect(diff.sources?.new).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });

  it("no opts: no sources", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("f.ts", "a\n");
      await sb.commitAll("base");
      await sb.write("f.ts", "b\n");
      const diff = await createGitClient(sb.dir).stagingDiff("f.ts");
      expect(diff.sources).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });

  it("commit: old is the parent, new is the commit; root commit has no old side", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("c.ts", "v1\n");
      await sb.commitAll("one");
      const root = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.write("c.ts", "v2\n");
      await sb.commitAll("two");
      const head = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      const files = (await client.changedFiles(head)).files;
      const diff = await client.commitDiff(files[0]!, head, { withSources: true });
      expect(diff.sources).toEqual({ old: "v1\n", new: "v2\n" });
      const rootFiles = (await client.changedFiles(root)).files;
      const rootDiff = await client.commitDiff(rootFiles[0]!, root, { withSources: true });
      expect(rootDiff.sources).toEqual({ old: undefined, new: "v1\n" });
    } finally {
      await sb.cleanup();
    }
  });

  it("binary: no sources", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("b.bin", "a\0b");
      await sb.commitAll("base");
      await sb.write("b.bin", "a\0c");
      const diff = await createGitClient(sb.dir).stagingDiff("b.bin", { withSources: true });
      expect(diff.kind).toBe("binary");
      expect(diff.sources).toBeUndefined();
    } finally {
      await sb.cleanup();
    }
  });
});
```

If `makeSandbox` has no `git` helper exposed as `sb.git`, check `packages/git-core/test-support/sandbox.ts` for the helper's real name and use it; `staging.test.ts` calls `sb.git([...])`.

- [ ] **Step 2:** Run `bun test packages/git-core/src/__tests__/diff-sources.test.ts`; expect FAIL (module not found).

- [ ] **Step 3: Implement**

`types.ts`:

```ts
export interface DiffSources {
  old?: string;
  new?: string;
}

export interface DiffReadOpts {
  /** Also read the whole old- and new-side files, for whole-file highlighting. */
  withSources?: boolean;
}
```

Add `sources?: DiffSources;` to `StagingDiff`, and the optional `opts?: DiffReadOpts` parameter to the three `GitClient` methods.

`diff-sources.ts`:

```ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import type { DiffSources } from "./types.ts";
import { AppFileStatusKind, type CommittedFileChange } from "./vendor/ghd/types.ts";

export const DIFF_SOURCE_MAX_BYTES = 256 * 1024;

function textOnly(text: string): string | undefined {
  return text.includes("\0") ? undefined : text;
}

/**
 * The file at `rev` ("" = the index), or undefined when the path does not
 * exist there (a root commit's parent, a file added by the commit), is over
 * the cap, or is binary. A missing path is the expected case, not an error.
 */
export async function readRevisionFile(ctx: ClientContext, rev: string, path: string): Promise<string | undefined> {
  const spec = `${rev}:${path}`;
  try {
    const size = Number((await rawGit(ctx.dir, ["cat-file", "-s", spec])).trim());
    if (!Number.isFinite(size) || size > DIFF_SOURCE_MAX_BYTES) return undefined;
    return textOnly(await rawGit(ctx.dir, ["cat-file", "blob", spec]));
  } catch {
    return undefined;
  }
}

export async function readWorkingFile(ctx: ClientContext, path: string): Promise<string | undefined> {
  const full = join(ctx.dir, path);
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > DIFF_SOURCE_MAX_BYTES) return undefined;
    return textOnly(await readFile(full, "utf8"));
  } catch {
    return undefined;
  }
}

export async function workingDiffSources(
  ctx: ClientContext,
  path: string,
  how: { untracked: boolean; renamed: boolean },
): Promise<DiffSources> {
  const [oldText, newText] = await Promise.all([
    how.untracked ? Promise.resolve(undefined) : readRevisionFile(ctx, how.renamed ? "" : "HEAD", path),
    readWorkingFile(ctx, path),
  ]);
  return { old: oldText, new: newText };
}

export async function commitDiffSources(
  ctx: ClientContext,
  file: CommittedFileChange,
  oldRev: string,
  newRev: string,
): Promise<DiffSources> {
  const moved = file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied;
  const oldPath = moved ? file.status.oldPath : file.path;
  const [oldText, newText] = await Promise.all([
    readRevisionFile(ctx, oldRev, oldPath),
    readRevisionFile(ctx, newRev, file.path),
  ]);
  return { old: oldText, new: newText };
}
```

Confirm `CommittedFileChange` and `AppFileStatusKind` are imported from the same module `history.ts` uses; copy its import line if the path differs.

`staging.ts` `getStagingDiff(ctx, path, opts: DiffReadOpts = {})`: after the `kind !== "text"` early return and hunk parse:

```ts
  const sources = opts.withSources ? await workingDiffSources(ctx, path, { untracked, renamed }) : undefined;
  return { path, kind: "text", untracked, hunks, ...(sources ? { sources } : {}) };
```

`history.ts`: `getCommitDiff(ctx, file, commitish, opts: DiffReadOpts = {})`:

```ts
  const diff = buildCommitDiff(stdout, file);
  if (!opts.withSources || diff.kind !== "text") return diff;
  return { ...diff, sources: await commitDiffSources(ctx, file, `${commitish}^`, commitish) };
```

`getCommitRangeDiff(ctx, file, commits, useNullTreeSHA = false, opts: DiffReadOpts = {})`: same shape with `oldestCommitRef` and `latestCommit`; the recursive retry passes `opts` through.

`client.ts`: `stagingDiff: (path, opts) => getStagingDiff(ctx, path, opts)`, `commitDiff: (file, sha, opts) => getCommitDiff(ctx, file, sha, opts)`, `commitRangeDiff: (file, shas, opts) => getCommitRangeDiff(ctx, file, shas, false, opts)`.

- [ ] **Step 4:** Run `bun test packages/git-core`; expect PASS (including `client-shape.test.ts`).
- [ ] **Step 5:** Commit: `git-core: read old/new file sources beside a displayed diff`

---

### Task 7: Driver sends sources

**Files:**
- Modify: `lib/ui/protocol.ts` (`MissionDiffModel`)
- Modify: `lib/mission/model.ts` (`buildDiffModel`, text branch)
- Modify: `lib/mission/driver.ts:596,601,619,624` (display fetches only)
- Modify: `lib/mission/history.ts:228-229`, `lib/mission/stash.ts:132`
- Test: `lib/mission/__tests__/model.test.ts`, `lib/mission/__tests__/driver.test.ts`

**Interfaces:**
- Consumes: `StagingDiff.sources`, `DiffReadOpts` (Task 6)
- Produces: `MissionDiffModel.oldSource?: string`, `MissionDiffModel.newSource?: string` (decoded by Task 5's Go fields)

- [ ] **Step 1: Write the failing tests**

`model.test.ts`, inside the existing `describe("oversized diff gate", ...)` block (it already defines `bigStagingDiff(lineCount)`):

```ts
  function withSources(diff: StagingDiff, sources: StagingDiff["sources"]): StagingDiff {
    return { ...diff, sources };
  }

  test("a text diff carries its sources; a missing side stays absent", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: withSources(bigStagingDiff(3), { old: "a\n", new: undefined }),
      }),
    );
    expect(model.diff.kind).toBe("text");
    expect(model.diff.oldSource).toBe("a\n");
    expect("newSource" in model.diff).toBe(false);
  });

  test("an oversized diff never carries sources", () => {
    const model = buildModel(
      baseInput({
        state: { selectedPath: "big.txt" },
        snapshot: { files: [changedFile({ path: "big.txt", staged: true, unstaged: false })] },
        stagingDiff: withSources(bigStagingDiff(3001), { old: "a", new: "b" }),
      }),
    );
    expect(model.diff.kind).toBe("oversized");
    expect(model.diff.oldSource).toBeUndefined();
    expect(model.diff.newSource).toBeUndefined();
  });
```

`driver.test.ts`: add `stagingDiffOpts: (DiffReadOpts | undefined)[]` to `FakeClientCalls`, initialise it to `[]` in `makeFakeClient`, and change the fake to record opts:

```ts
    stagingDiff: async (path: string, opts?: DiffReadOpts) => {
      calls.stagingDiff.push(path);
      calls.stagingDiffOpts.push(opts);
      return overrides.stagingDiff ? overrides.stagingDiff(path) : oneHunkDiff(path);
    },
```

(import `DiffReadOpts` beside the file's existing git-core type imports), then add to `describe("MissionDriver: staging (selection-only, ratified 2026-09-21)", ...)`:

```ts
  test("the displayed diff is fetched with sources; the stage handler's fetch is not", async () => {
    const client = makeFakeClient({
      snapshot: async () => baseSnapshot({ clean: false, files: [{ path: "a.txt", kind: "modified", staged: false, unstaged: true }] }),
    });
    const session = new FakeSession([
      { t: "intent", name: "mission:stage", payload: { path: "a.txt", mode: "line", selIdx: 1 } },
      { t: "intent", name: "quit" },
    ]);
    await new MissionDriver(baseDeps({ session, client }), START).run();

    expect(client.calls.stagingDiffOpts[0]).toEqual({ withSources: true });
    expect(client.calls.stagingDiffOpts).toContain(undefined);
  });
```

- [ ] **Step 2:** Run `bun test lib/mission`; expect FAIL.

- [ ] **Step 3: Implement**

`protocol.ts`, inside `MissionDiffModel`:

```ts
  /** The whole old-side file, when readable and under the size cap. */
  oldSource?: string;
  /** The whole new-side file, when readable and under the size cap. */
  newSource?: string;
```

`model.ts`, the final `return` of `buildDiffModel`:

```ts
  const sources = stagingDiff.sources;
  return {
    path,
    status,
    kind: "text",
    stats: `+${addCount} -${delCount}`,
    lang: langFor(path),
    lines,
    readOnly,
    ...(sources?.old !== undefined ? { oldSource: sources.old } : {}),
    ...(sources?.new !== undefined ? { newSource: sources.new } : {}),
  };
```

Display fetches pass `{ withSources: true }`: `driver.ts` lines 596, 601, 619, 624 (`client.stagingDiff(path, { withSources: true })`); `history.ts` 228-229 (`commitRangeDiff(file, this.orderedSelection(), { withSources: true })`, `commitDiff(file, this.selection[0]!, { withSources: true })`); `stash.ts` 132. Leave the stage/discard fetches at `driver.ts` 851, 898, 1025 unchanged.

- [ ] **Step 4:** Run `bun run test`; expect PASS (the shared fixtures in `ui/fixtures/` need no change: both fields are optional).
- [ ] **Step 5:** Commit: `mission: send whole-file sources with the displayed diff`

---

### Task 8: Soft wrap

**Files:**
- Create: `ui/internal/views/mission/diff_wrap.go`
- Create: `ui/internal/views/mission/diff_wrap_test.go`
- Modify: `ui/internal/views/picker/scroll.go` (export `Scrolloff`)
- Modify: `ui/internal/views/mission/diff.go` (`renderDiffRows`, `renderDiffLines`)
- Modify: `ui/internal/views/mission/mission.go` (`diffHit`, `Mission` struct: `diffRowsCache diffRowIndex`)

**Interfaces:**
- Consumes: `renderDiffRows`, `span`, `spansText` (Tasks 3-5)
- Produces:
  - `picker.Scrolloff` (exported alias of `scrolloff`)
  - `func wrapSpans(spans []span, width int) [][]span`: at least one row; row texts concatenated equal the input text minus the whitespace `ansi.Wrap` drops at breaks
  - `type diffRowIndex struct { key *DiffLine; n, width int; start []int }` with `start[i]` = first screen row of line i and `start[n]` = total rows
  - `func (m *Mission) diffRows(textW int) *diffRowIndex`
  - `func (ix *diffRowIndex) lineAt(row int) int`

- [ ] **Step 1: Write the failing tests** (`diff_wrap_test.go`)

```go
package mission

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func TestWrapSpansKeepsAStyleAcrossTheBreak(t *testing.T) {
	str := tokStyle{fg: theme.Mint}
	rows := wrapSpans([]span{{text: "x := "}, {text: `"a long string literal"`, style: str}}, 12)
	if len(rows) < 2 {
		t.Fatalf("expected a wrap, got %d rows", len(rows))
	}
	last := rows[len(rows)-1]
	if !sameColor(last[len(last)-1].style.fg, theme.Mint) {
		t.Fatalf("the literal's tail lost its colour: %+v", last)
	}
	var joined strings.Builder
	for _, r := range rows {
		joined.WriteString(spansText(r))
	}
	if strings.ReplaceAll(joined.String(), " ", "") != strings.ReplaceAll(`x := "a long string literal"`, " ", "") {
		t.Fatalf("characters lost or duplicated: %q", joined.String())
	}
}

func TestWrapSpansShortLineIsOneRow(t *testing.T) {
	if rows := wrapSpans([]span{{text: "short"}}, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
}

func TestWrapSpansEmptyLineIsOneRow(t *testing.T) {
	if rows := wrapSpans(nil, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
}

func wrapFixture() *Mission {
	m := newTestMission()
	m.model.Diff = DiffModel{Kind: "text", Path: "a.md", Lines: []DiffLine{
		{Kind: "hunk", Text: "@@ -1 +1,2 @@"},
		{Kind: "add", NewNo: 1, Text: strings.Repeat("word ", 30)},
		{Kind: "add", NewNo: 2, Text: "tail"},
	}}
	return m
}

func TestWrappedLineRendersContinuationRowsOnItsTint(t *testing.T) {
	m := wrapFixture()
	rows := strings.Split(m.renderDiffLines(50, 10), "\n")
	tailRow := -1
	for i, r := range rows {
		if strings.Contains(ansi.Strip(r), "tail") {
			tailRow = i
		}
	}
	if tailRow < 3 {
		t.Fatalf("the long line did not wrap onto extra rows (tail on row %d):\n%s", tailRow, ansi.Strip(strings.Join(rows, "\n")))
	}
	if !strings.Contains(rows[2], bgSGR(theme.DiffAddGutterBg)) || !strings.Contains(rows[2], bgSGR(theme.DiffAddBg)) {
		t.Fatalf("continuation row is not on its tints:\n%q", rows[2])
	}
}

// renderDiffLines(w) and diffHit(paneW) both reserve one thumb column, so
// they share a layout only when called with the same width, as the pane does.
func TestDiffHitOnAContinuationRowHitsItsLine(t *testing.T) {
	m := wrapFixture()
	m.renderDiffLines(52, 10)
	for _, x := range []int{0, 20} {
		if h := m.diffHit(x, 3, 52); h.idx != 1 {
			t.Fatalf("x=%d on row 2 of line 1 hit idx %d", x, h.idx)
		}
	}
	if h := m.diffHit(20, 6, 52); h.idx != 2 {
		t.Fatalf("the row after the wrapped line hit idx %d, want 2", h.idx)
	}
}

func TestCursorLineIsKeptWholeInView(t *testing.T) {
	m := wrapFixture()
	m.model.Diff.Lines[1].Text = strings.Repeat("word ", 12)
	m.diffCursor = 1
	rows := strings.Split(ansi.Strip(m.renderDiffLines(50, 2)), "\n")
	if strings.Contains(rows[0], "@@") || !strings.Contains(rows[0], " 1 + word") || !strings.Contains(rows[1], "word") {
		t.Fatalf("both rows of the cursor line should fill the pane:\n%s", strings.Join(rows, "\n"))
	}
}

func TestCursorLineTallerThanThePaneKeepsItsFirstRowOnTop(t *testing.T) {
	m := wrapFixture()
	m.model.Diff.Lines[1].Text = strings.Repeat("word ", 400)
	m.diffCursor = 1
	rows := strings.Split(ansi.Strip(m.renderDiffLines(30, 3)), "\n")
	if !strings.Contains(rows[0], " 1 + word") {
		t.Fatalf("first row of the cursor line is not on top:\n%s", strings.Join(rows, "\n"))
	}
	m.moveDiffCursor(1)
	_ = m.renderDiffLines(30, 3)
}
```

Row arithmetic for these fixtures (`diffHit` treats `y == 0` as the header, so body row r is `y = r + 1`): at pane width 52 the text width is `52-1-9-3 = 39`, which fits 8 of the 30 `"word "` repeats per row, so line 1 spans rows 1-4 and `tail` is row 5 (`y = 6`). At width 50 (text width 37, 7 per row) line 1 spans rows 1-5. With 12 repeats and width 50, line 1 spans exactly 2 rows.

- [ ] **Step 2:** Run `cd ui && go test ./internal/views/mission/ -run 'Wrap|Continuation|TallCursor|TallerThan'`; expect compile failure.

- [ ] **Step 3: Implement**

`picker/scroll.go`: `const Scrolloff = scrolloff` with the comment `// Scrolloff is the cursor margin every Viewport caller keeps.`

`diff_wrap.go`:

```go
package mission

import (
	"sort"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// wrapSpans breaks a line at ansi.Wrap's word boundaries, computed on the
// plain text: ansi.Wrap on painted text neither reopens a style on the next
// row nor keeps the whitespace it breaks at, so the spans are sliced at the
// break points instead.
func wrapSpans(spans []span, width int) [][]span {
	plain := spansText(spans)
	if width < 1 || ansi.StringWidth(plain) <= width {
		return [][]span{spans}
	}
	rows := strings.Split(ansi.Wrap(plain, width, ""), "\n")
	out := make([][]span, 0, len(rows))
	pos := 0
	for _, r := range rows {
		for pos < len(plain) && !strings.HasPrefix(plain[pos:], r) && plain[pos] == ' ' {
			pos++
		}
		out = append(out, sliceSpans(spans, pos, pos+len(r)))
		pos += len(r)
	}
	return out
}

func sliceSpans(spans []span, from, to int) []span {
	var out []span
	at := 0
	for _, s := range spans {
		lo, hi := at, at+len(s.text)
		at = hi
		if hi <= from || lo >= to {
			continue
		}
		a, b := max(from, lo)-lo, min(to, hi)-lo
		out = append(out, span{text: s.text[a:b], style: s.style})
	}
	return out
}

type diffRowIndex struct {
	key      *DiffLine
	n, width int
	start    []int
}

// diffRows is the screen-row layout of the current diff at textW, shared by
// the renderer, the viewport and diffHit so a click always maps to what was
// painted.
func (m *Mission) diffRows(textW int) *diffRowIndex {
	lines := m.model.Diff.Lines
	ix := &m.diffRowsCache
	if len(lines) > 0 && ix.key == &lines[0] && ix.n == len(lines) && ix.width == textW {
		return ix
	}
	ix.start = make([]int, len(lines)+1)
	for i, l := range lines {
		rows := 1
		if l.Kind != "hunk" {
			rows = len(wrapSpans([]span{{text: l.Text}}, textW))
		}
		ix.start[i+1] = ix.start[i] + rows
	}
	ix.n, ix.width = len(lines), textW
	ix.key = nil
	if len(lines) > 0 {
		ix.key = &lines[0]
	}
	return ix
}

func (ix *diffRowIndex) total() int { return ix.start[ix.n] }

func (ix *diffRowIndex) lineAt(row int) int {
	return sort.Search(ix.n, func(i int) bool { return ix.start[i+1] > row })
}
```

The row count is taken from the plain text and the renderer wraps the highlighted spans of that same text, so both agree by construction (spans' text equals `DiffLine.Text` by Task 5's match check or by `lineSpans`).

`diff.go` `renderDiffRows`: replace the single-row text with wrapped rows:

```go
	textW := max(width-diffGutterWidth-diffMarkWidth, 0)
	wrapped := wrapSpans(spans, textW)
	// A selected wrapped line keeps its pink bar down every row.
	blankGutter := barStyle.Render(bar) + gOn.Render(strings.Repeat(" ", diffNumWidth*2))
	blankMark := on.Render(strings.Repeat(" ", diffMarkWidth))
	out := make([]string, len(wrapped))
	for r, row := range wrapped {
		g, mk := gutter, markCell
		if r > 0 {
			g, mk = blankGutter, blankMark
		}
		text := clipOn(paintSpans(row, base, rowBg), textW, on)
		out[r] = on.Width(width).Render(clipOn(g+mk+text, width, on))
	}
	return out
```

`diff.go` `renderDiffLines`: rows instead of lines.

```go
	contentW := max(width-1, 0)
	ix := m.diffRows(max(contentW-diffGutterWidth-diffMarkWidth, 0))
	total := ix.total()
	cursorRow, extra := 0, 0
	if len(lines) > 0 {
		cursorRow = ix.start[m.diffCursor]
		extra = ix.start[m.diffCursor+1] - cursorRow - 1
	}
	top, _ := picker.ViewportAround(cursorRow, m.diffTop, total, height, height, 0, picker.Scrolloff, picker.Scrolloff+extra)
	m.diffTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, min(height, total), total)
	hl := m.diffHL.forDiff(m.model.Diff)

	rows := make([]string, 0, height)
	for li := ix.lineAt(top); li < len(lines) && len(rows) < height; li++ {
		spans := lineSpans(m.model.Diff.Lang, lines[li])
		if hl != nil && hl[li] != nil {
			spans = hl[li]
		}
		hover := li == m.hoverDiffLine
		painted := renderDiffRows(m.model.Diff, lines[li], spans, contentW, hover, hover && m.hoverGutter)
		skip := 0
		if li == ix.lineAt(top) {
			skip = top - ix.start[li]
		}
		for _, r := range painted[skip:] {
			if len(rows) == height {
				break
			}
			rows = append(rows, r)
		}
	}
	blank := lipgloss.NewStyle().Width(contentW).Background(theme.Bg).Render("")
	for len(rows) < height {
		rows = append(rows, blank)
	}
	for i := range rows {
		rows[i] += picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
	}
	return strings.Join(rows, "\n")
```

When the cursor line alone is taller than the pane, `ViewportAround`'s `after` margin exceeds `h`; it shrinks margins symmetrically (see `placeTopAround`), which puts the cursor row at the top. If the fifth Review Focus test shows otherwise, clamp `extra` to `height-1` before the call.

`mission.go` `diffHit`: map through the index.

```go
	lines := m.model.Diff.Lines
	contentW := paneW - 1
	if diffX < 0 || diffX >= contentW || len(lines) == 0 {
		return hit{}
	}
	ix := m.diffRows(max(contentW-diffGutterWidth-diffMarkWidth, 0))
	row := m.diffTop + (y - 1)
	if row < 0 || row >= ix.total() {
		return hit{}
	}
	idx := ix.lineAt(row)
```

(keep the existing read-only, hunk and gutter branches after this.)

Add `diffRowsCache diffRowIndex` to the `Mission` struct beside `diffHL`.

- [ ] **Step 4:** Run `cd ui && go test ./internal/...`; expect PASS, including the existing `history_test.go` diffHit tests and `render_test.go:3156`.
- [ ] **Step 5:** `bun run ui:build`, commit: `rt-ui mission: soft-wrap long diff lines`

---

### Task 9: Verification (controller-owned)

- [ ] **Step 1:** `bun run test:all` from the worktree root; all three suites green. Read failures in full; fix in the owning task's files and recommit.
- [ ] **Step 2:** In the worktree, run glitter from source against a repo with a markdown change and a Go change: `RT_LAUNCH_CWD=<repo> bun run cli.ts glitter` in a real terminal (`ui/dist/rt-ui` from this worktree is picked up because the source checkout outranks the bundle).
- [ ] **Step 3:** Capture the diff pane at a narrow (~90 col) and wide (~200 col) terminal, including a wrapped line, a hovered row, a selected row, a History diff and a Stash diff. Say plainly what looks wrong before calling it done.
- [ ] **Step 4:** Show Matt the captures next to the `DiffStates` board and his GitHub Desktop screenshot.
- [ ] **Step 5:** Push the branch and open a PR to `main`; wait for CodeRabbit and CI per the repo's PR rules.
