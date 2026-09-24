package picker

import (
	"fmt"
	"image/color"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func fgSGRFor(c color.Color) string {
	return "38;2;" + rgbKey(c)
}

// dottedParent is an 80x24 frame of non-blank cells: the compositor trims
// trailing blank cells, which would read an untouched all-space line back as
// narrower than the frame.
func dottedParent() string {
	return strings.TrimSuffix(strings.Repeat(strings.Repeat(".", 80)+"\n", 24), "\n")
}

// boxContentLines returns the raw frame lines painted between the box's top
// and bottom border.
func boxContentLines(frame string) []string {
	var out []string
	inside := false
	for _, line := range strings.Split(frame, "\n") {
		plain := ansi.Strip(line)
		switch {
		case strings.Contains(plain, "╭"):
			inside = true
		case strings.Contains(plain, "╰"):
			return out
		case inside:
			out = append(out, line)
		}
	}
	return out
}

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

func TestMenuSlidesInsideTheFrame(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), &MenuAnchor{X: 78, Y: 22})
	frame := mn.Render(dottedParent(), 80)
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
	found := false
	for y, line := range lines {
		if x := strings.Index(line, "Reveal in Finder"); x >= 0 {
			found = true
			if out := mn.Click(lipgloss.Width(line[:x]), y); out.Kind != MenuChosen || out.Item.ID != "b" {
				t.Fatalf("click on the painted row = %+v", out)
			}
		}
	}
	if !found {
		t.Fatal("Reveal in Finder never painted")
	}
	if out := mn.Click(0, 0); out.Kind != MenuClosed {
		t.Fatalf("click outside = %+v, want MenuClosed", out)
	}
}

func TestMenuFilterKeepsEachSectionContiguous(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{
		{ID: "file", Label: "open file", Section: 0},
		{ID: "editor", Label: "open in editor", Section: 0},
		{ID: "open", Label: "open", Section: 1, Quiet: true},
		{ID: "tabs", Label: "open all tabs", Section: 1, Quiet: true},
	}, nil)
	for _, r := range "open" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	var order []string
	for _, mt := range mn.matches {
		order = append(order, mn.rows[mt.Index].id)
	}
	if got := strings.Join(order, ","); got != "file,editor,open,tabs" {
		t.Fatalf("filtered order = %s, want item matches first, then globals", got)
	}
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	rules := 0
	for _, line := range strings.Split(ansi.Strip(mn.Render(parent, 80)), "\n") {
		if strings.Contains(line, "│─") {
			rules++
		}
	}
	// The filter line's own rule plus exactly one section rule.
	if rules != 2 {
		t.Fatalf("painted %d rules inside the box, want 2", rules)
	}
}

func TestMenuCursorSkipsDisabledRows(t *testing.T) {
	items := []MenuItem{
		{ID: "a", Label: "Reveal in Finder", Disabled: true},
		{ID: "b", Label: "Open in Zed"},
		{ID: "c", Label: "Open with Default Program", Disabled: true},
		{ID: "d", Label: "Copy File Path", Section: 1},
	}
	mn := NewMenu("x.go", items, nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "b" {
		t.Fatalf("the first cursor stop is %q, want b", out.Item.ID)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "d" {
		t.Fatalf("down from b lands on %q, want d", out.Item.ID)
	}
}

func TestMenuCursorHoldsWhenNoEnabledRowLiesThatWay(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}, {ID: "b", Label: "Open in Zed"}}, nil)
	mn.Key(tea.KeyPressMsg{Code: tea.KeyUp})
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "b" {
		t.Fatalf("up over only disabled rows moved the cursor to %q, want b", out.Item.ID)
	}
	mn = NewMenu("x.go", []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}}, nil)
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuStay {
		t.Fatalf("enter with every row disabled = %+v, want MenuStay", out)
	}
}

func TestMenuDisabledRowIsInertToClickAndHover(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	items := []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}, {ID: "b", Label: "Open in Zed"}}
	mn := NewMenu("x.go", items, &MenuAnchor{X: 4, Y: 4})
	lines := strings.Split(ansi.Strip(mn.Render(parent, 80)), "\n")
	found := false
	for y, line := range lines {
		if x := strings.Index(line, "Reveal in Finder"); x >= 0 {
			found = true
			cx := lipgloss.Width(line[:x])
			if out := mn.Click(cx, y); out.Kind != MenuStay {
				t.Fatalf("click on a disabled row = %+v, want MenuStay", out)
			}
			mn.Motion(cx, y)
			if mn.hover != -1 {
				t.Fatal("a disabled row never takes hover")
			}
		}
	}
	if !found {
		t.Fatal("Reveal in Finder never painted")
	}
}

func TestMenuDisabledRowPaintsFaint(t *testing.T) {
	items := []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}, {ID: "b", Label: "Open in Zed"}}
	mn := NewMenu("x.go", items, nil)
	frame := mn.Render(strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n"), 80)
	line := ""
	for _, l := range strings.Split(frame, "\n") {
		if strings.Contains(ansi.Strip(l), "Reveal in Finder") {
			line = l
		}
	}
	if !strings.Contains(line, fgSGRFor(theme.Faint)) {
		t.Fatal("a disabled row's label paints Faint")
	}
}

func TestMenuPushedStepEscReturnsToTheRows(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "discard", Label: "Discard Changes…"}}, nil)
	mn.Push("Discard all changes to x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}, {ID: "no", Label: "Cancel"}})
	if mn.Title() != "Discard all changes to x.go?" {
		t.Fatalf("title = %q", mn.Title())
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuStay {
		t.Fatalf("esc in a step = %+v, want MenuStay", out)
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "discard" {
		t.Fatalf("after esc the root rows are back, got %q", out.Item.ID)
	}
}

func TestMenuClickOutsideAStepClosesTheWholeMenu(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "discard", Label: "Discard Changes…"}}, &MenuAnchor{X: 10, Y: 5})
	mn.Push("Discard all changes to x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}})
	mn.Render(dottedParent(), 80)
	if out := mn.Click(0, 0); out.Kind != MenuClosed {
		t.Fatalf("click outside a step = %+v, want MenuClosed", out)
	}
}

func TestMenuPushedStepKeepsEachSectionContiguous(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "ignore", Label: "Ignore Folder…"}}, nil)
	mn.Push("Ignore Folder", []MenuItem{
		{ID: "file", Label: "open file", Section: 0},
		{ID: "editor", Label: "open in editor", Section: 0},
		{ID: "open", Label: "open", Section: 1},
		{ID: "tabs", Label: "open all tabs", Section: 1},
	})
	for _, r := range "open" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	var order []string
	for _, mt := range mn.matches {
		order = append(order, mn.rows[mt.Index].id)
	}
	if got := strings.Join(order, ","); got != "file,editor,open,tabs" {
		t.Fatalf("a step's filtered order = %s, want each section contiguous", got)
	}
}

func TestMenuHeaderReadsEscBackInsideAStep(t *testing.T) {
	header := func(mn *Menu) string {
		return ansi.Strip(boxContentLines(mn.Render(dottedParent(), 80))[0])
	}
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("x.go", []MenuItem{tag}, nil)
	if h := header(mn); !strings.Contains(h, "esc dismiss") {
		t.Fatalf("root header = %q, want esc dismiss", h)
	}
	mn.Push("Discard all changes to x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}})
	if h := header(mn); !strings.Contains(h, "esc back") || strings.Contains(h, "dismiss") {
		t.Fatalf("question step header = %q, want esc back", h)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape})
	mn.AskName("Create a Tag", "Name", tag)
	if h := header(mn); !strings.Contains(h, "esc back") || strings.Contains(h, "dismiss") {
		t.Fatalf("name step header = %q, want esc back", h)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape})
	if h := header(mn); !strings.Contains(h, "esc dismiss") {
		t.Fatalf("header back at the root = %q, want esc dismiss", h)
	}
}

func TestMenuNameStepSubmitsATrimmedName(t *testing.T) {
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("fix the thing", []MenuItem{tag}, nil)
	mn.AskName("Create a Tag", "Name", tag)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuStay {
		t.Fatalf("enter on a blank name = %+v, want MenuStay", out)
	}
	for _, r := range " v1.2.0 " {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if out.Kind != MenuNamed || out.Name != "v1.2.0" || out.Item.ID != "tag" {
		t.Fatalf("got %+v", out)
	}
}

func TestNameMenuOpensOnAPrefilledNameAndEscCloses(t *testing.T) {
	publish := MenuItem{ID: "publish-name", Label: "Publish Repository"}
	mn := NewNameMenu("Publish Repository", "Name", "repo-tools", publish, nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuNamed || out.Name != "repo-tools" || out.Item.ID != "publish-name" {
		t.Fatalf("enter on the prefilled name = %+v, want MenuNamed repo-tools", out)
	}

	mn = NewNameMenu("Publish Repository", "Name", "repo", publish, nil)
	mn.Key(tea.KeyPressMsg{Code: tea.KeyBackspace})
	for _, r := range "-tools" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Name != "rep-tools" {
		t.Fatalf("editing the prefilled name = %+v, want rep-tools", out)
	}

	mn = NewNameMenu("Publish Repository", "Name", "repo", publish, nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuClosed {
		t.Fatalf("esc on a name menu's root = %+v, want MenuClosed", out)
	}
}

func TestMenuNameStepEscReturnsToTheUnfilteredRows(t *testing.T) {
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("fix the thing", []MenuItem{{ID: "sha", Label: "Copy SHA"}, {ID: "path", Label: "Copy Path"}, tag}, nil)
	for _, r := range "co" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if mn.query != "co" || len(mn.matches) != 2 {
		t.Fatalf("setup: query %q, %d matches, want the root narrowed to the two Copy rows", mn.query, len(mn.matches))
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	mn.AskName("Create a Tag", "Name", tag)
	for _, r := range "zz" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuStay {
		t.Fatalf("esc in a name step = %+v, want MenuStay", out)
	}
	if mn.query != "co" || len(mn.matches) != 2 {
		t.Fatalf("typing a name leaked into the rows' filter: query %q, %d matches", mn.query, len(mn.matches))
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuChosen || out.Item.ID != "path" {
		t.Fatalf("after esc the rows keep their filtered cursor, got %+v", out)
	}
}

func TestMenuNameStepPaintsOnlyTheHeaderAndTheNameLine(t *testing.T) {
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("fix the thing", []MenuItem{tag}, &MenuAnchor{X: 10, Y: 5})
	mn.AskName("Create a Tag", "Name", tag)
	lines := boxContentLines(mn.Render(dottedParent(), 80))
	if len(lines) != 2 {
		t.Fatalf("a name step paints %d lines inside the box, want the header and the name line", len(lines))
	}
	if plain := ansi.Strip(lines[1]); !strings.Contains(plain, theme.GlyphChevron+" Name") {
		t.Fatalf("empty name line = %q, want the chevron then the placeholder", plain)
	}
	if !strings.Contains(lines[1], fgSGRFor(theme.Faint)) {
		t.Fatal("the placeholder paints Faint")
	}
	if len(mn.zones.byY) != 0 {
		t.Fatalf("a name step records row zones: %+v", mn.zones.byY)
	}
	for _, r := range "v2.11.0" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	lines = boxContentLines(mn.Render(dottedParent(), 80))
	if plain := ansi.Strip(lines[1]); !strings.Contains(plain, theme.GlyphChevron+" v2.11.0") {
		t.Fatalf("typed name line = %q, want the chevron then the name", plain)
	}
	if !strings.Contains(lines[1], fgSGRFor(theme.Text)) {
		t.Fatal("a typed name paints Text")
	}
}

// dottedFrame is a width x height frame of non-blank cells (see dottedParent).
func dottedFrame(width, height int) string {
	return strings.TrimSuffix(strings.Repeat(strings.Repeat(".", width)+"\n", height), "\n")
}

func longMenuItems(n int) []MenuItem {
	items := make([]MenuItem, n)
	for i := range items {
		items[i] = MenuItem{ID: fmt.Sprintf("r%02d", i), Label: fmt.Sprintf("row %02d", i), Section: i / 5}
	}
	return items
}

// paintedRowAt returns the frame cell a painted label starts at, ok false
// when the label is not on screen.
func paintedRowAt(frame, label string) (x, y int, ok bool) {
	for row, line := range strings.Split(ansi.Strip(frame), "\n") {
		if i := strings.Index(line, label); i >= 0 {
			return lipgloss.Width(line[:i]), row, true
		}
	}
	return 0, 0, false
}

// boxWidth is the painted box's outer width, corner to corner.
func boxWidth(t *testing.T, frame string) int {
	t.Helper()
	for _, line := range strings.Split(ansi.Strip(frame), "\n") {
		if i := strings.Index(line, "╭"); i >= 0 {
			return lipgloss.Width(line[i : strings.Index(line, "╮")+len("╮")])
		}
	}
	t.Fatal("no box painted")
	return 0
}

func TestAPushedStepKeepsTheWindowedRootsThumbColumn(t *testing.T) {
	items := make([]MenuItem, 20)
	for i := range items {
		items[i] = MenuItem{ID: fmt.Sprintf("r%02d", i), Label: fmt.Sprintf("Discard changes to file number %02d.txt", i), Section: i / 5}
	}
	mn := NewMenu("x.go", items, &MenuAnchor{X: 10, Y: 0})
	mn.FitParentHeight()
	before := boxWidth(t, mn.Render(dottedFrame(80, 12), 80))
	mn.Push("Discard Changes?", []MenuItem{{ID: "yes", Label: "Discard Changes"}, {ID: "no", Label: "Cancel"}})
	after := boxWidth(t, mn.Render(dottedFrame(80, 12), 80))
	if after != before {
		t.Fatalf("a step pushed over a windowed root changed the box width from %d to %d, want unchanged", before, after)
	}
}

func TestAFittedMenuTallerThanTheParentPaintsItsHeightWithAThumb(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(20), &MenuAnchor{X: 10, Y: 3})
	mn.FitParentHeight()
	frame := mn.Render(dottedFrame(80, 12), 80)
	lines := strings.Split(frame, "\n")
	if len(lines) != 12 {
		t.Fatalf("a fitted menu paints %d lines over a 12-line parent", len(lines))
	}
	for i, line := range lines {
		if w := lipgloss.Width(line); w != 80 {
			t.Fatalf("line %d is %d wide", i, w)
		}
	}
	if !strings.Contains(strings.Join(boxContentLines(frame), "\n"), bgSGR(theme.Panel)) {
		t.Fatal("an overflowing row region paints a Panel thumb")
	}
	if _, _, ok := paintedRowAt(frame, "row 19"); ok {
		t.Fatal("the last row is below the window until the cursor gets there")
	}
}

func TestAMenuWithoutFitKeepsEveryRow(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(20), nil)
	frame := mn.Render(dottedFrame(80, 12), 80)
	if _, _, ok := paintedRowAt(frame, "row 19"); !ok {
		t.Fatal("an unfitted menu paints every row, as the picker's growing frame expects")
	}
	if strings.Contains(strings.Join(boxContentLines(frame), "\n"), bgSGR(theme.Panel)) {
		t.Fatal("an unfitted menu never paints a thumb")
	}
}

func TestAFittedMenuScrollsToKeepTheCursorInView(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(20), nil)
	mn.FitParentHeight()
	mn.Render(dottedFrame(80, 12), 80)
	for range 19 {
		mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	}
	frame := mn.Render(dottedFrame(80, 12), 80)
	x, y, ok := paintedRowAt(frame, "row 19")
	if !ok {
		t.Fatal("down past the window scrolls the last row into view")
	}
	if out := mn.Click(x, y); out.Kind != MenuChosen || out.Item.ID != "r19" {
		t.Fatalf("a click on the scrolled-in row = %+v", out)
	}
}

// TestCursorIntoWindowIsSafeWhenTheWindowOutgrowsTheRegion exercises
// cursorIntoWindow directly with a stale winH wider than the region it
// is handed, the shape a refilter between Wheel calls can produce.
func TestCursorIntoWindowIsSafeWhenTheWindowOutgrowsTheRegion(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(2), nil)
	mn.winH = 5
	mn.top = 0
	region := mn.regionLines()

	mn.cursorIntoWindow(region, true)
	if mn.cursor != 0 {
		t.Fatalf("fromTop cursor = %d, want 0", mn.cursor)
	}

	mn.cursorIntoWindow(region, false)
	if mn.cursor != 1 {
		t.Fatalf("fromBottom cursor = %d, want 1", mn.cursor)
	}
}

func TestAFittedMenuWheelScrollsTheRows(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(20), &MenuAnchor{X: 10, Y: 0})
	mn.FitParentHeight()
	frame := mn.Render(dottedFrame(80, 12), 80)
	x, y, _ := paintedRowAt(frame, "row 01")
	for range 6 {
		mn.Wheel(x, y, 3)
	}
	frame = mn.Render(dottedFrame(80, 12), 80)
	if _, _, ok := paintedRowAt(frame, "row 00"); ok {
		t.Fatal("the wheel scrolls the first row out of the window")
	}
	x, y, ok := paintedRowAt(frame, "row 19")
	if !ok {
		t.Fatal("the wheel reaches the last row")
	}
	if out := mn.Click(x, y); out.Kind != MenuChosen || out.Item.ID != "r19" {
		t.Fatalf("a click on a wheel-scrolled row = %+v", out)
	}
	mn = NewMenu("x.go", longMenuItems(20), &MenuAnchor{X: 10, Y: 0})
	mn.FitParentHeight()
	mn.Render(dottedFrame(80, 12), 80)
	for range 6 {
		mn.Wheel(x, y, 3)
	}
	mn.Render(dottedFrame(80, 12), 80)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuChosen {
		t.Fatalf("enter after the wheel = %+v", out)
	} else if _, _, ok := paintedRowAt(mn.Render(dottedFrame(80, 12), 80), out.Item.Label); !ok {
		t.Fatalf("the wheel left the cursor on %q, a row the window does not show", out.Item.Label)
	}
}

func TestAWheelOutsideTheBoxScrollsNothing(t *testing.T) {
	mn := NewMenu("x.go", longMenuItems(20), &MenuAnchor{X: 10, Y: 0})
	mn.FitParentHeight()
	mn.Render(dottedFrame(80, 12), 80)
	mn.Wheel(79, 11, 3)
	if _, _, ok := paintedRowAt(mn.Render(dottedFrame(80, 12), 80), "row 00"); !ok {
		t.Fatal("a wheel tick outside the box leaves the rows where they were")
	}
}

func TestAPushedStepKeepsTheWidthOfTheLevelItReplaced(t *testing.T) {
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("fix the thing", []MenuItem{{ID: "i", Label: "Ignore All .go Files (Add to .gitignore)"}, tag}, nil)
	root := boxWidth(t, mn.Render(dottedParent(), 80))
	mn.AskName("Create a Tag", "Name", tag)
	if w := boxWidth(t, mn.Render(dottedParent(), 80)); w != root {
		t.Fatalf("the name step is %d wide, want the %d-wide box it replaced", w, root)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape})
	mn.Push("Discard all changes to a-rather-long-file-name.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}})
	if w := boxWidth(t, mn.Render(dottedParent(), 80)); w <= root {
		t.Fatalf("a step that needs more room grows past %d, got %d", root, w)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape})
	if w := boxWidth(t, mn.Render(dottedParent(), 80)); w != root {
		t.Fatalf("back at the root the box is %d wide, want %d", w, root)
	}
}

func TestMenuStepsKeepTheBoxInsideTheFrame(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "a", Label: "Discard Changes…"}}, &MenuAnchor{X: 79, Y: 23})
	mn.Push(strings.Repeat("Discard all changes to a/very/long/path/", 4)+"x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}})
	for _, line := range strings.Split(mn.Render(dottedParent(), 80), "\n") {
		if w := lipgloss.Width(line); w != 80 {
			t.Fatalf("a step's frame line is %d wide, want 80", w)
		}
	}
}
