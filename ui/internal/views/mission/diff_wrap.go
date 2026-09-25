package mission

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
)

// controlSpaces rewrites the whitespace ansi.Wrap and lipgloss measure
// differently. ansi.Wrap counts each of these as one cell, but lipgloss
// paints a tab as four spaces (its default tab width), so a tabbed row
// painted wider than it measured and lost its tail to the clip; and it
// passes \r, \v and \f through raw at zero width, where the terminal moves
// its cursor instead (a \r would repaint the row over its own gutter).
var controlSpaces = strings.NewReplacer("\t", "    ", "\r", " ", "\v", " ", "\f", " ")

// wrapSpans breaks a line at ansi.Wrap's word boundaries, computed on the
// plain text: ansi.Wrap on painted text neither reopens a style on the next
// row nor keeps the whitespace it breaks at, so the spans are sliced at the
// break points instead.
func wrapSpans(spans []span, width int) [][]span {
	spans = normalizeSpaces(spans)
	plain := spansText(spans)
	if width < 1 || ansi.StringWidth(plain) <= width {
		return [][]span{spans}
	}
	rows := strings.Split(ansi.Wrap(plain, width, ""), "\n")
	out := make([][]span, 0, len(rows))
	pos := 0
	for _, r := range rows {
		// Indentation wider than the whole row comes back as an empty
		// first row, which would paint the line numbers beside nothing.
		if r == "" {
			continue
		}
		// Every row is a byte-exact substring of plain; the only bytes
		// between two rows are the whitespace run ansi.Wrap dropped, which
		// can be any Unicode space (an ideographic space included).
		for pos < len(plain) && !strings.HasPrefix(plain[pos:], r) {
			c, size := utf8.DecodeRuneInString(plain[pos:])
			if !unicode.IsSpace(c) {
				break
			}
			pos += size
		}
		out = append(out, sliceSpans(spans, pos, pos+len(r)))
		pos += len(r)
	}
	if len(out) == 0 {
		return [][]span{nil}
	}
	return out
}

func normalizeSpaces(spans []span) []span {
	if !strings.ContainsAny(spansText(spans), "\t\r\v\f") {
		return spans
	}
	out := make([]span, len(spans))
	for i, s := range spans {
		out[i] = span{text: controlSpaces.Replace(s.text), style: s.style}
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
// painted. It counts from DiffLine.Text less a CRLF ending, the exact text
// diffLineSpans guarantees every painted span list carries. Like forDiff
// it keys on the decoded Lines backing array, which each model push
// replaces.
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
			rows = len(wrapSpans([]span{{text: strings.TrimSuffix(l.Text, "\r")}}, textW))
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
