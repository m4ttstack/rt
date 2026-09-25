// Chroma syntax highlighting for the diff pane's context, add and del lines: a
// lexer picked by Lang, rendered through a chroma.Style built once from the
// theme ramp so no non-theme hex ever reaches the terminal.
package mission

import (
	"image/color"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// tokStyle is a token's paint: nil fg means "paint in the caller's base".
type tokStyle struct {
	fg           color.Color
	bold, italic bool
}

// span is one contiguous run of same-styled text within a line.
type span struct {
	text  string
	style tokStyle
}

// chromaStyleTable is the token-category -> theme role mapping the diff
// pane's highlighting draws from. highlight_test's color allowlist compiles
// from these same values, so a token painted outside this table reads as a
// hex leak the test catches rather than a silent pass.
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

// chromaStyle is built once: chroma.Style.Get resolves a token's
// category/subcategory fallback chain internally, so chromaStyleTable only
// needs one entry per category rt actually distinguishes.
var chromaStyle = buildChromaStyle()

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
