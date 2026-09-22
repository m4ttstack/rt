package theme

import (
	"image/color"
	"math"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestPaletteMatchesTokenSheet(t *testing.T) {
	want := map[string]string{
		"pink": "#FF6B9D", "mint": "#62E6A8", "coral": "#FF7979", "peach": "#FFB77A",
		"cyan": "#5AAAFF", "lav": "#BD93F9", "text": "#E6E0FF", "dim": "#B4ADD1",
		"bg": "#161224", "selBg": "#37284B", "warnBg": "#2A2033", "panel": "#34304E",
	}
	got := map[string]string{
		"pink": Hex(Pink), "mint": Hex(Mint), "coral": Hex(Coral), "peach": Hex(Peach),
		"cyan": Hex(Cyan), "lav": Hex(Lav), "text": Hex(Text), "dim": Hex(Dim),
		"bg": Hex(Bg), "selBg": Hex(SelBg), "warnBg": Hex(WarnBg), "panel": Hex(Panel),
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %s, want %s", k, got[k], v)
		}
	}
}

func TestSpinnerFrames(t *testing.T) {
	if strings.Join(SpinnerFrames, "") != "⠋⠙⠹⠸⠼⠴⠦⠧⠣⠏" {
		t.Fatalf("frames %q", SpinnerFrames)
	}
}

func TestHuhFormBaseIsThePinkAccentBar(t *testing.T) {
	styles := Huh().Theme(true)
	out := styles.Form.Base.Render("body")
	if !strings.Contains(out, "▌") {
		t.Fatalf("no accent edge in %q", out)
	}
	if strings.ContainsAny(out, "╭╰╮╯─") {
		t.Fatalf("box glyphs survived the bar chrome: %q", out)
	}
	if !strings.Contains(out, "\x1b[38;2;255;107;157m") {
		t.Fatalf("edge is not pink truecolor: %q", out)
	}
	if lipgloss.Width(out) < 6 {
		t.Fatalf("bar block too narrow: %q", out)
	}
}

func TestHuhDestructiveUsesPeachAccents(t *testing.T) {
	styles := HuhDestructive().Theme(true)
	if !strings.Contains(styles.Focused.FocusedButton.Render("no"), "\x1b[48;2;255;183;122m") {
		t.Fatalf("destructive button is not peach: %q", styles.Focused.FocusedButton.Render("no"))
	}
	if !strings.Contains(styles.Form.Base.Render("x"), "\x1b[38;2;255;183;122m") {
		t.Fatalf("destructive edge is not peach")
	}
}

func TestCardWidthIsTheDesignCap(t *testing.T) {
	if CardWidth != 88 {
		t.Fatalf("CardWidth = %d, want 88", CardWidth)
	}
}

func TestPickerTokens(t *testing.T) {
	want := map[string]string{
		"hoverBg": "#2F2A4A", "surface": "#221A35", "blue": "#6B9DFF",
	}
	got := map[string]string{
		"hoverBg": Hex(HoverBg), "surface": Hex(Surface), "blue": Hex(Blue),
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %s, want %s", k, got[k], v)
		}
	}
}

// relLuminance is the WCAG relative luminance of a color, used below only to
// pin a direction (lighter/darker), never an exact contrast ratio.
func relLuminance(c color.Color) float64 {
	r, g, b, _ := c.RGBA()
	lin := func(v uint32) float64 {
		f := float64(v) / 65535
		if f <= 0.04045 {
			return f / 12.92
		}
		return math.Pow((f+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}

// TestTopBarBgIsLighterThanBg pins the direction, not just a value: a dark
// app's content already sits near-black, so the top bar's own rest fill has
// to rise ABOVE the canvas to separate from it, the opposite of GitHub
// Desktop's light-app toolbar, which separates by sinking below its content
// (2026-09-22 correction of an earlier attempt that set TopBarBg darker than
// Bg and merged into it on screen).
func TestTopBarBgIsLighterThanBg(t *testing.T) {
	if relLuminance(TopBarBg) <= relLuminance(Bg) {
		t.Fatalf("TopBarBg (%s, lum %.5f) must be lighter than Bg (%s, lum %.5f)",
			Hex(TopBarBg), relLuminance(TopBarBg), Hex(Bg), relLuminance(Bg))
	}
}

// TestTopBarStateOrdering pins the three top-bar fill states in luminance
// order: an open segment's Surface (merging with the foldout panel it now
// shares a color with) sits below the bar's own rest fill, which sits below
// the bar's own hover fill.
func TestTopBarStateOrdering(t *testing.T) {
	open, rest, hover := relLuminance(Surface), relLuminance(TopBarBg), relLuminance(TopBarHoverBg)
	if !(open < rest) {
		t.Fatalf("open (Surface %s, lum %.5f) must be darker than rest (TopBarBg %s, lum %.5f)",
			Hex(Surface), open, Hex(TopBarBg), rest)
	}
	if !(rest < hover) {
		t.Fatalf("rest (TopBarBg %s, lum %.5f) must be darker than hover (TopBarHoverBg %s, lum %.5f)",
			Hex(TopBarBg), rest, Hex(TopBarHoverBg), hover)
	}
}
