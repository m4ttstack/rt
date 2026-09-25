// Package theme is the rt-ui token sheet: lib/tui/palette.ts in Go. Every
// color and glyph rt-ui paints comes from here; nothing crosses the wire.
package theme

import (
	"fmt"
	"image/color"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
)

var (
	Bg       = lipgloss.Color("#161224")
	BgSubtle = lipgloss.Color("#1C162C")
	// TopBarBg is the mission top bar's own rest fill: LIGHTER than Bg.
	// GitHub Desktop separates its toolbar from its content with a large
	// contrast step, but it is a light app with a near-black toolbar, so its
	// step runs down; rt's canvas already sits near-black, so the only
	// direction with room to make the same kind of step is up (2026-09-22
	// correction of an earlier attempt that went darker and merged with the
	// canvas). Scoped to the top bar deliberately -- BgSubtle stays put for
	// the picker's selected-panel strip, the diff staging hint, and the
	// stash strip.
	TopBarBg = lipgloss.Color("#262038")
	Surface  = lipgloss.Color("#221A35")
	HoverBg  = lipgloss.Color("#2F2A4A")
	// TopBarHoverBg is the top bar's own hover fill: HoverBg sits too close
	// to the lightened TopBarBg rest fill to read as a clear step up, so the
	// bar gets its own brighter hover token instead of raising the shared
	// HoverBg other surfaces (picker rows, diff lines) depend on.
	TopBarHoverBg = lipgloss.Color("#363058")
	SelBg         = lipgloss.Color("#37284B")
	WarnBg        = lipgloss.Color("#2A2033")
	Rule          = lipgloss.Color("#2A2340")
	Panel         = lipgloss.Color("#34304E")

	Pink     = lipgloss.Color("#FF6B9D")
	PinkSoft = lipgloss.Color("#FF9EC0")
	Mint     = lipgloss.Color("#62E6A8")
	Coral    = lipgloss.Color("#FF7979")
	Peach    = lipgloss.Color("#FFB77A")
	Cyan     = lipgloss.Color("#5AAAFF")
	Blue     = lipgloss.Color("#6B9DFF")
	Lav      = lipgloss.Color("#BD93F9")

	Text     = lipgloss.Color("#E6E0FF")
	TextSoft = lipgloss.Color("#D2CDEB")
	Dim      = lipgloss.Color("#B4ADD1")
	Dimmer   = lipgloss.Color("#9992B5")
	Faint    = lipgloss.Color("#7F78A0")

	// Keybar roles. The help bar reads as key (accent) · label (text) ·
	// group (lav), the same grammar cswap's footer uses, rather than
	// borrowing the low end of the type ramp: on a neutral terminal ground
	// faint keys sank below legibility. Change the role here, never at a
	// render site.
	KeybarKey   = PinkSoft
	KeybarLabel = TextSoft
	KeybarGroup = Lav

	// Action rows (a picker's button-like rows: "Launch all") wear an
	// accent on glyph, text and cursor bar, over a highlight tinted from
	// that same accent (ActionHighlight), so a row that operates on the
	// list reads as chrome, not as one more entry. Lav is the default
	// accent; a row may name another tone. Pink stays the entry accent.
	ActionFg    = Lav
	ActionSelBg = ActionHighlight(Lav)

	// Meta is quiet text that still carries information: counts, group
	// headers, a breadcrumb's sort suffix, "of N" in a scroll range. Faint
	// is reserved for pure decoration (separators, ellipses, placeholders),
	// the one step allowed to sit under 4.5:1.
	Meta = Dimmer
)

const (
	GlyphRunning = "●"
	GlyphStopped = "○"
	GlyphCrashed = "✗"
	GlyphBar     = "▌"
	GlyphAction  = "▸" // an action row's fallback icon when the caller sets none
	GlyphChevron = "❯"
	GlyphOn      = "◉"
	GlyphMixed   = "◪"
	GlyphDone    = "✓"
	GlyphWarn    = "⚠"
	GlyphBack    = "↩"
	GlyphLock    = "⚿"

	// Sub-cell-height caps (ratified 2026-09-20, "mission commit button
	// gains its half-cell padding"): a board height that quantizes to a
	// fraction of a terminal cell (e.g. 32px / 26px-per-cell = 1.23) has no
	// single-row rendering, so a half-block glyph as FOREGROUND on the
	// surrounding background paints only that row's own half -- the
	// sanctioned way to hit a sub-cell height, not a fourth physical row.
	GlyphHalfBlockLower = "▄" // U+2584: paints a row's bottom half
	GlyphHalfBlockUpper = "▀" // U+2580: paints a row's top half

	// Nerd Font octicons for the top bar's repo/worktree/branch segments,
	// ratified 2026-09-18 (docs/design/mission/README.md): a font without
	// these glyphs patched in shows a fallback box, which is accepted.
	GlyphRepo     = ""
	GlyphWorktree = ""
	GlyphBranch   = ""
	GlyphStash    = "" // nf-oct-stack: the Stashed Changes strip
	GlyphPadlock  = "" // nf-oct-lock: the guarded branch group header
)

var SpinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠣", "⠏"}

// SpinnerInterval is how long each SpinnerFrames frame stays on screen.
const SpinnerInterval = 80 * time.Millisecond

// Spinner is the one frames/interval pair every animated rt-ui spinner runs.
func Spinner() spinner.Spinner {
	return spinner.Spinner{Frames: SpinnerFrames, FPS: SpinnerInterval}
}

// CardWidth caps the prompt card so it reads as a card on a wide terminal
// rather than a stripe across it. The picker card is content-anchored and
// sizes itself independently of this cap.
const CardWidth = 88

// Hex renders a palette color back as #RRGGBB; used by tests and the --version banner.
// actionHighlightBlend is how far an action accent sinks toward Bg to
// become that row's cursor highlight: deep enough to read as a background
// under the accent's own bold text, light enough to still carry its hue.
const actionHighlightBlend = 0.82

// blendToward mixes c toward target by t in [0,1]: t=0 keeps c, t=1 lands on
// target.
func blendToward(c, target color.Color, t float64) color.Color {
	r, g, b, _ := c.RGBA()
	tr, tg, tb, _ := target.RGBA()
	mix := func(v, tv uint32) uint8 {
		return uint8(float64(v>>8) + (float64(tv>>8)-float64(v>>8))*t)
	}
	return color.RGBA{R: mix(r, tr), G: mix(g, tg), B: mix(b, tb), A: 0xFF}
}

// ActionHighlight is the cursor-row background for an action row whose
// accent is c: c blended toward Bg by actionHighlightBlend.
func ActionHighlight(c color.Color) color.Color {
	return blendToward(c, Bg, actionHighlightBlend)
}

// gutterHoverBlend sinks Pink only half-way toward Bg (not
// actionHighlightBlend's near-black 0.82): a hover preview has to still read
// as "about to be pink," not fade into the row background it sits on.
const gutterHoverBlend = 0.5

// GutterHoverBar is the diff gutter's hover-preview stage-bar color: Pink
// blended half-way toward Bg, the boards' faint-pink preview swatch.
var GutterHoverBar = blendToward(Pink, Bg, gutterHoverBlend)

func Hex(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("#%02X%02X%02X", r>>8, g>>8, b>>8)
}

// Huh returns the huh theme that makes its four fields paint with rt's tokens.
// The form base carries the prompt bar edge: a ▌ in the accent color. It has
// to live there because huh renders Group.Base around the group footer alone,
// which would put the edge beside an empty footer instead of beside the
// prompt. The group title is the prompt title and the group description is
// the key legend Go composes.
func Huh() huh.Theme { return themed(Pink) }

// HuhDestructive is the same bar with peach accents: the default-no confirm.
func HuhDestructive() huh.Theme { return themed(Peach) }

// CardFrame is how many columns the bar and its padding occupy. huh sizes
// its groups from the terminal width and knows nothing about the form base
// wrapped around them, so a layout has to hand back this much less.
func CardFrame() int { return themed(Pink).Theme(true).Form.Base.GetHorizontalFrameSize() }

func themed(accent color.Color) huh.Theme {
	return huh.ThemeFunc(func(isDark bool) *huh.Styles {
		s := huh.ThemeBase(isDark)
		base := lipgloss.NewStyle()
		// The prompt block's only chrome: a half-block edge in the accent
		// color. A full box was rejected in the 2026-08-30 chrome pass; the
		// edge never spans the terminal, so a mid-resize reflow has nothing
		// to rewrap.
		s.Form.Base = base.Border(lipgloss.Border{Left: "▌"}, false, false, false, true).BorderForeground(accent).PaddingLeft(1)
		s.Group.Base = base
		s.Group.Title = base.Foreground(accent)
		s.Group.Description = base.Foreground(Faint)
		s.Focused.Base = base
		s.Blurred.Base = base
		s.Focused.Title = base.Foreground(Text).Bold(true)
		s.Blurred.Title = base.Foreground(Dim)
		s.Focused.Description = base.Foreground(Faint)
		s.Blurred.Description = base.Foreground(Faint)
		s.Focused.ErrorMessage = base.Foreground(Coral)
		s.Focused.ErrorIndicator = base.Foreground(Coral)
		s.Focused.SelectSelector = base.Foreground(Pink).SetString(GlyphBar + " ")
		s.Focused.Option = base.Foreground(Text)
		s.Focused.MultiSelectSelector = base.Foreground(Pink).SetString(GlyphBar + " ")
		s.Focused.SelectedOption = base.Foreground(PinkSoft)
		s.Focused.SelectedPrefix = base.Foreground(Mint).SetString(GlyphOn + " ")
		s.Focused.UnselectedOption = base.Foreground(Text)
		s.Focused.UnselectedPrefix = base.Foreground(Faint).SetString(GlyphStopped + " ")
		s.Focused.FocusedButton = base.Foreground(Bg).Background(accent).Bold(true).Padding(0, 1)
		s.Focused.BlurredButton = base.Foreground(Dim).Padding(0, 1)
		s.Focused.TextInput.Cursor = base.Foreground(accent)
		s.Focused.TextInput.Placeholder = base.Foreground(Faint)
		s.Focused.TextInput.Prompt = base.Foreground(accent)
		s.Focused.TextInput.Text = base.Foreground(Text)
		s.Help.ShortKey = base.Foreground(Faint)
		s.Help.ShortDesc = base.Foreground(Dim)
		s.Help.ShortSeparator = base.Foreground(Faint)
		return s
	})
}
