package mission

import (
	"image/color"
	"regexp"
	"strings"
	"testing"

	"github.com/alecthomas/chroma/v2"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

var sgrColorRe = regexp.MustCompile(`38;2;\d+;\d+;\d+`)

// allowedHighlightSGR is the compiled allowlist these tests pin highlightLine's
// output against: every color chromaStyleTable maps a token to, plus the
// caller's own base (an unmapped token, or plain text, paints flat in base).
func allowedHighlightSGR(base color.Color) map[string]bool {
	allowed := map[string]bool{fgSGR(base): true}
	for _, s := range chromaStyleTable {
		if s.fg != nil {
			allowed[fgSGR(s.fg)] = true
		}
	}
	return allowed
}

func sameColor(a, b color.Color) bool {
	return a != nil && b != nil && theme.Hex(a) == theme.Hex(b)
}

func TestHighlightLineTypeScriptUsesAtLeastTwoThemeAccentsAndNoStrayHex(t *testing.T) {
	const src = `const total = "done"; // 42 items processed`
	out := highlightLine("typescript", src, theme.TextSoft, theme.Bg)
	allowed := allowedHighlightSGR(theme.TextSoft)

	found := map[string]bool{}
	for _, sgr := range sgrColorRe.FindAllString(out, -1) {
		if !allowed[sgr] {
			t.Fatalf("color %q is outside the chroma style table and base:\n%s", sgr, out)
		}
		found[sgr] = true
	}
	if len(found) < 2 {
		t.Fatalf("want at least two distinct theme accents, got %d in:\n%q", len(found), out)
	}
}

func TestHighlightLineEmptyLangReturnsFlatBase(t *testing.T) {
	out := highlightLine("", "plain text, no lexer", theme.Mint, theme.Bg)
	want := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Mint).Render("plain text, no lexer")
	if out != want {
		t.Fatalf("empty lang should render flat base color over bg:\ngot  %q\nwant %q", out, want)
	}
}

func TestHighlightLineUnknownLexerFallsBackToPlain(t *testing.T) {
	out := highlightLine("not-a-real-language", "hello world", theme.TextSoft, theme.Bg)
	if !strings.Contains(out, "hello world") {
		t.Fatalf("unknown lexer should still render the text: %q", out)
	}
}

// TestHighlightLineTokensCarryBackground pins the fix for the diff pane's
// full-frame Bg fill: a token colored by chromaStyleTable must still carry
// bg, not just its own foreground.
func TestHighlightLineTokensCarryBackground(t *testing.T) {
	out := highlightLine("typescript", `const total = 1`, theme.TextSoft, theme.Bg)
	if !strings.Contains(out, bgSGR(theme.Bg)) {
		t.Fatalf("highlighted tokens should carry the row's Bg: %q", out)
	}
}

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
