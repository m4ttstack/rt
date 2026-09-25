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
// spans are sliced by byte, so a tab (painted as spaces), wide runes and an
// ideographic space at a break are where the two could drift apart.
func TestWrapSpansTabsWideRunesAndUnicodeSpacesStayAligned(t *testing.T) {
	kw := tokStyle{fg: theme.Lav}
	in := []span{
		{text: "\tif", style: kw},
		{text: " x := \"漢字かな漢字かな漢字　カタカナ\tabc 한국어 텍스트\" // 注释 done"},
	}
	want := dropSpace(spansText(in))
	for width := 3; width <= 40; width++ {
		rows := wrapSpans(in, width)
		var joined strings.Builder
		for r, row := range rows {
			text := spansText(row)
			if strings.Contains(text, "\t") {
				t.Fatalf("width %d row %d kept a tab the painter would widen: %q", width, r, text)
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
	}}
	for _, width := range []int{20, 31, 44, 60} {
		contentW := width - 1
		ix := m.diffRows(max(contentW-diffGutterWidth-diffMarkWidth, 0))
		hl := m.diffHL.forDiff(m.model.Diff)
		var want []string
		for i, l := range m.model.Diff.Lines {
			spans := lineSpans(m.model.Diff.Lang, l)
			if hl != nil && hl[i] != nil {
				spans = hl[i]
			}
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
