package mission

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func historyFixtureModel() Model {
	return Model{
		Tab:     "history",
		Current: Current{Repo: "repo-tools", Branch: "main"},
		History: HistoryModel{
			Commits: []HistoryCommitRow{
				{Sha: "s1", ShortSha: "s1", Summary: "Fix pty paint predicate", Byline: "Matt", When: "3 hours ago", Unpushed: true, Selected: true},
				{Sha: "s2", ShortSha: "s2", Summary: "Guard badges", Byline: "Matt", When: "5 hours ago", Tags: []string{"v0.9.1"}},
				{Sha: "s3", ShortSha: "s3", Summary: "", Byline: "Matt, Claude", When: "1 day ago"},
			},
			Header:       &HistoryHeader{Summary: "Fix pty paint predicate", Byline: "Matt", Authors: []string{"Matt <m@x>"}, Sha: "s1full", ShortSha: "s1", LinesAdded: 12, LinesDeleted: 4, RangeCount: 1, Contiguous: true},
			Files:        []HistoryFileRow{{Path: "lib/mission/model.ts", Status: "modified"}},
			SelectedFile: "lib/mission/model.ts",
		},
		Diff: DiffModel{Path: "lib/mission/model.ts", Kind: "text", ReadOnly: true, Lines: []DiffLine{{Kind: "add", Text: "x", NewNo: 1, SelIdx: -1}}},
	}
}

func newHistoryTestMission() *Mission {
	m := New(nil)
	m.width, m.height = 130, 38
	_ = m.setModelValue(historyFixtureModel())
	return m
}

// setModelValue pushes model through SetModel exactly as a real wire push
// arrives, so every clamp SetModel runs applies.
func (m *Mission) setModelValue(model Model) error {
	raw, err := json.Marshal(model)
	if err != nil {
		return err
	}
	return m.SetModel(raw)
}

// cellBackgrounds returns, per visible column of one rendered line, the
// background SGR fragment ("48;2;r;g;b") in effect for that cell, "" where
// none is.
func cellBackgrounds(line string) []string {
	var cells []string
	bg := ""
	i := 0
	for i < len(line) {
		if loc := sgrParamsRe.FindStringIndex(line[i:]); loc != nil && loc[0] == 0 {
			params := strings.Split(sgrParamsRe.FindStringSubmatch(line[i:])[1], ";")
			for pi := 0; pi < len(params); pi++ {
				switch params[pi] {
				case "", "0", "49":
					bg = ""
				case "38":
					if pi+1 < len(params) && params[pi+1] == "2" {
						pi += 4
					} else if pi+1 < len(params) && params[pi+1] == "5" {
						pi += 2
					}
				case "48":
					if pi+4 < len(params) && params[pi+1] == "2" {
						bg = strings.Join(params[pi:pi+5], ";")
						pi += 4
					} else if pi+2 < len(params) && params[pi+1] == "5" {
						bg = strings.Join(params[pi:pi+3], ";")
						pi += 2
					}
				}
			}
			i += loc[1]
			continue
		}
		r := []rune(line[i:])[0]
		for range lipgloss.Width(string(r)) {
			cells = append(cells, bg)
		}
		i += len(string(r))
	}
	return cells
}

// sidebarPart cuts a full frame line down to the sidebar's own columns.
func sidebarPart(line string) string {
	return ansi.Truncate(line, sidebarWidth, "")
}

func TestTabStripMarksHistoryActive(t *testing.T) {
	out := renderTabsRow(3, "history", false, sidebarWidth)
	plain := ansi.Strip(out)
	for _, want := range []string{"Changes", "History"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("tab strip missing %q:\n%s", want, plain)
		}
	}
	if strings.Contains(plain, " v2") {
		t.Fatalf("the v2 marker must be gone:\n%s", plain)
	}
	lines := strings.Split(out, "\n")
	if len(lines) != 3 {
		t.Fatalf("tab strip should stay 3 rows, got %d", len(lines))
	}
	if w := lipgloss.Width(lines[2]); w != sidebarWidth {
		t.Fatalf("underline should span %d cells, got %d", sidebarWidth, w)
	}
	pinkAt := strings.Index(lines[2], fgSGR(theme.Pink))
	ruleAt := strings.Index(lines[2], fgSGR(theme.Rule))
	if pinkAt < 0 || ruleAt < 0 || pinkAt < ruleAt {
		t.Fatalf("with History active the Rule run (Changes half) must precede the Pink run (History half): %q", lines[2])
	}
	label := ansi.Strip(lines[1])
	if idx := strings.Index(label, "History"); lipgloss.Width(label[:idx]) < sidebarWidth/2 {
		t.Fatalf("History label should sit in the right half: %q", label)
	}
	if !strings.Contains(lines[1], "1;"+fgSGR(theme.Text)) && !strings.Contains(lines[1], fgSGR(theme.Text)+";1") {
		t.Fatalf("the active History label should be bold Text: %q", lines[1])
	}
}

func TestTabHoverOnlyOnInactiveHalf(t *testing.T) {
	half := sidebarWidth / 2
	hover := bgSGR(theme.HoverBg)
	lines := strings.Split(renderTabsRow(3, "history", true, sidebarWidth), "\n")
	for _, row := range []int{0, 1} {
		cells := cellBackgrounds(lines[row])
		if len(cells) != sidebarWidth {
			t.Fatalf("row %d should be %d cells, got %d", row, sidebarWidth, len(cells))
		}
		for x, bg := range cells {
			if x < half && bg != hover {
				t.Fatalf("row %d col %d: the inactive Changes half must hover, got %q", row, x, bg)
			}
			if x >= half && bg == hover {
				t.Fatalf("row %d col %d: the active History half must never hover", row, x)
			}
		}
	}
	if strings.Contains(lines[2], hover) {
		t.Fatalf("the underline row must never take hover: %q", lines[2])
	}
}

func TestHistorySidebarPaintsTwoLineRows(t *testing.T) {
	m := newHistoryTestMission()
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"Fix pty paint predicate", "Matt · 3 hours ago", "Guard badges", "v0.9.1", "Empty commit message"} {
		if !strings.Contains(out, want) {
			t.Fatalf("History sidebar missing %q:\n%s", want, out)
		}
	}
	if row := sidebarPart(lineContaining(t, out, "Fix pty paint predicate")); !strings.Contains(row, "↑") {
		t.Fatalf("the unpushed commit's row should carry ↑: %q", row)
	}
	if row := sidebarPart(lineContaining(t, out, "Guard badges")); strings.Contains(row, "↑") {
		t.Fatalf("a pushed commit's row must not carry ↑: %q", row)
	}
}

func TestCommitRowNeverWraps(t *testing.T) {
	width := sidebarWidth - 1
	summaries := []string{strings.Repeat("x", 300), "修正する修正する修正する修正する修正する修正する", ""}
	variants := []HistoryCommitRow{
		{Byline: "Matt", When: "3 hours ago"},
		{Byline: "Matt, Claude", When: "1 day ago", Tags: []string{"v0.9.1", "v0.9.0"}, Unpushed: true},
		{Byline: strings.Repeat("Author ", 20), When: "2 days ago", Tags: []string{strings.Repeat("t", 80)}},
	}
	for _, s := range summaries {
		for vi, v := range variants {
			for _, flags := range [][3]bool{{false, false, false}, {true, true, false}, {false, false, true}} {
				c := v
				c.Summary = s
				a, b := renderCommitRow(c, width, flags[0], flags[1], flags[2])
				for li, line := range []string{a, b} {
					if strings.Contains(line, "\n") {
						t.Fatalf("summary %q variant %d line %d wrapped: %q", s, vi, li, line)
					}
					if w := lipgloss.Width(line); w != width {
						t.Fatalf("summary %q variant %d line %d: width %d, want %d: %q", s, vi, li, w, width, line)
					}
				}
			}
		}
	}
}

func TestDownMovesHistoryCursorAndDebouncesSelect(t *testing.T) {
	instantSelectTick(t)
	m := newHistoryTestMission()
	_, cmd := m.Update(downKey())
	if m.historyCursor != "s2" {
		t.Fatalf("down should move the cursor to s2, got %q", m.historyCursor)
	}
	if cmd == nil {
		t.Fatal("a cursor move must schedule a debounce tick")
	}
	msg := cmd()
	if _, ok := msg.(historyDebounceMsg); !ok {
		t.Fatalf("the move's cmd must resolve to a historyDebounceMsg, got %#v", msg)
	}
	if _, emit := m.Update(msg); emit == nil {
		t.Fatal("a settled tick whose generation still matches must emit")
	}
}

func TestStaleHistoryDebounceTickIsNoOp(t *testing.T) {
	instantSelectTick(t)
	m := newHistoryTestMission()
	_, first := m.Update(downKey())
	_, second := m.Update(downKey())
	if _, r := m.Update(first()); r != nil {
		t.Fatal("a superseded tick must not emit")
	}
	if _, r := m.Update(second()); r == nil {
		t.Fatal("the latest tick must emit")
	}
}

// TestHistoryMoveAtEdgeSchedulesNothing: the driver's select reloads the
// changeset and resets its file cursor, so a move that cannot change the
// selection must not schedule one.
func TestHistoryMoveAtEdgeSchedulesNothing(t *testing.T) {
	m := newHistoryTestMission()
	if _, cmd := m.Update(upKey()); cmd != nil {
		t.Fatal("up on the newest commit must not schedule a select")
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyUp, Mod: tea.ModShift}); cmd != nil {
		t.Fatal("shift+up on the newest commit must not schedule a select")
	}
	if _, cmd := m.Update(tea.MouseWheelMsg{X: 5, Y: m.layout().topH + historyFixedTopRows, Button: tea.MouseWheelUp}); cmd != nil {
		t.Fatal("wheel up on the newest commit must not schedule a select")
	}
	m.historyCursor, m.historyAnchor = "s3", ""
	if _, cmd := m.Update(downKey()); cmd != nil {
		t.Fatal("down on the last commit must not schedule a select")
	}
	m.historyAnchor = "s2"
	if _, cmd := m.Update(downKey()); cmd == nil {
		t.Fatal("a plain move that collapses a range changes the selection and must still schedule a select")
	}
}

func TestShiftDownExtendsRange(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift})
	if m.historyAnchor != "s1" || m.historyCursor != "s2" {
		t.Fatalf("shift+down should anchor s1 and move to s2, got anchor=%q cursor=%q", m.historyAnchor, m.historyCursor)
	}
	if got := m.historySelectionShas(); strings.Join(got, ",") != "s1,s2" {
		t.Fatalf("selection should be s1,s2 newest first, got %v", got)
	}
	m.Update(downKey())
	if m.historyAnchor != "" {
		t.Fatalf("a plain move must clear the anchor, got %q", m.historyAnchor)
	}
	if got := m.historySelectionShas(); strings.Join(got, ",") != "s3" {
		t.Fatalf("selection after a plain move should be the cursor alone, got %v", got)
	}
}

func TestRangeRowsPaintSelBg(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift})
	out := m.View().Content
	for _, summary := range []string{"Fix pty paint predicate", "Guard badges"} {
		if row := sidebarPart(lineContaining(t, out, summary)); !strings.Contains(row, bgSGR(theme.SelBg)) {
			t.Fatalf("range row %q should wear SelBg: %q", summary, row)
		}
	}
	if row := sidebarPart(lineContaining(t, out, "Empty commit message")); strings.Contains(row, bgSGR(theme.SelBg)) {
		t.Fatalf("a row outside the range must not wear SelBg: %q", row)
	}
}

func pagingCommits(n int) []HistoryCommitRow {
	commits := make([]HistoryCommitRow, n)
	for i := range commits {
		commits[i] = HistoryCommitRow{Sha: fmt.Sprintf("c%02d", i), Summary: fmt.Sprintf("commit %d", i), Byline: "Matt", When: "1 day ago"}
	}
	return commits
}

func pagingMission(t *testing.T, commits []HistoryCommitRow) *Mission {
	t.Helper()
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: commits, HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	return m
}

// batchSize reports how many commands a returned cmd carries: a lone
// debounce tick resolves (under instantSelectTick) to a historyDebounceMsg;
// a tick plus a page request resolves to a two-command tea.BatchMsg.
func batchSize(t *testing.T, cmd tea.Cmd) int {
	t.Helper()
	if cmd == nil {
		return 0
	}
	switch msg := cmd().(type) {
	case tea.BatchMsg:
		return len(msg)
	case historyDebounceMsg:
		return 1
	default:
		t.Fatalf("unexpected cmd result %#v", msg)
		return 0
	}
}

func TestPagingRequestsMoreOncePerPage(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	m.historyCursor = "c24"
	_, cmd := m.Update(downKey())
	if m.historyIndex(m.historyCursor) != 25 {
		t.Fatalf("setup: cursor should sit at index 25, got %q", m.historyCursor)
	}
	if m.historyMoreFor != 30 {
		t.Fatalf("a move inside the threshold should request the next page for 30 commits, historyMoreFor=%d", m.historyMoreFor)
	}
	if n := batchSize(t, cmd); n != 2 {
		t.Fatalf("the move should batch a debounce tick and a page request, got %d cmds", n)
	}
	_, cmd = m.Update(downKey())
	if m.historyMoreFor != 30 {
		t.Fatalf("a second move must not re-arm the request, historyMoreFor=%d", m.historyMoreFor)
	}
	if n := batchSize(t, cmd); n != 1 {
		t.Fatalf("a second move inside the same page must carry only its debounce tick, got %d cmds", n)
	}
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(40), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	m.historyCursor = "c34"
	_, cmd = m.Update(downKey())
	if m.historyMoreFor != 40 {
		t.Fatalf("a landed page should allow the next request, historyMoreFor=%d", m.historyMoreFor)
	}
	if n := batchSize(t, cmd); n != 2 {
		t.Fatalf("the next page's request should batch with the tick, got %d cmds", n)
	}
}

// TestPagingReArmsAfterReload: the driver reloads to one batch on a HEAD
// move or a worktree switch and drops any page still in flight, so a list
// that came back shorter or under a new tip must be able to page again even
// at the length the last request went out for.
func TestPagingReArmsAfterReload(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	m.historyCursor = "c24"
	m.Update(downKey())
	if m.historyMoreFor != 30 {
		t.Fatalf("setup: the first page request should go out, historyMoreFor=%d", m.historyMoreFor)
	}
	newTip := append([]HistoryCommitRow{{Sha: "tip", Summary: "new commit"}}, pagingCommits(29)...)
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: newTip, HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	m.historyCursor = "c23"
	_, cmd := m.Update(downKey())
	if m.historyMoreFor != 30 || batchSize(t, cmd) != 2 {
		t.Fatalf("a reload under a new tip must re-arm paging, historyMoreFor=%d", m.historyMoreFor)
	}

	m = pagingMission(t, pagingCommits(30))
	m.historyCursor = "c24"
	m.Update(downKey())
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(40), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	m.historyCursor = "c24"
	if _, cmd := m.Update(downKey()); batchSize(t, cmd) != 2 {
		t.Fatal("a list that shrank back to one batch must re-arm paging")
	}
}

func TestPagingSilentWithoutMoreOrWhileLoading(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: false}}); err != nil {
		t.Fatal(err)
	}
	m.historyCursor = "c28"
	if _, cmd := m.Update(downKey()); batchSize(t, cmd) != 1 || m.historyMoreFor != -1 {
		t.Fatalf("no page request without hasMore, historyMoreFor=%d", m.historyMoreFor)
	}
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true, Loading: true}}); err != nil {
		t.Fatal(err)
	}
	if _, cmd := m.Update(upKey()); batchSize(t, cmd) != 1 || m.historyMoreFor != -1 {
		t.Fatalf("no page request while loading, historyMoreFor=%d", m.historyMoreFor)
	}
}

func TestSetModelAdoptsDriverSelectionWhenCursorFallsOff(t *testing.T) {
	m := newHistoryTestMission()
	m.historyCursor = "gone"
	m.historyAnchor = "s1"
	model := historyFixtureModel()
	model.History.Commits[0].Selected = false
	model.History.Commits[1].Selected = true
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	if m.historyCursor != "s2" {
		t.Fatalf("a cursor that fell off the list should adopt the driver's selection s2, got %q", m.historyCursor)
	}
	if m.historyAnchor != "" {
		t.Fatalf("adopting the driver's selection must clear the anchor, got %q", m.historyAnchor)
	}
}

func TestSetModelKeepsCursorWhileListed(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift})
	if err := m.setModelValue(historyFixtureModel()); err != nil {
		t.Fatal(err)
	}
	if m.historyCursor != "s2" || m.historyAnchor != "s1" {
		t.Fatalf("a push that still lists the cursor must keep cursor and anchor, got cursor=%q anchor=%q", m.historyCursor, m.historyAnchor)
	}
}

func TestHitTestResolvesCommitRowsAndTab(t *testing.T) {
	m := newHistoryTestMission()
	m.View()
	l := m.layout()
	y, ok := findHitY(m, 2, hitCommitRow)
	if !ok {
		t.Fatal("no row resolves to a commit row")
	}
	if want := l.topH + historyFixedTopRows; y != want {
		t.Fatalf("first commit row should resolve at y=%d, got %d", want, y)
	}
	if h := m.hitTest(2, y); h.idx != 0 {
		t.Fatalf("first commit row should be index 0, got %+v", h)
	}
	if h := m.hitTest(2, y+1); h.kind != hitCommitRow || h.idx != 0 {
		t.Fatalf("the byline row should resolve to the same commit, got %+v", h)
	}
	if h := m.hitTest(2, y+2); h.kind != hitCommitRow || h.idx != 1 {
		t.Fatalf("the next row pair should be commit 1, got %+v", h)
	}
	if h := m.hitTest(1, l.topH+1); h.kind != hitTab || h.idx != 0 {
		t.Fatalf("the inactive Changes half should resolve to hitTab idx 0, got %+v", h)
	}
	if h := m.hitTest(sidebarWidth-2, l.topH+1); h.kind != hitNone {
		t.Fatalf("the active History half must be inert, got %+v", h)
	}
	if h := m.hitTest(2, l.topH+2); h.kind != hitNone {
		t.Fatalf("the underline row must be inert, got %+v", h)
	}
	if h := m.hitTest(2, l.topH+3); h.kind != hitNone {
		t.Fatalf("the tabs-gap row must be inert, got %+v", h)
	}
}

// TestHistorySidebarHitMirrorsRenderedRows walks the painted frame: every
// commit's summary row and the byline row under it resolve to that commit,
// and the filler rows below the last commit resolve to nothing.
func TestHistorySidebarHitMirrorsRenderedRows(t *testing.T) {
	m := newHistoryTestMission()
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	summaries := []string{"Fix pty paint predicate", "Guard badges", "Empty commit message"}
	last := 0
	for idx, summary := range summaries {
		y := -1
		for i, line := range lines {
			if strings.Contains(sidebarPart(line), summary) {
				y = i
				break
			}
		}
		if y < 0 {
			t.Fatalf("summary %q not painted", summary)
		}
		for _, row := range []int{y, y + 1} {
			if h := m.hitTest(2, row); h.kind != hitCommitRow || h.idx != idx {
				t.Fatalf("row %d (commit %d %q) resolved to %+v", row, idx, summary, h)
			}
		}
		last = y + 1
	}
	if h := m.hitTest(2, last+1); h.kind != hitNone {
		t.Fatalf("the filler row below the last commit must be inert, got %+v", h)
	}
}

func TestMouseMotionSetsHoverCommitAndClears(t *testing.T) {
	m := newHistoryTestMission()
	y := m.layout().topH + historyFixedTopRows + historyRowHeight
	m.Update(tea.MouseMotionMsg{X: 5, Y: y})
	if m.hoverCommit != 1 {
		t.Fatalf("motion over commit 1 should set hoverCommit=1, got %d", m.hoverCommit)
	}
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[y]); !strings.Contains(row, bgSGR(theme.HoverBg)) {
		t.Fatalf("the hovered commit row should paint HoverBg: %q", row)
	}
	m.Update(tea.MouseMotionMsg{X: sidebarWidth, Y: y})
	if m.hoverCommit != -1 {
		t.Fatalf("motion over the divider should clear hoverCommit, got %d", m.hoverCommit)
	}
}

func TestMouseMotionOverInactiveTabSetsHoverTab(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.MouseMotionMsg{X: 1, Y: m.layout().topH + 1})
	if !m.hoverTab {
		t.Fatal("motion over the inactive Changes half should set hoverTab")
	}
	m.Update(tea.MouseMotionMsg{X: 0, Y: 0})
	if m.hoverTab {
		t.Fatal("hoverTab should clear once the pointer leaves the tab")
	}
}

func TestClickCommitRowSelectsAndShiftClickExtends(t *testing.T) {
	m := newHistoryTestMission()
	y := m.layout().topH + historyFixedTopRows + 2*historyRowHeight
	_, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft})
	if cmd == nil || m.historyCursor != "s3" || m.historyAnchor != "" {
		t.Fatalf("a click should select s3 and emit, got cursor=%q anchor=%q cmd=%v", m.historyCursor, m.historyAnchor, cmd != nil)
	}
	y = m.layout().topH + historyFixedTopRows
	_, cmd = m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft, Mod: tea.ModShift})
	if cmd == nil {
		t.Fatal("a shift+click should emit")
	}
	if got := strings.Join(m.historySelectionShas(), ","); got != "s1,s2,s3" {
		t.Fatalf("shift+click should extend to s1..s3, got %q", got)
	}
}

// TestTabSwitchClearsStaleTabHover: the pointer that clicked the inactive
// half now rests on the active one, and no motion arrives to clear hoverTab,
// so the push that switches tabs must not repaint HoverBg on the half that
// just became inactive.
func TestTabSwitchClearsStaleTabHover(t *testing.T) {
	m := newMouseTestMission()
	y := m.layout().topH + 1
	m.Update(tea.MouseMotionMsg{X: sidebarWidth - 2, Y: y})
	if _, cmd := m.Update(tea.MouseClickMsg{X: sidebarWidth - 2, Y: y, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("setup: clicking the History half should emit mission:tab")
	}
	if err := m.setModelValue(historyFixtureModel()); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(m.View().Content, "\n")
	for _, row := range []int{y - 1, y} {
		for x, bg := range cellBackgrounds(lines[row])[:sidebarWidth] {
			if bg == bgSGR(theme.HoverBg) {
				t.Fatalf("frame row %d col %d: the switch left a stale tab hover on the new inactive half", row, x)
			}
		}
	}
}

// TestClickShowingCommitReSelectsNothing: the driver's select resets its
// file cursor, so a click that leaves the selection as it is must not emit.
func TestClickShowingCommitReSelectsNothing(t *testing.T) {
	m := newHistoryTestMission()
	y := m.layout().topH + historyFixedTopRows
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("clicking the commit already showing must not re-select it")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y + historyRowHeight, Button: tea.MouseLeft, Mod: tea.ModShift}); cmd == nil {
		t.Fatal("a shift+click that widens the range must still emit")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y + historyRowHeight, Button: tea.MouseLeft, Mod: tea.ModShift}); cmd != nil {
		t.Fatal("repeating the same shift+click leaves the range as it is and must not emit")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y + historyRowHeight, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("a plain click that collapses the range must still emit")
	}
}

func TestClickTabEmitsTabSwitch(t *testing.T) {
	m := newHistoryTestMission()
	if _, cmd := m.Update(tea.MouseClickMsg{X: 1, Y: m.layout().topH + 1, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("clicking the Changes half on History should emit mission:tab")
	}
	c := newMouseTestMission()
	if _, cmd := c.Update(tea.MouseClickMsg{X: sidebarWidth - 2, Y: c.layout().topH + 1, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("clicking the History half on Changes should emit mission:tab")
	}
	if _, cmd := c.Update(tea.MouseClickMsg{X: 1, Y: c.layout().topH + 1, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("clicking the already active Changes half must not emit")
	}
}

func TestMouseWheelOverHistorySidebarMovesCursor(t *testing.T) {
	instantSelectTick(t)
	m := newHistoryTestMission()
	_, cmd := m.Update(tea.MouseWheelMsg{X: 5, Y: m.layout().topH + historyFixedTopRows, Button: tea.MouseWheelDown})
	if m.historyCursor != "s3" {
		t.Fatalf("a wheel tick should move the cursor wheelStep rows (clamped to s3), got %q", m.historyCursor)
	}
	if _, ok := cmd().(historyDebounceMsg); !ok {
		t.Fatal("a wheel move should route through the History debounce")
	}
}

func TestKeybarPerTab(t *testing.T) {
	history := ansi.Strip(renderKeybar(130, "history"))
	for _, want := range []string{"1 changes", "⇧↑↓ range", "↑↓ commits", "enter files", "e expand", "q quit"} {
		if !strings.Contains(history, want) {
			t.Fatalf("History keybar missing %q:\n%s", want, history)
		}
	}
	if strings.Contains(history, "space stage") {
		t.Fatalf("History keybar must not offer staging:\n%s", history)
	}
	if changes := ansi.Strip(renderKeybar(130, "changes")); !strings.Contains(changes, "2 history") {
		t.Fatalf("Changes keybar missing \"2 history\":\n%s", changes)
	}
}

func TestHistoryKeysSwitchTabsAndToggleExpand(t *testing.T) {
	m := newHistoryTestMission()
	if _, cmd := m.Update(tea.KeyPressMsg{Code: '1', Text: "1"}); cmd == nil {
		t.Fatal("1 on History should emit mission:tab")
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: '2', Text: "2"}); cmd != nil {
		t.Fatal("2 on History is already the active tab and must not emit")
	}
	m.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	if !m.historyExpanded {
		t.Fatal("e should toggle the header expansion")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.focus != focusHistoryFiles {
		t.Fatalf("enter should step focus into the file column, got %v", m.focus)
	}
	c := newMouseTestMission()
	if _, cmd := c.Update(tea.KeyPressMsg{Code: '2', Text: "2"}); cmd == nil {
		t.Fatal("2 on Changes should emit mission:tab")
	}
}

func TestTabSwitchStashesEachTabsDiffScroll(t *testing.T) {
	m := newMouseTestMission()
	if err := m.setModelValue(mouseFixtureModel()); err != nil {
		t.Fatal(err)
	}
	m.diffCursor, m.diffTop = 3, 1
	m.focus = focusDiff
	if err := m.setModelValue(historyFixtureModel()); err != nil {
		t.Fatal(err)
	}
	if m.focus != focusList {
		t.Fatalf("a tab switch should return focus to the list, got %v", m.focus)
	}
	if m.diffCursor != 0 || m.diffPath != "lib/mission/model.ts" {
		t.Fatalf("History should start its own diff scroll, got cursor=%d path=%q", m.diffCursor, m.diffPath)
	}
	back := mouseFixtureModel()
	back.Tab = "changes"
	if err := m.setModelValue(back); err != nil {
		t.Fatal(err)
	}
	if m.diffCursor != 3 || m.diffTop != 1 {
		t.Fatalf("returning to Changes should restore its diff scroll, got cursor=%d top=%d", m.diffCursor, m.diffTop)
	}
}

func TestFullFrameHistoryEveryRowFullyPaintsBackground(t *testing.T) {
	m := newHistoryTestMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift})
	m.Update(tea.MouseMotionMsg{X: 5, Y: m.layout().topH + historyFixedTopRows + 2*historyRowHeight})
	assertFullyBgFilled(t, "history", m.View().Content, m.width)
}
