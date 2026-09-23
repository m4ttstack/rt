package mission

import (
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

func labels(items []picker.MenuItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		mark := ""
		if it.Disabled {
			mark = " (disabled)"
		}
		out[i] = it.Label + mark
	}
	return out
}

func TestJsExtnameMatchesNode(t *testing.T) {
	for _, c := range [][2]string{{"a.go", ".go"}, {".gitignore", ""}, {".env.local", ".local"}, {"a.tar.gz", ".gz"}, {"Makefile", ""}, {"dir.d/file", ""}, {"a.", "."}, {"..", ""}, {"...", "."}, {"a/.b.", "."}} {
		if got := jsExtname(c[0]); got != c[1] {
			t.Errorf("jsExtname(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

func TestChangesFileMenuIsGitHubDesktops(t *testing.T) {
	m := newMouseTestMission()
	m.model.EditorLabel = "Zed"
	_, items := m.menuItems(menuTarget{kind: targetChange, path: "src/a.go", status: "modified"})
	want := []string{
		"Discard Changes…",
		"Ignore File (Add to .gitignore)",
		"Ignore Folder (Add to .gitignore)…",
		"Ignore All .go Files (Add to .gitignore)",
		"Copy File Path",
		"Copy Relative File Path",
		"Reveal in Finder",
		"Open in Zed",
		"Open with Default Program",
	}
	got := labels(items)[:len(want)]
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("rows\n got %q\nwant %q", got, want)
	}
}

func TestChangesFileMenuGatesItsRows(t *testing.T) {
	m := newMouseTestMission()
	_, items := m.menuItems(menuTarget{kind: targetChange, path: ".gitignore", status: "deleted"})
	got := strings.Join(labels(items), "|")
	for _, want := range []string{
		"Ignore File (Add to .gitignore) (disabled)",
		"Reveal in Finder (disabled)",
		"Open in External Editor (disabled)",
		"Open with Default Program (disabled)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	for _, absent := range []string{"Ignore Folder", "Ignore All"} {
		if strings.Contains(got, absent) {
			t.Errorf("a root dotfile offers no %q row", absent)
		}
	}
}

func TestChangesFileMenuWithoutExtensionOrFolderDropsThoseRows(t *testing.T) {
	m := newMouseTestMission()
	_, items := m.menuItems(menuTarget{kind: targetChange, path: "Makefile", status: "new"})
	got := strings.Join(labels(items), "|")
	for _, absent := range []string{"Ignore Folder", "Ignore All", "(disabled)"} {
		if strings.Contains(got, absent) {
			t.Errorf("a root file with no extension offers no %q: %q", absent, got)
		}
	}
}

func TestHistoryFileMenuOffDiskIsOneDisabledRow(t *testing.T) {
	m := newHistoryTestMission()
	title, items := m.menuItems(menuTarget{kind: targetHistoryFile, path: "gone.go", onDisk: false})
	if title != "gone.go" || items[0].Label != "File Does Not Exist on Disk" || !items[0].Disabled {
		t.Fatalf("got %q %q", title, labels(items))
	}
	if items[1].Section == items[0].Section {
		t.Fatal("the board-wide section follows under its own rule")
	}
}

func TestHistoryFileMenuOnDiskOpensAndCopies(t *testing.T) {
	m := newHistoryTestMission()
	m.model.EditorLabel = "Zed"
	_, items := m.menuItems(menuTarget{kind: targetHistoryFile, path: "lib/a.ts", onDisk: true})
	want := "Reveal in Finder|Open in Zed|Open with Default Program|Copy File Path|Copy Relative File Path|"
	if got := strings.Join(labels(items), "|"); !strings.HasPrefix(got, want) {
		t.Fatalf("rows %q", got)
	}
	if items[2].Section == items[3].Section {
		t.Fatal("a rule separates the open rows from the copy rows")
	}
}

func TestCommitMenuOffersUndoOnlyOnTheNewestUndoableCommit(t *testing.T) {
	m := newHistoryTestMission()
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", Undoable: true}
	_, newest := m.menuItems(menuTarget{kind: targetCommit, sha: "s1", newest: true})
	_, older := m.menuItems(menuTarget{kind: targetCommit, sha: "s2"})
	if labels(newest)[0] != "Undo Commit…" {
		t.Fatalf("newest: %q", labels(newest))
	}
	if strings.Contains(strings.Join(labels(older), "|"), "Undo Commit") {
		t.Fatal("an older commit offers no undo")
	}
	want := "Create Branch from Commit|Create Tag…|Copy SHA"
	if !strings.Contains(strings.Join(labels(older), "|"), want) {
		t.Fatalf("older: %q", labels(older))
	}
	m.model.Commit.LastCommit.Undoable = false
	if _, items := m.menuItems(menuTarget{kind: targetCommit, sha: "s1", newest: true}); labels(items)[0] == "Undo Commit…" {
		t.Fatal("the newest commit offers undo only while u would act")
	}
}

func TestBoardSectionFollowsTheTab(t *testing.T) {
	m := newMouseTestMission()
	m.model.Action.Title = "Fetch origin"
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", Undoable: true}
	title, items := m.menuItems(menuTarget{})
	want := "Commit|Fetch origin|Switch Branch…|Worktrees…|Repositories…|Filter|Undo Last Commit|Show History|Open Repository in External Editor|Reveal Repository in Finder"
	if got := strings.Join(labels(items), "|"); title != "Actions" || got != want {
		t.Fatalf("changes board %q %q", title, got)
	}
	h := newHistoryTestMission()
	h.model.Action.Title = "Fetch origin"
	_, items = h.menuItems(menuTarget{})
	want = "Fetch origin|Switch Branch…|Worktrees…|Repositories…|Filter|Expand|Show Changes|Open Repository in External Editor|Reveal Repository in Finder"
	if got := strings.Join(labels(items), "|"); got != want {
		t.Fatalf("history board %q", got)
	}
	m.model.Action.Busy = true
	if _, items = m.menuItems(menuTarget{}); !items[1].Disabled {
		t.Fatal("a busy action segment greys its row")
	}
}

func TestRightClickOnAFileRowSelectsItAndOpensItsMenuAtThePointer(t *testing.T) {
	m := newMouseTestMission()
	y := changesRowY(m, 1)
	m.Update(tea.MouseClickMsg{X: 12, Y: y, Button: tea.MouseRight})
	if m.menu == nil || m.focus != focusMenu {
		t.Fatal("right-click on a file row opens the menu")
	}
	if m.selected != m.model.Changes[1].Path {
		t.Fatalf("selected %q, want the clicked row", m.selected)
	}
	if !strings.Contains(m.View().Content, "Discard Changes…") {
		t.Fatal("the menu paints")
	}
}

func TestRightClickOnACheckboxSelectsWithoutStaging(t *testing.T) {
	m := newMouseTestMission()
	start, _ := changeRowCheckboxSpan(m.model.Changes[2])
	m.Update(tea.MouseClickMsg{X: start, Y: changesRowY(m, 2), Button: tea.MouseRight})
	if m.menu == nil || m.menuTarget.path != "c.go" || m.selected != "c.go" {
		t.Fatalf("right-click on a checkbox opens c.go's menu, got target %q", m.menuTarget.path)
	}
}

func TestCtrlKOpensTheBoardSectionAndEscCloses(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu == nil {
		t.Fatal("ctrl-k on the Changes list opens the menu")
	}
	if !strings.Contains(m.View().Content, "Switch Branch…") {
		t.Fatal("the board-wide section is listed")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu != nil || m.focus != focusList {
		t.Fatal("esc closes the menu back to the list")
	}
}

func TestCtrlKFromTheDiffTargetsTheSelectedFileAndEscReturnsThere(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu == nil || m.menuTarget.path != "a.go" || m.menu.Title() != "a.go" {
		t.Fatal("ctrl-k in the diff opens the shown file's menu")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusDiff {
		t.Fatalf("esc returns focus to the diff, got %v", m.focus)
	}
}

func TestCtrlKInATextFieldIsTheFieldsOwn(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'c', Text: "c"})
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu != nil {
		t.Fatal("ctrl-k in the summary field never opens the menu")
	}
}

func TestRightClickWithAFoldoutOpenOnlyClosesIt(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 1), Button: tea.MouseRight})
	if m.menu != nil || m.modal != nil {
		t.Fatal("a right-click outside an open foldout only closes the foldout")
	}
}

// boxCorner is the frame cell of the menu box's top-left corner.
func boxCorner(t *testing.T, m *Mission) (x, y int) {
	t.Helper()
	for row, line := range strings.Split(ansi.Strip(m.View().Content), "\n") {
		if i := strings.LastIndex(line, "╭"); i >= 0 && strings.Contains(line[i:], "╮") && lipgloss.Width(line[:i]) >= 12 {
			return lipgloss.Width(line[:i]), row
		}
	}
	t.Fatal("no menu box painted")
	return 0, 0
}

func TestRightClickAnchorsTheBoxAtThePointer(t *testing.T) {
	m := newMouseTestMission()
	m.height = 50
	y := changesRowY(m, 1)
	m.Update(tea.MouseClickMsg{X: 12, Y: y, Button: tea.MouseRight})
	if x, top := boxCorner(t, m); x != 12 || top != y {
		t.Fatalf("the box's corner is at (%d,%d), want the pointer (12,%d)", x, top, y)
	}
	m = newMouseTestMission()
	y = changesRowY(m, 1)
	m.Update(tea.MouseClickMsg{X: 12, Y: y, Button: tea.MouseRight})
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if x, top := boxCorner(t, m); x != 12 || top >= y || !strings.Contains(lines[len(lines)-1], "╰") {
		t.Fatalf("near the bottom the box slides up only as far as it must, corner (%d,%d)", x, top)
	}
}

func TestAClickOutsideTheMenuIsConsumed(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	m.View()
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: changesRowY(m, 2), Button: tea.MouseLeft}); cmd != nil || m.menu != nil || m.selected != "a.go" {
		t.Fatalf("a click outside only closes the menu, selected %q", m.selected)
	}
}

func TestANestedGitignoreGreysItsIgnoreFolderRow(t *testing.T) {
	m := newMouseTestMission()
	_, items := m.menuItems(menuTarget{kind: targetChange, path: "a/.gitignore", status: "modified"})
	got := strings.Join(labels(items), "|")
	if !strings.Contains(got, "Ignore Folder (Add to .gitignore)… (disabled)") || strings.Contains(got, "Ignore All") {
		t.Fatalf("rows %q", got)
	}
}

func TestARightClickNeverCompletesADoubleClick(t *testing.T) {
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	step := func() time.Time { now = now.Add(100 * time.Millisecond); return now }
	m := newMouseTestMission()
	m.nowFn = step
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 1), Button: tea.MouseLeft})
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 1), Button: tea.MouseRight})
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusList {
		t.Fatalf("left then right on one row must not read as a double click, focus %v", m.focus)
	}
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 1), Button: tea.MouseLeft})
	if m.focus != focusList {
		t.Fatalf("right then left on one row must not read as a double click, focus %v", m.focus)
	}
}

func TestRightClickOffAnyRowOpensNothing(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.MouseClickMsg{X: m.width - 2, Y: changesRowY(m, 0), Button: tea.MouseRight})
	if m.menu != nil {
		t.Fatal("a right-click on the diff pane opens no menu")
	}
}

func TestBoardRowReplaysItsKey(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	for _, r := range "switch" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu != nil || m.modal == nil || m.modal.zone != zoneBranch {
		t.Fatal("Switch Branch… opens the branch foldout exactly as b does")
	}
}

func TestAMenuSwallowsPlainKeysAsItsFilter(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'q', Text: "q"}); cmd != nil || m.menu == nil {
		t.Fatal("q filters the open menu and never quits")
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 's', Mod: tea.ModCtrl}); cmd != nil || m.menu == nil {
		t.Fatal("a chord the menu does not own does nothing while it is open")
	}
}

func TestDiscardAsksBeforeItActs(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 0), Button: tea.MouseRight})
	_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd != nil || m.menu == nil || !strings.HasPrefix(m.menu.Title(), "Discard all changes to") {
		t.Fatal("Discard Changes… asks first and emits nothing yet")
	}
	_, cmd = m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil || m.menu != nil {
		t.Fatal("confirming emits and closes")
	}
}

func TestDiscardQuestionNamesTheFileAndCancelEmitsNothing(t *testing.T) {
	m := newMouseTestMission()
	m.model.Changes[0].Path = "commands/git/inspect.ts"
	m.selected = "commands/git/inspect.ts"
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if got := m.menu.Title(); got != "Discard all changes to inspect.ts?" {
		t.Fatalf("question title %q", got)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu != nil {
		t.Fatal("Cancel closes without emitting")
	}
}

func TestIgnoreFolderListsEveryAncestorDeepestFirst(t *testing.T) {
	m := newMouseTestMission()
	m.model.Changes[0].Path = "commands/git/inspect.ts"
	m.selected = "commands/git/inspect.ts"
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	for _, r := range "ignore folder" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu == nil || m.menu.Title() != "Ignore Folder (Add to .gitignore)" {
		t.Fatal("Ignore Folder… asks which folder")
	}
	deep, shallow := -1, -1
	for y, line := range strings.Split(ansi.Strip(m.View().Content), "\n") {
		switch {
		case strings.Contains(line, "/commands/git"):
			deep = y
		case strings.Contains(line, "/commands"):
			shallow = y
		}
	}
	if deep < 0 || shallow <= deep {
		t.Fatalf("the step lists /commands/git above /commands, got rows %d and %d", deep, shallow)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("choosing a folder emits and closes")
	}
}

func TestCreateTagAsksForAName(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menuTarget.sha != "s1" || m.menu.Title() != "Fix pty paint predicate" {
		t.Fatalf("ctrl-k on the History list opens the cursor commit's menu, got %+v", m.menuTarget)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu.Title() != "Create a Tag" {
		t.Fatal("Create Tag… asks for a name first")
	}
	for _, r := range "v9" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("enter with a name emits and closes")
	}
}

func TestCreateBranchFromCommitOpensTheBranchFoldoutNaming(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu != nil || m.modal == nil || m.modal.zone != zoneBranch || !m.modal.naming {
		t.Fatal("Create Branch from Commit opens the branch foldout already naming")
	}
	if m.modal.action.label != "New branch from s1…" {
		t.Fatalf("action row %q", m.modal.action.label)
	}
	if got := string(m.modal.action.buildPayload("x")); !strings.Contains(got, `"from":"s1"`) || !strings.Contains(got, `"new":true`) {
		t.Fatalf("payload %s", got)
	}
}

func TestRightClickOnACommitSelectsItAndOpensItsMenu(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.MouseClickMsg{X: 4, Y: historyRowFrameY(t, m, "Guard badges"), Button: tea.MouseRight})
	if m.menu == nil || m.historyCursor != "s2" || m.menuTarget.sha != "s2" || m.menu.Title() != "Guard badges" {
		t.Fatalf("right-click selects s2 and opens its menu, cursor %q target %+v", m.historyCursor, m.menuTarget)
	}
}

func TestRightClickInsideARangeOpensTheBoardSectionOnly(t *testing.T) {
	m := newHistoryTestMission()
	m.historyAnchor, m.historyCursor = "s1", "s2"
	m.Update(tea.MouseClickMsg{X: 4, Y: historyRowFrameY(t, m, "Guard badges"), Button: tea.MouseRight})
	if m.menu == nil || m.menu.Title() != "Actions" || m.historyAnchor != "s1" {
		t.Fatal("right-click inside the range keeps it and opens the board-wide section")
	}
	if strings.Contains(ansi.Strip(m.View().Content), "Copy SHA") {
		t.Fatal("a range offers no single-commit rows")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu.Title() != "Actions" {
		t.Fatal("ctrl-k with a range selected opens the board-wide section")
	}
}

func historyFileFrameY(t *testing.T, m *Mission, name string) int {
	t.Helper()
	filesW := historyFilesWidth(m.diffWidth())
	for y, line := range strings.Split(ansi.Strip(m.View().Content), "\n") {
		if strings.Contains(ansi.Cut(line, historyPaneX(0), historyPaneX(filesW)), name) {
			return y
		}
	}
	t.Fatalf("no file row shows %q", name)
	return -1
}

func TestRightClickOnAHistoryFileOpensItsMenu(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.MouseClickMsg{X: historyPaneX(4), Y: historyFileFrameY(t, m, "lib/mission/model.ts"), Button: tea.MouseRight})
	if m.menu == nil || m.menuTarget.kind != targetHistoryFile || m.menuTarget.path != "lib/mission/model.ts" {
		t.Fatalf("right-click on a History file opens its menu, got %+v", m.menuTarget)
	}
	if !strings.Contains(ansi.Strip(m.View().Content), "File Does Not Exist on Disk") {
		t.Fatal("the fixture's file is not on disk")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusHistoryFiles {
		t.Fatalf("esc returns to the file column, got %v", m.focus)
	}
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menuTarget.kind != targetHistoryFile {
		t.Fatal("ctrl-k in the file column targets the file")
	}
}

func TestAPushWhileTheMenuIsOpenKeepsItsTarget(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 0), Button: tea.MouseRight})
	model := mouseFixtureModel()
	model.Changes = model.Changes[1:]
	model.Tab = "history"
	pushModel(t, m, model)
	if m.menu == nil || m.focus != focusMenu || m.menuTarget.path != "a.go" || m.menu.Title() != "a.go" {
		t.Fatalf("a push never closes or retargets the menu, focus %v target %+v", m.focus, m.menuTarget)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusList {
		t.Fatalf("closing after a tab switch lands on the list, got %v", m.focus)
	}
}

func TestTheWheelNeverReachesTheBoardUnderAMenu(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if _, cmd := m.Update(tea.MouseWheelMsg{X: 12, Y: changesRowY(m, 0), Button: tea.MouseWheelDown}); cmd != nil || m.selected != "a.go" {
		t.Fatal("the wheel moves nothing under an open menu")
	}
}

func TestTheShortestChangesFramePaintsItsHeightAndHitsItsDock(t *testing.T) {
	m := newMouseTestMission()
	m.height = 27
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", When: "now", Undoable: true}
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if len(lines) != m.height {
		t.Fatalf("a frame with no room for a Changes row is %d lines, want %d", len(lines), m.height)
	}
	for y, line := range lines {
		if x := strings.Index(line, "Undo"); x >= 0 && strings.Contains(line, "Committed") {
			if h := m.hitTest(lipgloss.Width(line[:x]), y); h.kind != hitUndoChip {
				t.Fatalf("the Undo chip paints on row %d but hits %+v there", y, h)
			}
			return
		}
	}
	t.Fatal("the undo strip never painted")
}

// tallMenuMission is the Changes tab at 27 rows, the shortest frame its
// docked commit block fits in, with a nested file and Undo showing: the
// file's menu is 28 lines, one more than the frame.
func tallMenuMission(width int) *Mission {
	m := newMouseTestMission()
	m.width, m.height = width, 27
	m.model.Action.Title = "Fetch origin"
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", When: "now", Undoable: true}
	m.model.Changes[0].Path = "src/a.go"
	m.selected = "src/a.go"
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	return m
}

func paintedAt(m *Mission, label string) (x, y int, ok bool) {
	for row, line := range strings.Split(ansi.Strip(m.View().Content), "\n") {
		if i := strings.Index(line, label); i >= 0 {
			return lipgloss.Width(line[:i]), row, true
		}
	}
	return 0, 0, false
}

func TestAMenuTallerThanTheFrameFitsAndScrollsAtEveryWidth(t *testing.T) {
	const last = "Reveal Repository in Finder"
	for width := 80; width <= 200; width += 7 {
		m := tallMenuMission(width)
		lines := strings.Split(m.View().Content, "\n")
		if len(lines) != m.height {
			t.Fatalf("width %d: the frame is %d lines with the menu open, want %d", width, len(lines), m.height)
		}
		for y, line := range lines {
			if w := lipgloss.Width(line); w != width {
				t.Fatalf("width %d: line %d is %d wide", width, y, w)
			}
		}
		if _, _, ok := paintedAt(m, last); ok {
			t.Fatalf("width %d: the last board row starts below the window", width)
		}
		for range 30 {
			m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
		}
		if _, _, ok := paintedAt(m, last); !ok {
			t.Fatalf("width %d: the keyboard never scrolled the last board row into view", width)
		}
		if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: enter on the last board row runs it", width)
		}

		m = tallMenuMission(width)
		x, y, _ := paintedAt(m, "Discard Changes…")
		for range 4 {
			m.Update(tea.MouseWheelMsg{X: x, Y: y, Button: tea.MouseWheelDown})
		}
		x, y, ok := paintedAt(m, last)
		if !ok {
			t.Fatalf("width %d: the wheel never scrolled the last board row into view", width)
		}
		m.Update(tea.MouseMotionMsg{X: x, Y: y})
		if row := strings.Split(m.View().Content, "\n")[y]; !strings.Contains(row, bgSGR(theme.HoverBg)) {
			t.Fatalf("width %d: hovering the scrolled-in row did not paint HoverBg on it", width)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: x, Y: y, Button: tea.MouseLeft}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: a click on the scrolled-in row runs it", width)
		}
	}
}

func TestAnAnchoredMenuFitsAShortHistoryFrame(t *testing.T) {
	m := newHistoryTestMission()
	m.height = 20
	m.model.Action.Title = "Fetch origin"
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", When: "now", Undoable: true}
	m.Update(tea.MouseClickMsg{X: 4, Y: historyRowFrameY(t, m, "Fix pty paint predicate"), Button: tea.MouseRight})
	if lines := strings.Split(m.View().Content, "\n"); len(lines) != m.height {
		t.Fatalf("the frame is %d lines with a right-click menu open, want %d", len(lines), m.height)
	}
	for range 20 {
		m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	}
	if _, _, ok := paintedAt(m, "Reveal Repository in Finder"); !ok {
		t.Fatal("the keyboard reaches the last board row of an anchored menu")
	}
}

func TestAKeyRowRunsTheKeyOfTheTabItOpenedOn(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	model := mouseFixtureModel()
	model.Tab = "history"
	pushModel(t, m, model)
	for _, r := range "commit" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.focus != focusSummary {
		t.Fatalf("a Changes menu's Commit row runs Changes' c even after a tab switch, focus %v", m.focus)
	}
}

func TestAHistoryKeyRowKeepsTheFocusTheKeyWould(t *testing.T) {
	m := newHistoryTestMission()
	m.focus = focusHistoryFiles
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	for _, r := range "expand" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !m.historyExpanded || m.focus != focusHistoryFiles {
		t.Fatalf("Expand from the file column toggles and keeps focus there, as e does: expanded %v focus %v", m.historyExpanded, m.focus)
	}
}

func TestMenuHitMatchesPaintAtEveryWidth(t *testing.T) {
	for width := 80; width <= 200; width += 7 {
		m := newMouseTestMission()
		m.width = width
		m.Update(tea.MouseClickMsg{X: sidebarWidth - 2, Y: changesRowY(m, 0), Button: tea.MouseRight})
		frame := m.View().Content
		for y, line := range strings.Split(frame, "\n") {
			if w := lipgloss.Width(line); w != width {
				t.Fatalf("width %d: line %d is %d wide", width, y, w)
			}
		}
		rowX, rowY := -1, -1
		for y, line := range strings.Split(ansi.Strip(frame), "\n") {
			if x := strings.Index(line, "Copy File Path"); x >= 0 {
				rowX, rowY = lipgloss.Width(line[:x]), y
			}
		}
		if rowY < 0 {
			t.Fatalf("width %d: the menu row never painted", width)
		}
		m.Update(tea.MouseMotionMsg{X: rowX, Y: rowY})
		if hovered := strings.Split(m.View().Content, "\n")[rowY]; !strings.Contains(hovered, bgSGR(theme.HoverBg)) {
			t.Fatalf("width %d: hovering the painted row did not paint HoverBg on it", width)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: rowX, Y: rowY, Button: tea.MouseLeft}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: a click on the painted row must run it and close the menu", width)
		}
	}
}

func TestHistoryMenuHitMatchesPaintAtEveryWidth(t *testing.T) {
	for width := 80; width <= 200; width += 7 {
		m := newHistoryTestMission()
		m.width = width
		m.Update(tea.MouseClickMsg{X: 4, Y: historyRowFrameY(t, m, "Guard badges"), Button: tea.MouseRight})
		frame := m.View().Content
		lines := strings.Split(frame, "\n")
		if len(lines) != m.height {
			t.Fatalf("width %d: the frame is %d lines, want %d", width, len(lines), m.height)
		}
		for y, line := range lines {
			if w := lipgloss.Width(line); w != width {
				t.Fatalf("width %d: line %d is %d wide", width, y, w)
			}
		}
		rowX, rowY := -1, -1
		for y, line := range strings.Split(ansi.Strip(frame), "\n") {
			if x := strings.Index(line, "Copy SHA"); x >= 0 {
				rowX, rowY = lipgloss.Width(line[:x]), y
			}
		}
		if rowY < 0 {
			t.Fatalf("width %d: Copy SHA never painted", width)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: rowX, Y: rowY, Button: tea.MouseLeft}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: a click on the painted row must run it and close the menu", width)
		}
	}
}
