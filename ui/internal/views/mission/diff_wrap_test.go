package mission

import (
	"strings"
	"testing"
	"unicode"

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
	if rows := wrapSpans([]span{{text: "\t\t\t      "}}, 5); len(rows) != 1 {
		t.Fatalf("a blank line wider than the row got %d rows", len(rows))
	}
}

func TestWrapSpansShortLineNeverPaintsARawCarriageReturn(t *testing.T) {
	rows := wrapSpans([]span{{text: "a\rb"}}, 40)
	if len(rows) != 1 || spansText(rows[0]) != "a b" {
		t.Fatalf("a lone \\r should paint as one space cell: %+v", rows)
	}
}

func TestWrapSpansIndentWiderThanTheRowPaintsNoBlankRow(t *testing.T) {
	rows := wrapSpans([]span{{text: "\t\t\treturn nil"}}, 8)
	if len(rows) == 0 || spansText(rows[0]) != "return" {
		t.Fatalf("the first row should carry the first word: %+v", rows)
	}
}

func dropSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// ansi.Wrap measures in cells and breaks at any Unicode space while the
// spans are sliced by byte, so a tab (painted as spaces), a lone \r or \v
// (painted raw, zero cells, but moving the terminal's cursor), wide runes
// and an ideographic space at a break are where the two could drift apart.
func TestWrapSpansTabsWideRunesAndUnicodeSpacesStayAligned(t *testing.T) {
	kw := tokStyle{fg: theme.Lav}
	in := []span{
		{text: "\tif", style: kw},
		{text: " x := \"漢字かな漢字かな漢字　カタカナ\tabc 한국어\r텍스트\" //\v注释 done"},
	}
	want := dropSpace(spansText(in))
	for width := 3; width <= 40; width++ {
		rows := wrapSpans(in, width)
		var joined strings.Builder
		for r, row := range rows {
			text := spansText(row)
			if strings.ContainsAny(text, "\t\r\v\f") {
				t.Fatalf("width %d row %d kept a control space the painter mismeasures: %q", width, r, text)
			}
			if w := ansi.StringWidth(text); w > width {
				t.Fatalf("width %d row %d is %d cells, so the clip would drop text: %q", width, r, w, text)
			}
			joined.WriteString(text)
		}
		if got := dropSpace(joined.String()); got != want {
			t.Fatalf("width %d lost or duplicated text:\n got %q\nwant %q", width, got, want)
		}
		if !sameColor(rows[0][0].style.fg, theme.Lav) {
			t.Fatalf("width %d: the keyword lost its colour: %+v", width, rows[0])
		}
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

// tallFixture puts the cursor on a line wrapping to far more rows than a
// 3-row pane, rendered once so the row index and pane height are known.
func tallFixture(t *testing.T) (m *Mission, lo, hi int) {
	t.Helper()
	m = wrapFixture()
	m.model.Diff.Lines[1].Text = strings.Repeat("word ", 60)
	m.diffCursor = 1
	m.renderDiffLines(tallW, tallH)
	ix := m.diffRows(tallW - 1 - diffGutterWidth - diffMarkWidth)
	lo, hi = ix.start[1], ix.start[2]-tallH
	if hi-lo < 3 {
		t.Fatalf("fixture line is not tall enough: rows [%d,%d)", ix.start[1], ix.start[2])
	}
	return m, lo, hi
}

const tallW, tallH = 30, 3

func TestCursorLineTallerThanThePaneKeepsItsFirstRowOnTop(t *testing.T) {
	m, lo, _ := tallFixture(t)
	rows := strings.Split(ansi.Strip(m.renderDiffLines(tallW, tallH)), "\n")
	if m.diffTop != lo || !strings.Contains(rows[0], " 1 + word") {
		t.Fatalf("first row of the cursor line is not on top:\n%s", strings.Join(rows, "\n"))
	}
}

func TestScrollingDownReadsATallLineRowByRowThenMovesOn(t *testing.T) {
	m, lo, hi := tallFixture(t)
	for want := lo + 1; want <= hi; want++ {
		m.moveDiffCursor(1)
		m.renderDiffLines(tallW, tallH)
		if m.diffCursor != 1 || m.diffTop != want {
			t.Fatalf("step to row %d: cursor %d top %d", want, m.diffCursor, m.diffTop)
		}
	}
	m.moveDiffCursor(1)
	rows := strings.Split(ansi.Strip(m.renderDiffLines(tallW, tallH)), "\n")
	if m.diffCursor != 2 || !strings.Contains(rows[len(rows)-1], " 2 + tail") {
		t.Fatalf("past the tall line's last row the cursor should reach tail, got cursor %d:\n%s", m.diffCursor, strings.Join(rows, "\n"))
	}
}

func TestScrollingUpIntoATallLineStartsAtItsBottom(t *testing.T) {
	m, lo, hi := tallFixture(t)
	m.diffCursor = 2
	m.renderDiffLines(tallW, tallH)
	m.moveDiffCursor(-1)
	m.renderDiffLines(tallW, tallH)
	if m.diffCursor != 1 || m.diffTop != hi {
		t.Fatalf("entering from below: cursor %d top %d, want 1 and %d", m.diffCursor, m.diffTop, hi)
	}
	for want := hi - 1; want >= lo; want-- {
		m.moveDiffCursor(-1)
		m.renderDiffLines(tallW, tallH)
		if m.diffCursor != 1 || m.diffTop != want {
			t.Fatalf("step up to row %d: cursor %d top %d", want, m.diffCursor, m.diffTop)
		}
	}
	m.moveDiffCursor(-1)
	if m.diffCursor != 0 {
		t.Fatalf("above the tall line's first row the cursor should reach the hunk, got %d", m.diffCursor)
	}
}

func TestAWheelTickSpillsPastTheTallLineOntoTheNext(t *testing.T) {
	m, lo, hi := tallFixture(t)
	m.setCursorRowOff(hi - 2 - lo)
	m.moveDiffCursor(2)
	m.renderDiffLines(tallW, tallH)
	if m.diffCursor != 1 || m.diffTop != hi {
		t.Fatalf("two steps two rows from the end should land on the last row, got cursor %d top %d", m.diffCursor, m.diffTop)
	}
	m.setCursorRowOff(hi - 1 - lo)
	m.moveDiffCursor(2)
	if m.diffCursor != 2 {
		t.Fatalf("one step to the last row and one onto tail, got cursor %d top %d", m.diffCursor, m.diffTop)
	}
}

// pushLines stands in for a model push: a fresh Lines backing array, as
// every decode makes, with the cursor line's stage state flipped.
func pushLines(m *Mission, edit func([]DiffLine)) {
	lines := append([]DiffLine(nil), m.model.Diff.Lines...)
	lines[1].Selected = !lines[1].Selected
	if edit != nil {
		edit(lines)
	}
	m.model.Diff.Lines = lines
}

func TestStagingATallLineKeepsTheRowsBeingRead(t *testing.T) {
	m, lo, _ := tallFixture(t)
	m.moveDiffCursor(2)
	pushLines(m, nil)
	m.renderDiffLines(tallW, tallH)
	if m.diffTop != lo+2 {
		t.Fatalf("top %d after the push, want %d", m.diffTop, lo+2)
	}
}

func TestADifferentTallLineUnderTheCursorOpensAtItsTop(t *testing.T) {
	m, lo, _ := tallFixture(t)
	m.moveDiffCursor(2)
	pushLines(m, func(lines []DiffLine) { lines[1].Text = strings.Repeat("other ", 50) })
	m.renderDiffLines(tallW, tallH)
	if m.diffTop != lo {
		t.Fatalf("a new line under the cursor opened at top %d, want its first row %d", m.diffTop, lo)
	}
}

// The line above the tall one wraps too, so a resize moves where the tall
// line starts.
func TestAResizeKeepsThePlaceWithinATallLine(t *testing.T) {
	m := wrapFixture()
	m.model.Diff.Lines = []DiffLine{
		{Kind: "context", OldNo: 1, NewNo: 1, SelIdx: -1, Text: strings.Repeat("ctx ", 20)},
		{Kind: "add", NewNo: 2, Text: strings.Repeat("word ", 60)},
		{Kind: "add", NewNo: 3, Text: "tail"},
	}
	m.diffCursor = 1
	m.renderDiffLines(tallW, tallH)
	m.moveDiffCursor(2)
	const wider = tallW + 10
	m.renderDiffLines(wider, tallH)
	ix := m.diffRows(wider - 1 - diffGutterWidth - diffMarkWidth)
	if got := m.diffTop - ix.start[1]; got != 2 {
		t.Fatalf("offset into the line after widening is %d rows, want 2", got)
	}
}

func TestCursorWalkKeepsEveryWrappedLineWholeInView(t *testing.T) {
	m := newTestMission()
	var lines []DiffLine
	for i := 0; i < 40; i++ {
		text := "short"
		if i%5 == 2 {
			text = strings.Repeat("word ", 7*(1+i%3))
		}
		lines = append(lines, DiffLine{Kind: "context", OldNo: i + 1, NewNo: i + 1, SelIdx: -1, Text: text})
	}
	m.model.Diff = DiffModel{Kind: "text", Path: "a.txt", Lines: lines}
	const width, height = 50, 8
	check := func(step string) {
		m.renderDiffLines(width, height)
		ix := m.diffRows(width - 1 - diffGutterWidth - diffMarkWidth)
		first, last := ix.start[m.diffCursor], ix.start[m.diffCursor+1]-1
		if first < m.diffTop || last >= m.diffTop+height {
			t.Fatalf("%s: cursor %d rows [%d,%d] outside the window [%d,%d)", step, m.diffCursor, first, last, m.diffTop, m.diffTop+height)
		}
	}
	for i := 0; i < len(lines); i++ {
		m.diffCursor = i
		check("down")
	}
	for i := len(lines) - 1; i >= 0; i-- {
		m.diffCursor = i
		check("up")
	}
}

// The row index counts from DiffLine.Text while the renderer wraps the
// highlighted spans, so any disagreement shows up as a click landing on a
// different line than the one painted under it.
func TestDiffRowIndexMatchesThePaintedRows(t *testing.T) {
	m := newTestMission()
	m.model.Diff = DiffModel{Kind: "text", Path: "a.go", Lang: "go", Lines: []DiffLine{
		{Kind: "hunk", Text: "@@ -1,4 +1,4 @@ func main() { a very long hunk header that must stay on one row }"},
		{Kind: "context", OldNo: 1, NewNo: 1, SelIdx: -1, Text: "\t\tif err := doSomething(ctx, \"漢字かな漢字かな\"); err != nil { return err }"},
		{Kind: "del", OldNo: 2, SelIdx: 0, Text: "\treturn fmt.Errorf(\"wrapping %w with a longer message\", err)\r"},
		{Kind: "add", NewNo: 2, SelIdx: 1, Text: "\treturn fmt.Errorf(\"wrapping　%w　with a longer message\", err)"},
		{Kind: "add", NewNo: 3, SelIdx: 2, Text: ""},
		{Kind: "add", NewNo: 4, SelIdx: 3, Text: "x := 1\r" + strings.Repeat("yy ", 40)},
		{Kind: "add", NewNo: 5, SelIdx: 4, Text: "y := 2"},
	}}
	for _, width := range []int{20, 31, 44, 60} {
		contentW := width - 1
		ix := m.diffRows(max(contentW-diffGutterWidth-diffMarkWidth, 0))
		hl := m.diffHL.forDiff(m.model.Diff)
		var want []string
		for i, l := range m.model.Diff.Lines {
			spans := diffLineSpans(m.model.Diff.Lang, hl, i, l)
			rows := renderDiffRows(m.model.Diff, l, spans, contentW, false, false)
			if n := ix.start[i+1] - ix.start[i]; len(rows) != n {
				t.Fatalf("width %d line %d paints %d rows, the index says %d", width, i, len(rows), n)
			}
			for _, r := range rows {
				want = append(want, ansi.Strip(r))
			}
		}
		m.diffCursor, m.diffTop, m.hoverDiffLine = 0, 0, -1
		painted := strings.Split(ansi.Strip(m.renderDiffLines(width, ix.total())), "\n")
		for row, p := range painted {
			if got := ansi.Truncate(p, contentW, ""); got != want[row] {
				t.Fatalf("width %d row %d painted %q, want %q", width, row, got, want[row])
			}
		}
	}
}

// chroma's EnsureLF turns a lone \r into a line break, so the highlighted
// spans of such a line stop at the \r while the index counts the whole line.
func TestLoneCarriageReturnLineHitsWhatIsPaintedUnderIt(t *testing.T) {
	m := newTestMission()
	m.model.Diff = DiffModel{Kind: "text", Path: "a.go", Lang: "go", Lines: []DiffLine{
		{Kind: "add", NewNo: 1, SelIdx: 0, Text: "x := 1\r" + strings.Repeat("yy ", 40)},
		{Kind: "add", NewNo: 2, SelIdx: 1, Text: "tail"},
	}}
	out := m.renderDiffLines(50, 10)
	if strings.Contains(out, "\r") {
		t.Fatalf("a raw \\r reached the terminal:\n%q", out)
	}
	rows := strings.Split(ansi.Strip(out), "\n")
	if !strings.Contains(rows[0], "x := 1 yy") {
		t.Fatalf("the text after the \\r was dropped:\n%s", strings.Join(rows, "\n"))
	}
	for y, r := range rows {
		if strings.Contains(r, "tail") {
			if h := m.diffHit(20, y+1, 50); h.idx != 1 {
				t.Fatalf("a click on the painted tail row hit idx %d", h.idx)
			}
			return
		}
	}
	t.Fatalf("tail never painted:\n%s", strings.Join(rows, "\n"))
}

// With no sources every line goes through the hunk-block tokenizer, which
// joins a hunk's lines with \n: a lone \r must not split one of them into
// two and hand every later line its neighbour's spans.
func TestHunkBlockLoneCarriageReturnKeepsLaterLinesOnTheirOwnSpans(t *testing.T) {
	d := DiffModel{Kind: "text", Path: "a.go", Lang: "go", Lines: []DiffLine{
		{Kind: "hunk", Text: "@@ -1,2 +1,2 @@"},
		{Kind: "add", NewNo: 1, SelIdx: 0, Text: "a := 1\rb := 2"},
		{Kind: "add", NewNo: 2, SelIdx: 1, Text: `c := "three"`},
	}}
	var h diffHighlighter
	hl := h.forDiff(d)
	for i, l := range d.Lines[1:] {
		if got := spansText(diffLineSpans(d.Lang, hl, i+1, l)); got != strings.TrimSuffix(l.Text, "\r") {
			t.Fatalf("line %d paints %q, want its own text %q", i+1, got, l.Text)
		}
	}
	last := hl[2]
	if len(last) == 0 || spansText(last) != `c := "three"` || !sameColor(last[len(last)-1].style.fg, theme.Mint) {
		t.Fatalf("the line after the \\r lost its own highlighting: %+v", last)
	}
	m := newTestMission()
	m.model.Diff = d
	if out := ansi.Strip(m.renderDiffLines(60, 5)); !strings.Contains(out, `c := "three"`) {
		t.Fatalf("the line after the \\r does not paint its own text:\n%s", out)
	}
}
