package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func stashMission(showing bool) *Mission {
	m := newTestMission()
	m.width, m.height = 150, 40
	m.model.Stash = &StashModel{
		Sha: "s1", Branch: "main", Showing: showing, SelectedFile: "a.txt",
		Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}, {Path: "b.txt", Status: "new"}},
	}
	if showing {
		m.model.Diff = DiffModel{Path: "a.txt", Status: "modified", Kind: "text", ReadOnly: true}
		m.focus = focusStashFiles
		m.stashFile = "a.txt"
	}
	return m
}

// stashButtonRowY is the frame row the stash header paints its buttons on.
func stashButtonRowY(t *testing.T, m *Mission) int {
	t.Helper()
	frame := ansi.Strip(m.View().Content)
	for y, line := range strings.Split(frame, "\n") {
		if strings.Contains(line, " Restore ") && strings.Contains(line, " Discard ") {
			return y
		}
	}
	t.Fatalf("no button row painted:\n%s", frame)
	return -1
}

// stashFileRowY is the frame row the stash file column paints path on.
func stashFileRowY(t *testing.T, m *Mission, path string) int {
	t.Helper()
	frame := ansi.Strip(m.View().Content)
	for y, line := range strings.Split(frame, "\n") {
		if strings.Contains(strings.TrimPrefix(line, sidebarPart(line)), path) {
			return y
		}
	}
	t.Fatalf("no %s row painted:\n%s", path, frame)
	return -1
}

func TestStashStripShowsOnlyWithAnEntry(t *testing.T) {
	m := stashMission(false)
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "Stashed Changes") {
		t.Fatalf("strip missing:\n%s", out)
	}
	m.model.Stash = nil
	if out := ansi.Strip(m.View().Content); strings.Contains(out, "Stashed Changes") {
		t.Fatalf("strip painted without an entry:\n%s", out)
	}
}

func TestStashStripPaintsSelectedWhileShowing(t *testing.T) {
	rest := renderStashStrip(false, false, sidebarWidth)
	sel := renderStashStrip(true, false, sidebarWidth)
	if rest == sel || !strings.Contains(sel, bgSGR(theme.SelBg)) {
		t.Fatalf("selected strip should paint SelBg")
	}
}

// sgrBefore is the style sequence painted immediately before the first
// occurrence of text in out.
func sgrBefore(t *testing.T, out, text string) string {
	t.Helper()
	i := strings.Index(out, text)
	if i < 0 {
		t.Fatalf("%q not painted: %q", text, out)
	}
	return out[strings.LastIndex(out[:i], "\x1b["):i]
}

// TestStashStripStates pins StashStates.png's strip column: rest, hover, and
// selected each wear their own fill, glyph, label, and chevron colors.
func TestStashStripStates(t *testing.T) {
	cases := []struct {
		name                      string
		selected, hovered         bool
		bg, glyph, label, chevron string
	}{
		{"rest", false, false, bgSGR(theme.BgSubtle), fgSGR(theme.Dimmer), fgSGR(theme.TextSoft), fgSGR(theme.Faint)},
		{"hover", false, true, bgSGR(theme.HoverBg), fgSGR(theme.Dim), fgSGR(theme.Text), fgSGR(theme.Dimmer)},
		{"selected", true, false, bgSGR(theme.SelBg), fgSGR(theme.Pink), fgSGR(theme.Text), fgSGR(theme.Pink)},
	}
	for _, tc := range cases {
		out := renderStashStrip(tc.selected, tc.hovered, sidebarWidth)
		if w := ansi.StringWidth(out); w != sidebarWidth {
			t.Fatalf("%s: strip is %d cells, want %d", tc.name, w, sidebarWidth)
		}
		for text, fg := range map[string]string{theme.GlyphStash: tc.glyph, "Stashed Changes": tc.label, theme.GlyphChevron: tc.chevron} {
			if sgr := sgrBefore(t, out, text); !strings.Contains(sgr, fg) || !strings.Contains(sgr, tc.bg) {
				t.Fatalf("%s: %q should wear %s on %s, got %q", tc.name, text, fg, tc.bg, sgr)
			}
		}
	}
}

func TestStashViewPaintsHeaderFilesAndDiff(t *testing.T) {
	m := stashMission(true)
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"Stashed changes", "Restore", "Discard", "Restore will move your stashed files to the Changes list.", "2 changed files", "b.txt"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q:\n%s", want, out)
		}
	}
}

// TestStashHeaderButtonsWearTheBoardColors: Restore is the Pink primary,
// Discard the Panel secondary; hover takes each to its commit and undo
// button counterpart.
func TestStashHeaderButtonsWearTheBoardColors(t *testing.T) {
	lines := stashHeaderLines(100, false, false)
	if len(lines) != 2 {
		t.Fatalf("header should be two rows, got %d", len(lines))
	}
	row := lines[1]
	if !strings.Contains(row, bgSGR(theme.Pink)) || !strings.Contains(row, bgSGR(theme.Panel)) || !strings.Contains(row, fgSGR(theme.Dim)) {
		t.Fatalf("rest buttons should be Pink and Panel with a Dim line: %q", row)
	}
	if hovered := stashHeaderLines(100, true, false)[1]; !strings.Contains(hovered, bgSGR(theme.PinkSoft)) {
		t.Fatalf("hovered Restore should go PinkSoft: %q", hovered)
	}
	if hovered := stashHeaderLines(100, false, true)[1]; !strings.Contains(hovered, bgSGR(theme.HoverBg)) || strings.Contains(hovered, bgSGR(theme.Panel)) {
		t.Fatalf("hovered Discard should go HoverBg: %q", hovered)
	}
	for _, w := range []int{100, 30, 12, 3} {
		for i, line := range stashHeaderLines(w, false, false) {
			if got := ansi.StringWidth(line); got != w {
				t.Fatalf("width %d: header row %d is %d cells", w, i, got)
			}
		}
	}
}

// TestStashHeaderButtonsSpanThePaintedLabels: the spans the hit test reads
// are exactly the cells the buttons paint.
func TestStashHeaderButtonsSpanThePaintedLabels(t *testing.T) {
	row := ansi.Strip(stashHeaderLines(100, false, false)[1])
	rs, re, ds, de := stashHeaderButtons(100)
	if got := row[rs:re]; got != " Restore " {
		t.Fatalf("restore span paints %q", got)
	}
	if got := row[ds:de]; got != " Discard " {
		t.Fatalf("discard span paints %q", got)
	}
	if rs, re, ds, de := stashHeaderButtons(12); re > 11 || de > 11 || ds < re || rs != 1 {
		t.Fatalf("narrow spans must stay inside the clipped row: %d %d %d %d", rs, re, ds, de)
	}
	for _, w := range []int{100, 15, 8} {
		rs, re, ds, de := stashHeaderButtons(w)
		for x, bg := range cellBackgrounds(stashHeaderLines(w, false, false)[1]) {
			want := bgSGR(theme.BgSubtle)
			switch {
			case x >= rs && x < re:
				want = bgSGR(theme.Pink)
			case x >= ds && x < de:
				want = bgSGR(theme.Panel)
			}
			if bg != want {
				t.Fatalf("width %d: cell %d wears %q, the spans say %q", w, x, bg, want)
			}
		}
	}
}

// TestStashDiffWithoutAFileIsNotTheCleanTreeCard: the stash pane's diff
// column follows History's empty state, even on a clean tree.
func TestStashDiffWithoutAFileIsNotTheCleanTreeCard(t *testing.T) {
	m := stashMission(true)
	m.model.Diff = DiffModel{}
	out := ansi.Strip(m.View().Content)
	if strings.Contains(out, "No local changes") || !strings.Contains(out, "No file selected") {
		t.Fatalf("the stash diff column should read \"No file selected\":\n%s", out)
	}
}

func TestStashViewLoadingMessage(t *testing.T) {
	m := stashMission(true)
	m.model.Stash.Files = nil
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "Loading stashed changes…") {
		t.Fatalf("no loading message:\n%s", out)
	}
}

func TestHTogglesTheStashView(t *testing.T) {
	m := stashMission(false)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd == nil || m.focus != focusStashFiles {
		t.Fatalf("h should open the view and focus the stash files (focus=%v)", m.focus)
	}
	m = stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd == nil || m.focus != focusList {
		t.Fatalf("h should close the view and return to the list (focus=%v)", m.focus)
	}
	m = stashMission(false)
	m.model.Stash = nil
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd != nil {
		t.Fatalf("h without a stash does nothing")
	}
}

func TestEscClosesTheStashView(t *testing.T) {
	m := stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEscape}); cmd == nil || m.focus != focusList {
		t.Fatalf("esc should close the view and return to the list (focus=%v)", m.focus)
	}
}

func TestStashFilesMoveAndEnterTheDiff(t *testing.T) {
	m := stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyDown}); cmd == nil || m.stashFile != "b.txt" {
		t.Fatalf("down should move to b.txt and emit (got %q)", m.stashFile)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyDown}); cmd != nil || m.stashFile != "b.txt" {
		t.Fatalf("down on the last file stays put without emitting (got %q)", m.stashFile)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.focus != focusDiff {
		t.Fatalf("enter should focus the diff")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusStashFiles {
		t.Fatalf("esc from the diff returns to the stash files")
	}
}

func TestStashFilesSpaceDoesNothing(t *testing.T) {
	m := newMouseTestMission()
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "a.txt", Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}}}
	m.focus = focusStashFiles
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}); cmd != nil {
		t.Fatalf("space must not stage the hidden Changes selection")
	}
}

func TestRRestoresTheStash(t *testing.T) {
	m := stashMission(true)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'R', Text: "R"}); cmd == nil {
		t.Fatalf("R should emit a restore")
	}
}

func TestStashViewClosesWhenTheEntryVanishes(t *testing.T) {
	m := stashMission(true)
	next := m.model
	next.Stash = nil
	pushModel(t, m, next)
	if m.focus != focusList {
		t.Fatalf("focus should return to the list, got %v", m.focus)
	}
}

func TestStashDiffFocusDropsWhenTheViewCloses(t *testing.T) {
	m := stashMission(true)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	next := m.model
	next.Stash = &StashModel{Sha: "s1", Branch: "main", Files: next.Stash.Files}
	next.Diff = DiffModel{}
	pushModel(t, m, next)
	if m.focus != focusList {
		t.Fatalf("a diff focused from the stash files returns to the list when the view closes, got %v", m.focus)
	}
}

func TestStashPushAdoptsTheDriversFileWhenTheCursorFallsOff(t *testing.T) {
	m := stashMission(true)
	m.stashFile = "gone.txt"
	next := m.model
	next.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "b.txt", Files: next.Stash.Files}
	pushModel(t, m, next)
	if m.stashFile != "b.txt" {
		t.Fatalf("stashFile should adopt the driver's selection, got %q", m.stashFile)
	}
}

func TestReturningToChangesFocusesTheOpenStash(t *testing.T) {
	m := stashMission(true)
	history := m.model
	history.Tab = "history"
	pushModel(t, m, history)
	if m.stashShowing() {
		t.Fatalf("the stash view belongs to the Changes tab")
	}
	changes := history
	changes.Tab = "changes"
	pushModel(t, m, changes)
	if m.focus != focusStashFiles {
		t.Fatalf("back on Changes with the view open, focus should be the stash files, got %v", m.focus)
	}
}

func TestStashPaneHitsMatchPaint(t *testing.T) {
	m := stashMission(true)
	y := stashButtonRowY(t, m)
	rs, re, ds, de := stashHeaderButtons(m.diffWidth())
	paneX := sidebarWidth + 1
	if h := m.hitTest(paneX+rs, y); h.kind != hitStashRestore {
		t.Fatalf("Restore start hit %v", h.kind)
	}
	if h := m.hitTest(paneX+re-1, y); h.kind != hitStashRestore {
		t.Fatalf("Restore end hit %v", h.kind)
	}
	if h := m.hitTest(paneX+ds, y); h.kind != hitStashDiscard {
		t.Fatalf("Discard start hit %v", h.kind)
	}
	if h := m.hitTest(paneX+de-1, y); h.kind != hitStashDiscard {
		t.Fatalf("Discard end hit %v", h.kind)
	}
	if h := m.hitTest(paneX+re, y); h.kind != hitNone {
		t.Fatalf("the gap between the buttons hit %v", h.kind)
	}
	if h := m.hitTest(paneX+de+2, y); h.kind != hitNone {
		t.Fatalf("the explanatory line hit %v", h.kind)
	}
	if h := m.hitTest(paneX+rs, y-1); h.kind != hitNone {
		t.Fatalf("the title row hit %v", h.kind)
	}
	fy := stashFileRowY(t, m, "b.txt")
	if h := m.hitTest(paneX+3, fy); h.kind != hitStashFile || h.idx != 1 {
		t.Fatalf("the b.txt row hit %v idx %d", h.kind, h.idx)
	}
}

func TestStashButtonHoverPaintsAndClears(t *testing.T) {
	m := stashMission(true)
	y := stashButtonRowY(t, m)
	rs, _, ds, _ := stashHeaderButtons(m.diffWidth())
	paneX := sidebarWidth + 1
	m.Update(tea.MouseMotionMsg{X: paneX + rs, Y: y})
	if !m.hoverStashRestore || !strings.Contains(strings.Split(m.View().Content, "\n")[y], bgSGR(theme.PinkSoft)) {
		t.Fatalf("hovering Restore should paint it PinkSoft")
	}
	m.Update(tea.MouseMotionMsg{X: paneX + ds, Y: y})
	if m.hoverStashRestore || !m.hoverStashDiscard {
		t.Fatalf("moving onto Discard should move the hover (restore=%v discard=%v)", m.hoverStashRestore, m.hoverStashDiscard)
	}
	m.Update(tea.MouseMotionMsg{X: 0, Y: 0})
	if m.hoverStashRestore || m.hoverStashDiscard {
		t.Fatalf("leaving the buttons should clear their hover")
	}
	fy := stashFileRowY(t, m, "b.txt")
	m.Update(tea.MouseMotionMsg{X: paneX + 3, Y: fy})
	if m.hoverStashFile != 1 {
		t.Fatalf("hovering b.txt should set hoverStashFile=1, got %d", m.hoverStashFile)
	}
	m.Update(tea.MouseMotionMsg{X: 0, Y: 0})
	if m.hoverStashFile != -1 {
		t.Fatalf("leaving the file column should clear hoverStashFile, got %d", m.hoverStashFile)
	}
}

func TestClickingRestoreEmits(t *testing.T) {
	m := stashMission(true)
	y := stashButtonRowY(t, m)
	rs, _, _, _ := stashHeaderButtons(m.diffWidth())
	if _, cmd := m.Update(tea.MouseClickMsg{X: sidebarWidth + 1 + rs, Y: y, Button: tea.MouseLeft}); cmd == nil {
		t.Fatalf("clicking Restore should emit a restore")
	}
}

func TestClickingAStashFileSelectsIt(t *testing.T) {
	m := stashMission(true)
	m.focus = focusDiff
	y := stashFileRowY(t, m, "b.txt")
	if _, cmd := m.Update(tea.MouseClickMsg{X: sidebarWidth + 4, Y: y, Button: tea.MouseLeft}); cmd == nil || m.stashFile != "b.txt" || m.focus != focusStashFiles {
		t.Fatalf("clicking b.txt should select it and focus the stash files (file=%q focus=%v)", m.stashFile, m.focus)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: sidebarWidth + 4, Y: y, Button: tea.MouseLeft}); cmd != nil {
		t.Fatalf("clicking the selected file again emits nothing")
	}
}

func TestClickingTheStripTogglesTheView(t *testing.T) {
	m := stashMission(false)
	y, ok := findHitY(m, 5, hitStash)
	if !ok {
		t.Fatal("setup: no strip row")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 5, Y: y, Button: tea.MouseLeft}); cmd == nil || m.focus != focusStashFiles || m.localNotice != "" {
		t.Fatalf("clicking the strip should open the view (focus=%v notice=%q)", m.focus, m.localNotice)
	}
}

func TestWheelOverTheStashFilesMovesTheCursor(t *testing.T) {
	m := stashMission(true)
	y := stashFileRowY(t, m, "a.txt")
	if _, cmd := m.Update(tea.MouseWheelMsg{X: sidebarWidth + 4, Y: y, Button: tea.MouseWheelDown}); cmd == nil || m.stashFile != "b.txt" {
		t.Fatalf("the wheel over the stash files should move the cursor (got %q)", m.stashFile)
	}
}

// TestStashViewLeavesTheChangesListUnselected: Stash.png's Changes list
// paints no cursor row while the stash view shows.
func TestStashViewLeavesTheChangesListUnselected(t *testing.T) {
	m := newMouseTestMission()
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "a.txt", Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}}}
	m.focus = focusStashFiles
	row := ansi.Cut(strings.Split(m.View().Content, "\n")[changesRowY(m, 0)], 0, sidebarWidth)
	if strings.Contains(row, bgSGR(theme.SelBg)) {
		t.Fatalf("the Changes cursor row should not paint while the stash view shows: %q", row)
	}
}

// TestChoosingAChangesFileLeavesTheStash: GHD hides the stash on a
// working-directory selection, so a click on the row the Changes cursor
// already holds still tells the driver.
func TestChoosingAChangesFileLeavesTheStash(t *testing.T) {
	m := newMouseTestMission()
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "a.txt", Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}}}
	m.focus = focusStashFiles
	if _, cmd := m.Update(tea.MouseClickMsg{X: 10, Y: changesRowY(m, 0), Button: tea.MouseLeft}); cmd == nil || m.focus != focusList {
		t.Fatalf("clicking the selected Changes row should emit a select (focus=%v)", m.focus)
	}
}

// TestCheckboxOnTheHiddenCursorRowKeepsTheStashFocus: staging the row the
// Changes cursor already holds sends no select, so the view stays open and
// focus must stay with it.
func TestCheckboxOnTheHiddenCursorRowKeepsTheStashFocus(t *testing.T) {
	m := newMouseTestMission()
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "a.txt", Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}}}
	m.focus = focusStashFiles
	start, _ := changeRowCheckboxSpan(m.model.Changes[0])
	if h := m.hitTest(start, changesRowY(m, 0)); h.kind != hitFileCheckbox || h.idx != 0 {
		t.Fatalf("setup: the click should land on a.go's checkbox, got %v idx %d", h.kind, h.idx)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: start, Y: changesRowY(m, 0), Button: tea.MouseLeft}); cmd == nil {
		t.Fatalf("the checkbox click should still stage")
	}
	if m.focus != focusStashFiles {
		t.Fatalf("focus should stay on the stash files, got %v", m.focus)
	}
}

// TestCtrlKInTheStashViewHasNoRowTarget: the hidden Changes selection never
// lends the stash view its file menu, from the stash files or the stash diff.
func TestCtrlKInTheStashViewHasNoRowTarget(t *testing.T) {
	for _, focus := range []focusKind{focusStashFiles, focusDiff} {
		m := newMouseTestMission()
		m.model.Stash = &StashModel{Sha: "s1", Branch: "main", Showing: true, SelectedFile: "a.txt", Files: []HistoryFileRow{{Path: "a.txt", Status: "modified"}}}
		m.focus = focus
		m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
		if m.menu == nil || m.menuTarget.kind != targetNone {
			t.Fatalf("focus %v: ctrl-k should open the board-wide menu with no row target, got %+v", focus, m.menuTarget)
		}
		m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
		if m.focus != focus {
			t.Fatalf("closing the menu should return to focus %v, got %v", focus, m.focus)
		}
	}
}

// TestLeavingASubFocusReturnsToTheStashFiles: a filter, a commit field, and
// a foldout each hand focus back to the stash files while the view shows.
func TestLeavingASubFocusReturnsToTheStashFiles(t *testing.T) {
	for _, key := range []tea.KeyPressMsg{{Code: '/', Text: "/"}, {Code: 'c', Text: "c"}, {Code: 'b', Text: "b"}} {
		m := stashMission(true)
		m.Update(key)
		if m.focus == focusStashFiles {
			t.Fatalf("%q should leave the stash files", key.Text)
		}
		m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
		if m.focus != focusStashFiles {
			t.Fatalf("esc after %q should return to the stash files, got %v", key.Text, m.focus)
		}
	}
}

func TestChangesKeybarHintsTheStashKeys(t *testing.T) {
	out := ansi.Strip(renderKeybar(160, "changes"))
	for _, want := range []string{"S stash", "h show stash", "q quit"} {
		if !strings.Contains(out, want) {
			t.Fatalf("changes keybar missing %q: %s", want, out)
		}
	}
}

func TestStashKeybar(t *testing.T) {
	out := ansi.Strip(renderKeybar(150, "stash"))
	if !strings.Contains(out, "R restore · D discard · h hide") {
		t.Fatalf("D discard sits between restore and hide: %s", out)
	}
	for _, want := range []string{"↑↓ files", "enter diff", "R restore", "h hide", "⌃k menu", "b branch", "w worktree", "r repo", "q quit"} {
		if !strings.Contains(out, want) {
			t.Fatalf("stash keybar missing %q: %s", want, out)
		}
	}
	m := stashMission(true)
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "R restore") {
		t.Fatalf("the frame should paint the stash keybar while the view shows:\n%s", out)
	}
}

func TestEmptyStateOffersTheStash(t *testing.T) {
	out := ansi.Strip(renderEmptyStateCard(100, 20, true))
	if !strings.Contains(out, "view your stashed changes") {
		t.Fatalf("no stash hint:\n%s", out)
	}
	if strings.Contains(ansi.Strip(renderEmptyStateCard(100, 20, false)), "stashed") {
		t.Fatalf("stash hint without a stash")
	}
	if out := ansi.Strip(stashMission(false).View().Content); !strings.Contains(out, "view your stashed changes") {
		t.Fatalf("a clean tree with a stash should offer it:\n%s", out)
	}
}

func TestShiftSStashesOrAsksToOverwrite(t *testing.T) {
	m := newMouseTestMission()
	m.model.CanStash = true
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"}); cmd == nil || m.menu != nil {
		t.Fatalf("S without a stash emits at once")
	}
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main"}
	m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"})
	if m.menu == nil || m.menu.Title() != "Overwrite Stash?" {
		t.Fatalf("S with a stash asks Overwrite Stash?")
	}
	m = newMouseTestMission()
	m.model.CanStash = false
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"}); cmd != nil || m.menu != nil {
		t.Fatalf("S does nothing when stashing is disabled")
	}
}

// TestOverwriteStashPaintsTheBoardsTwoBodyRows: StashStates.png wraps the
// body onto two disabled rows above Overwrite (the cursor) and Cancel.
func TestOverwriteStashPaintsTheBoardsTwoBodyRows(t *testing.T) {
	m := newMouseTestMission()
	m.model.CanStash = true
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main"}
	m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"})
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"esc dismiss", "Are you sure you want to proceed? This will overwrite", "your existing stash with your current changes.", theme.GlyphBar + " Overwrite", "Cancel"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q:\n%s", want, out)
		}
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu != nil || m.focus != focusList {
		t.Fatalf("Cancel closes without emitting and returns to the list (focus %v)", m.focus)
	}
	m.Update(tea.KeyPressMsg{Code: 'S', Text: "S"})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Overwrite emits the stash and closes")
	}
}

func TestDAsksDiscardStash(t *testing.T) {
	m := stashMission(true)
	m.Update(tea.KeyPressMsg{Code: 'D', Text: "D"})
	if m.menu == nil || m.menu.Title() != "Discard Stash?" {
		t.Fatalf("D should ask Discard Stash?")
	}
	out := ansi.Strip(m.View().Content)
	if !strings.Contains(out, "Are you sure you want to discard these stashed changes?") {
		t.Fatalf("body missing:\n%s", out)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil || m.focus != focusStashFiles {
		t.Fatalf("Discard emits and returns to the stash files (focus %v)", m.focus)
	}
}

func TestDiscardStashCancelEmitsNothing(t *testing.T) {
	m := stashMission(true)
	m.Update(tea.KeyPressMsg{Code: 'D', Text: "D"})
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu != nil {
		t.Fatal("Cancel closes without emitting")
	}
}

func TestClickingDiscardAsksDiscardStash(t *testing.T) {
	m := stashMission(true)
	y := stashButtonRowY(t, m)
	_, _, ds, _ := stashHeaderButtons(m.diffWidth())
	if _, cmd := m.Update(tea.MouseClickMsg{X: sidebarWidth + 1 + ds, Y: y, Button: tea.MouseLeft}); cmd != nil || m.menu == nil || m.menu.Title() != "Discard Stash?" {
		t.Fatal("clicking Discard asks Discard Stash? and emits nothing yet")
	}
}

// TestStashDiffKeysActOnTheStash: R, D and h act on the entry from the stash
// diff exactly as they do from the stash files.
func TestStashDiffKeysActOnTheStash(t *testing.T) {
	diff := func() *Mission {
		m := stashMission(true)
		m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
		if m.focus != focusDiff || !m.diffFromStash {
			t.Fatalf("setup: enter should focus the stash diff")
		}
		return m
	}
	m := diff()
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'R', Text: "R"}); cmd == nil {
		t.Fatal("R in the stash diff emits a restore")
	}
	m = diff()
	m.Update(tea.KeyPressMsg{Code: 'D', Text: "D"})
	if m.menu == nil || m.menu.Title() != "Discard Stash?" {
		t.Fatal("D in the stash diff asks Discard Stash?")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusDiff {
		t.Fatalf("esc returns to the stash diff, got %v", m.focus)
	}
	m = diff()
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"}); cmd == nil || m.focus != focusList {
		t.Fatalf("h in the stash diff hides the view (focus %v)", m.focus)
	}
}

func TestChangesDiffLeavesTheStashKeysAlone(t *testing.T) {
	m := newMouseTestMission()
	m.model.Stash = &StashModel{Sha: "s1", Branch: "main"}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	for _, k := range []rune{'R', 'D', 'h'} {
		if _, cmd := m.Update(tea.KeyPressMsg{Code: k, Text: string(k)}); cmd != nil || m.menu != nil {
			t.Fatalf("%c in the Changes diff acts on the stash", k)
		}
	}
}

func TestCtrlKInTheStashViewOffersRestoreAndDiscard(t *testing.T) {
	m := stashMission(true)
	m.model.CanStash = true
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu == nil || m.menu.Title() != "Stashed Changes" {
		t.Fatal("ctrl-k in the stash view opens Stashed Changes")
	}
	_, items := m.menuItems(menuTarget{})
	got := strings.Join(labels(items), "|")
	if want := "Restore|Discard…|Commit|"; !strings.HasPrefix(got, want) {
		t.Fatalf("rows %q", got)
	}
	if !strings.Contains(got, "Stash All Changes…|Hide Stashed Changes") {
		t.Fatalf("board rows %q", got)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu == nil || m.menu.Title() != "Discard Stash?" {
		t.Fatal("Discard… pushes Discard Stash?")
	}
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "esc back") {
		t.Fatalf("the pushed question steps back:\n%s", out)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Discard emits and closes")
	}
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Restore emits and closes")
	}
}

func switchPromptMission(t *testing.T, hasStash bool) *Mission {
	t.Helper()
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main", HasStash: hasStash}
	pushModel(t, m, next)
	return m
}

func TestSwitchPromptOpensOncePerSeq(t *testing.T) {
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main", HasStash: true}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != "Switch Branch" {
		t.Fatalf("prompt should open Switch Branch")
	}
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{
		"You have changes on this branch. What would you like to do with them?",
		"Leave my changes on main",
		"Your in-progress work will be stashed on this branch for you to return to later",
		"Your current stash will be overwritten by creating a new stash",
		"Bring my changes to other",
		"Your in-progress work will follow you to the new branch",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q:\n%s", want, out)
		}
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	pushModel(t, m, next)
	if m.menu != nil {
		t.Fatalf("a seen seq must not reopen")
	}
	next.SwitchPrompt = &SwitchPrompt{Seq: 2, Branch: "other", Current: "main"}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != "Switch Branch" {
		t.Fatal("a new seq opens again")
	}
}

// TestSwitchPromptRowsAreTheBoards: each description sits indented under its
// option, the warning under Leave's only when the branch has a stash, and
// the cursor starts on Leave.
func TestSwitchPromptRowsAreTheBoards(t *testing.T) {
	m := switchPromptMission(t, true)
	rows := switchItems(SwitchPrompt{Branch: "other", Current: "main", HasStash: true})
	want := []string{
		"You have changes on this branch. What would you like to do with them? (disabled)",
		"Leave my changes on main",
		"  Your in-progress work will be stashed on this branch for you to return to later (disabled)",
		"  " + theme.GlyphWarn + " Your current stash will be overwritten by creating a new stash (disabled)",
		"Bring my changes to other",
		"  Your in-progress work will follow you to the new branch (disabled)",
	}
	if got := labels(rows); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("rows\n got %q\nwant %q", got, want)
	}
	if rows[0].Section == rows[1].Section {
		t.Fatal("a rule separates the body from the choices")
	}
	if got := labels(switchItems(SwitchPrompt{Branch: "other", Current: "main"})); strings.Contains(strings.Join(got, "|"), "overwritten") {
		t.Fatalf("no stash, no warning: %q", got)
	}
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, theme.GlyphBar+" Leave my changes on main") {
		t.Fatalf("the cursor bar should start on Leave:\n%s", out)
	}
}

func TestSwitchLeaveWithAStashAsksToOverwrite(t *testing.T) {
	m := switchPromptMission(t, true)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu == nil || m.menu.Title() != "Overwrite Stash?" {
		t.Fatalf("Leave with a stash goes to Overwrite Stash?")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu == nil || m.menu.Title() != "Switch Branch" {
		t.Fatal("esc steps back to Switch Branch")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Overwrite emits the leave and closes")
	}
}

func TestSwitchLeaveWithoutAStashEmitsAtOnce(t *testing.T) {
	m := switchPromptMission(t, false)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Leave without a stash should close the question and emit")
	}
}

func TestSwitchBringEmitsAtOnce(t *testing.T) {
	m := newMouseTestMission()
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main"}
	pushModel(t, m, next)
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatalf("Bring should close the question and emit")
	}
}

func TestSwitchPromptClosesAnOpenFoldout(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	next := m.model
	next.SwitchPrompt = &SwitchPrompt{Seq: 1, Branch: "other", Current: "main"}
	pushModel(t, m, next)
	if m.modal != nil || m.menu == nil {
		t.Fatal("the question replaces the foldout")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusList {
		t.Fatalf("dismissing it lands on the list, got %v", m.focus)
	}
}

// TestStashDialogsFitEveryWidth: the question paints every frame line at the
// frame's width, and a click on its painted choice runs it.
func TestStashDialogsFitEveryWidth(t *testing.T) {
	for width := 80; width <= 200; width += 7 {
		m := switchPromptMission(t, true)
		m.width = width
		frame := m.View().Content
		for y, line := range strings.Split(frame, "\n") {
			if w := ansi.StringWidth(line); w != width {
				t.Fatalf("width %d: line %d is %d wide", width, y, w)
			}
		}
		x, y := -1, -1
		for row, line := range strings.Split(ansi.Strip(frame), "\n") {
			if i := strings.Index(line, "Bring my changes"); i >= 0 {
				x, y = ansi.StringWidth(line[:i]), row
			}
		}
		if y < 0 {
			t.Fatalf("width %d: Bring never painted", width)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: x, Y: y, Button: tea.MouseLeft}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: a click on Bring runs it", width)
		}
	}
}
