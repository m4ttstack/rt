package mission

import (
	"image/color"
	"regexp"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

var sgrColorRe = regexp.MustCompile(`38;2;\d+;\d+;\d+`)

// allowedHighlightSGR is the compiled allowlist these tests pin highlightLine's
// output against: every color chromaStyleTable maps a token to, plus the
// caller's own base (an unmapped token, or plain text, paints flat in base).
func allowedHighlightSGR(base color.Color) map[string]bool {
	allowed := map[string]bool{fgSGR(base): true}
	for _, c := range chromaStyleTable {
		allowed[fgSGR(c)] = true
	}
	return allowed
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
