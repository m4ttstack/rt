package mission

import (
	"fmt"
	"image/color"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// fgSGR is the truecolor foreground SGR fragment lipgloss emits for c,
// mirroring the picker view's helper of the same name (picker_test.go):
// what these pin is which theme role a glyph wears, not a literal byte
// value, so a token change re-pins them rather than silently passing a
// swapped accent.
func fgSGR(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("38;2;%d;%d;%d", r>>8, g>>8, b>>8)
}

func pullModel() Model {
	return Model{
		Current: Current{Repo: "repo-tools", RepoLabel: "repo-tools", WorktreeName: "gandalf", Branch: "rt-191-mission-tui"},
		Action:  ActionModel{Kind: "pull", Title: "Pull origin", Meta: "3 commits behind", Ahead: 3, Behind: 2},
	}
}

func TestRenderActionSegmentPullShowsTitleAndBothPills(t *testing.T) {
	out := renderActionSegment(pullModel().Action, 60, false, false)
	for _, want := range []string{"Pull origin", "3↑", "2↓"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in pull segment:\n%s", want, out)
		}
	}
}

func TestRenderActionSegmentPillsOnlyWhenNonzero(t *testing.T) {
	out := renderActionSegment(ActionModel{Kind: "push", Title: "Push origin", Meta: "Last fetched 3 minutes ago", Ahead: 3, Behind: 0}, 60, false, false)
	if !strings.Contains(out, "3↑") {
		t.Fatalf("missing ahead pill in push segment:\n%s", out)
	}
	if strings.Contains(out, "↓") {
		t.Fatalf("unexpected behind pill in a zero-behind push segment:\n%s", out)
	}
}

// TestActionGlyphColorsPerKind pins each Kind to its own accent so a
// swapped color (Coral vs Lav, PinkSoft vs Mint) fails a test instead of
// passing every existing substring/width check.
func TestActionGlyphColorsPerKind(t *testing.T) {
	cases := []struct {
		kind  string
		glyph string
		color color.Color
	}{
		{"pull", "↓", theme.Mint},
		{"push", "↑", theme.Cyan},
		{"force-push", "⇈", theme.Coral},
		{"publish-branch", "↑", theme.Lav},
		{"fetch", "⟳", theme.PinkSoft},
	}
	for _, c := range cases {
		out := renderActionSegment(ActionModel{Kind: c.kind, Title: "x"}, 60, false, false)
		want := fgSGR(c.color) + "m" + c.glyph
		if !strings.Contains(out, want) {
			t.Fatalf("%s glyph should wear its accent color: want %q in\n%s", c.kind, want, out)
		}
	}
}

func TestRenderBranchSegmentDetachedValueWearsPeach(t *testing.T) {
	out := renderBranchSegment(Model{Current: Current{Detached: true, Branch: "a1b2c3d"}}, 40, false, false)
	if !strings.Contains(out, "1;"+fgSGR(theme.Peach)+"m") {
		t.Fatalf("detached value should wear bold Peach: %q", out)
	}
}

func TestRenderBranchSegmentDetachedHasOnPrefixAndNoChevron(t *testing.T) {
	out := renderBranchSegment(Model{Current: Current{Detached: true, Branch: "a1b2c3d"}}, 40, false, false)
	if !strings.Contains(out, "On a1b2c3d") {
		t.Fatalf("missing \"On \" prefix in detached segment:\n%s", out)
	}
	if !strings.Contains(out, "Detached HEAD") {
		t.Fatalf("missing Detached HEAD label:\n%s", out)
	}
	if strings.Contains(out, theme.GlyphChevron) {
		t.Fatalf("detached segment must not render a foldout chevron:\n%s", out)
	}
}

func TestRenderBranchSegmentNormalHasChevron(t *testing.T) {
	out := renderBranchSegment(Model{Current: Current{Branch: "main"}}, 40, false, false)
	if !strings.Contains(out, "main") {
		t.Fatalf("missing branch name:\n%s", out)
	}
	if !strings.Contains(out, theme.GlyphChevron) {
		t.Fatalf("normal branch segment should render a foldout chevron:\n%s", out)
	}
}

func TestRenderRepoSegmentWidthIsSidebarWidth(t *testing.T) {
	out := renderRepoSegment(pullModel(), sidebarWidth, false, false)
	for i, line := range strings.Split(out, "\n") {
		if w := lipgloss.Width(line); w != sidebarWidth {
			t.Fatalf("row %d width = %d, want sidebarWidth %d:\n%s", i, w, sidebarWidth, out)
		}
	}
}

func TestRenderTopBarAssemblesAllFourSegments(t *testing.T) {
	out := renderTopBar(pullModel(), 140, zoneNone, zoneNone)
	for _, want := range []string{"Current Repository", "repo-tools", "Current Worktree", "gandalf", "Current Branch", "rt-191-mission-tui", "Pull origin"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in top bar:\n%s", want, out)
		}
	}
}

func TestRenderTopBarZeroWidthIsEmpty(t *testing.T) {
	if out := renderTopBar(pullModel(), 0, zoneNone, zoneNone); out != "" {
		t.Fatalf("zero width top bar = %q, want empty", out)
	}
}
