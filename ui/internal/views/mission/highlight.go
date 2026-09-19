// Chroma syntax highlighting for the diff pane's context and add lines: a
// lexer picked by Lang, rendered through a chroma.Style built once from the
// theme ramp so no non-theme hex ever reaches the terminal.
package mission

import (
	"image/color"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// chromaStyleTable is the token-category -> theme role mapping the diff
// pane's highlighting draws from. highlight_test's color allowlist compiles
// from these same values, so a token painted outside this table reads as a
// hex leak the test catches rather than a silent pass.
var chromaStyleTable = map[chroma.TokenType]color.Color{
	chroma.Keyword:       theme.Lav,
	chroma.KeywordType:   theme.Lav,
	chroma.NameFunction:  theme.Cyan,
	chroma.NameClass:     theme.Blue,
	chroma.NameBuiltin:   theme.Blue,
	chroma.LiteralString: theme.Mint,
	chroma.LiteralNumber: theme.Peach,
	chroma.Comment:       theme.Faint,
	chroma.Operator:      theme.TextSoft,
	chroma.Punctuation:   theme.TextSoft,
	chroma.Error:         theme.Coral,
}

// chromaStyle is built once: chroma.Style.Get resolves a token's
// category/subcategory fallback chain internally, so chromaStyleTable only
// needs one entry per category rt actually distinguishes.
var chromaStyle = buildChromaStyle()

func buildChromaStyle() *chroma.Style {
	entries := chroma.StyleEntries{}
	for tt, c := range chromaStyleTable {
		entries[tt] = theme.Hex(c)
	}
	return chroma.MustNewStyle("rt", entries)
}

// highlightLine tokenizes text under lang, rendering each token in its
// chromaStyleTable color or base for one the table has no entry for, over
// bg -- every token needs the row's own background, not just its
// foreground, or the diff pane's Bg fill (mission.go) shows holes wherever
// chroma actually painted a token. An empty lang (no Lang hint from the
// driver) or an unrecognized lexer name both skip tokenization and paint
// text flat in base -- the diff pane's own fallback for a language chroma
// cannot help with.
func highlightLine(lang, text string, base, bg color.Color) string {
	on := lipgloss.NewStyle().Background(bg)
	if lang == "" {
		return on.Foreground(base).Render(text)
	}
	lx := lexers.Get(lang)
	if lx == nil {
		lx = lexers.Fallback
	}
	it, err := lx.Tokenise(nil, text)
	if err != nil {
		return on.Foreground(base).Render(text)
	}
	var out string
	for tok := it(); tok != chroma.EOF; tok = it() {
		col := base
		if entry := chromaStyle.Get(tok.Type); entry.Colour.IsSet() {
			col = lipgloss.Color(entry.Colour.String())
		}
		out += on.Foreground(col).Render(tok.Value)
	}
	return out
}
