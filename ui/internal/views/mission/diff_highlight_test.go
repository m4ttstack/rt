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
