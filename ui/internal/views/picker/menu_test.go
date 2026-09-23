package picker

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func menuItems() []MenuItem {
	return []MenuItem{
		{ID: "a", Label: "Open with…", Section: 0},
		{ID: "b", Label: "Reveal in Finder", Section: 0},
		{ID: "c", Label: "Sort", Hint: "⌃s", Section: 1, Quiet: true},
	}
}

func TestMenuEnterChoosesTheCursorRow(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if out.Kind != MenuChosen || out.Item.ID != "b" {
		t.Fatalf("got %+v, want b chosen", out)
	}
}

func TestMenuEscAtTheRootCloses(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuClosed {
		t.Fatalf("esc = %+v, want MenuClosed", out)
	}
}

func TestMenuTypingFiltersAndAChordPassesThrough(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	for _, r := range "rev" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "b" {
		t.Fatalf("filtered enter chose %q, want b", out.Item.ID)
	}
	mn = NewMenu("x.go", menuItems(), nil)
	if out := mn.Key(tea.KeyPressMsg{Code: 's', Mod: tea.ModCtrl}); out.Kind != MenuPassthrough || out.Key != "ctrl+s" {
		t.Fatalf("chord = %+v, want passthrough ctrl+s", out)
	}
}

func TestMenuRuleSeparatesSections(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	frame := mn.Render(strings.Repeat(strings.Repeat(" ", 80)+"\n", 23)+strings.Repeat(" ", 80), 80)
	plain := ansi.Strip(frame)
	reveal := strings.Index(plain, "Reveal in Finder")
	sort := strings.Index(plain, "Sort")
	if reveal < 0 || sort < 0 || !strings.Contains(plain[reveal:sort], "─") {
		t.Fatal("a rule must paint between section 0 and section 1")
	}
}

// The parent is non-blank because the compositor trims trailing blank cells,
// which would read an untouched all-space line back as zero wide.
func TestMenuSlidesInsideTheFrame(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(".", 80)+"\n", 24), "\n")
	mn := NewMenu("x.go", menuItems(), &MenuAnchor{X: 78, Y: 22})
	frame := mn.Render(parent, 80)
	for i, line := range strings.Split(frame, "\n") {
		if w := lipgloss.Width(line); w != 80 {
			t.Fatalf("line %d is %d wide, want 80", i, w)
		}
	}
	if got := len(strings.Split(frame, "\n")); got != 24 {
		t.Fatalf("frame is %d lines, want 24", got)
	}
}

func TestMenuClickChoosesThePaintedRowAndOutsideCloses(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	mn := NewMenu("x.go", menuItems(), &MenuAnchor{X: 10, Y: 5})
	frame := ansi.Strip(mn.Render(parent, 80))
	lines := strings.Split(frame, "\n")
	for y, line := range lines {
		if x := strings.Index(line, "Reveal in Finder"); x >= 0 {
			if out := mn.Click(lipgloss.Width(line[:x]), y); out.Kind != MenuChosen || out.Item.ID != "b" {
				t.Fatalf("click on the painted row = %+v", out)
			}
		}
	}
	if out := mn.Click(0, 0); out.Kind != MenuClosed {
		t.Fatalf("click outside = %+v, want MenuClosed", out)
	}
}
