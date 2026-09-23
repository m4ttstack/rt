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
	"rt-ui/internal/views/picker"
)

// historyRowHeight is a commit's painted rows: summary, byline, rule.
const historyRowHeight = 3

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

// sidebarLine is the sidebar part of the first frame line whose sidebar
// columns contain want; the pane's header repeats the selected summary.
func sidebarLine(t *testing.T, out, want string) string {
	t.Helper()
	for _, line := range strings.Split(out, "\n") {
		if part := sidebarPart(line); strings.Contains(ansi.Strip(part), want) {
			return part
		}
	}
	t.Fatalf("no sidebar row contains %q:\n%s", want, ansi.Strip(out))
	return ""
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
	cells := cellBackgrounds(lines[1])
	if len(cells) != sidebarWidth {
		t.Fatalf("label row should be %d cells, got %d", sidebarWidth, len(cells))
	}
	for x, bg := range cells {
		if x < half && bg != hover {
			t.Fatalf("label col %d: the inactive Changes half must hover, got %q", x, bg)
		}
		if x >= half && bg == hover {
			t.Fatalf("label col %d: the active History half must never hover", x)
		}
	}
	for row, glyph := range map[int]string{0: "▄", 2: "▀"} {
		plain := []rune(ansi.Strip(lines[row]))
		if len(plain) != sidebarWidth {
			t.Fatalf("row %d should be %d cells, got %d", row, sidebarWidth, len(plain))
		}
		if string(plain[:half]) != strings.Repeat(glyph, half) {
			t.Fatalf("row %d: the hovered Changes half should be a %s half-block edge: %q", row, glyph, string(plain))
		}
		if strings.Contains(string(plain[half:]), glyph) {
			t.Fatalf("row %d: the active History half must never hover: %q", row, string(plain))
		}
		if !strings.Contains(lines[row], fgSGR(theme.HoverBg)) {
			t.Fatalf("row %d: the half-block edge should wear HoverBg: %q", row, lines[row])
		}
	}
	if !strings.Contains(ansi.Strip(lines[2]), strings.Repeat("─", sidebarWidth-half)) || !strings.Contains(lines[2], fgSGR(theme.Pink)) {
		t.Fatalf("the active History half keeps its Pink underline: %q", lines[2])
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
	if row := sidebarLine(t, out, "Fix pty paint predicate"); !strings.Contains(row, "↑") {
		t.Fatalf("the unpushed commit's row should carry ↑: %q", row)
	}
	if row := sidebarLine(t, out, "Guard badges"); strings.Contains(row, "↑") {
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
				a, b, r := renderCommitRow(c, width, flags[0], flags[1], flags[2])
				for li, line := range []string{a, b, r} {
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
		if row := sidebarLine(t, out, summary); !strings.Contains(row, bgSGR(theme.SelBg)) {
			t.Fatalf("range row %q should wear SelBg: %q", summary, row)
		}
	}
	if row := sidebarLine(t, out, "Empty commit message"); strings.Contains(row, bgSGR(theme.SelBg)) {
		t.Fatalf("a row outside the range must not wear SelBg: %q", row)
	}
}

func pagingCommits(n int) []HistoryCommitRow {
	commits := make([]HistoryCommitRow, n)
	for i := range commits {
		commits[i] = HistoryCommitRow{Sha: fmt.Sprintf("c%02d", i), Summary: fmt.Sprintf("subject-%02d", i), Byline: fmt.Sprintf("author-%02d", i), When: "1 day ago"}
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
// a tick batched with anything else, a page request say, resolves to a
// tea.BatchMsg.
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

// TestMovingThroughTheListRequestsNoPage: paging is the explicit action row
// only, so walking the cursor to the last loaded commit loads nothing.
func TestMovingThroughTheListRequestsNoPage(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	for range 29 {
		if _, cmd := m.Update(downKey()); batchSize(t, cmd) != 1 {
			t.Fatal("a move carries its debounce tick and nothing else")
		}
	}
	if m.historyCursor != "c29" || m.historyMoreFor != -1 {
		t.Fatalf("moving to the last commit must not request a page, cursor %q historyMoreFor=%d", m.historyCursor, m.historyMoreFor)
	}
	m.historyCursor = "c05"
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: historyRowFrameY(t, m, "subject-06"), Button: tea.MouseLeft}); cmd == nil || m.historyMoreFor != -1 {
		t.Fatalf("a click selects without paging, historyMoreFor=%d", m.historyMoreFor)
	}
}

// historyRowFrameY is the frame row whose list text starts with prefix.
func historyRowFrameY(t *testing.T, m *Mission, prefix string) int {
	t.Helper()
	lines := strings.Split(m.View().Content, "\n")
	l := m.layout()
	for y := l.topH + historyFixedTopRows; y < l.topH+l.bodyH; y++ {
		if strings.HasPrefix(listRowText(lines[y]), prefix) {
			return y
		}
	}
	t.Fatalf("no list row starts with %q:\n%s", prefix, strings.Join(listTexts(m), "\n"))
	return -1
}

// onMoreRow walks the cursor from the last commit onto the action row.
func onMoreRow(t *testing.T, m *Mission) {
	t.Helper()
	m.historyCursor = m.model.History.Commits[len(m.model.History.Commits)-1].Sha
	if _, cmd := m.Update(downKey()); cmd != nil {
		t.Fatal("down from the last commit onto the action row must select nothing")
	}
}

func TestActionRowIsACursorStopBelowTheLastCommit(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	onMoreRow(t, m)
	if m.historyCursor != "c29" {
		t.Fatalf("the commit selection stays on c29, got %q", m.historyCursor)
	}
	y := historyRowFrameY(t, m, "Load 100 more commits")
	row := sidebarPart(strings.Split(m.View().Content, "\n")[y])
	if !strings.Contains(row, theme.GlyphBar) || !strings.Contains(row, bgSGR(theme.SelBg)) {
		t.Fatalf("the action row holding the cursor wears the Pink bar on SelBg: %q", row)
	}
	if last := sidebarPart(strings.Split(m.View().Content, "\n")[historyRowFrameY(t, m, "subject-29")]); strings.Contains(last, theme.GlyphBar) {
		t.Fatalf("the cursor bar left the last commit: %q", last)
	}
	if _, cmd := m.Update(downKey()); cmd != nil || m.historyCursor != "c29" {
		t.Fatal("down on the action row is the end of the list")
	}
	if _, cmd := m.Update(upKey()); cmd != nil || m.historyCursor != "c29" {
		t.Fatalf("up returns to the last commit without re-selecting it, cursor %q", m.historyCursor)
	}
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[historyRowFrameY(t, m, "subject-29")]); !strings.Contains(row, theme.GlyphBar) {
		t.Fatalf("the cursor bar is back on the last commit: %q", row)
	}
	if _, cmd := m.Update(upKey()); batchSize(t, cmd) != 1 || m.historyCursor != "c28" {
		t.Fatalf("up from the last commit is an ordinary move, cursor %q", m.historyCursor)
	}
}

// TestEnterOnActionRowRequestsOnePage: enter asks for the next page once;
// until it lands the row reads "Loading…" in Faint and does nothing.
func TestEnterOnActionRowRequestsOnePage(t *testing.T) {
	m := pagingMission(t, pagingCommits(30))
	onMoreRow(t, m)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.historyMoreFor != 30 {
		t.Fatalf("enter on the action row should request the page after 30 commits, historyMoreFor=%d", m.historyMoreFor)
	}
	if m.focus != focusList {
		t.Fatalf("enter on the action row must not step into the files, focus %v", m.focus)
	}
	y := historyRowFrameY(t, m, "Loading…")
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[y]); !strings.Contains(row, fgSGR(theme.Faint)) {
		t.Fatalf("an in-flight row reads Loading… in Faint: %q", row)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil {
		t.Fatal("a second enter while the page is in flight must not request again")
	}
	if h := m.hitTest(2, y); h.kind != hitNone {
		t.Fatalf("the in-flight row is inert, got %+v", h)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("clicking the in-flight row must not request again")
	}
	assertHistoryHitMatchesPaint(t, m, "loading")
}

// TestClickActionRowRequestsOnePage: a click asks once and leaves the
// cursor, the selection, and a wheel-scrolled view where they were.
func TestClickActionRowRequestsOnePage(t *testing.T) {
	m := pagingMission(t, pagingCommits(30))
	for range 40 {
		wheelOverList(m, tea.MouseWheelDown)
	}
	y := historyRowFrameY(t, m, "Load 100 more commits")
	m.Update(tea.MouseMotionMsg{X: 5, Y: y})
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[y]); !strings.Contains(row, bgSGR(theme.HoverBg)) {
		t.Fatalf("a hovered action row paints HoverBg: %q", row)
	}
	assertHistoryHitMatchesPaint(t, m, "action row")
	before := listTexts(m)
	if _, cmd := m.Update(tea.MouseClickMsg{X: 5, Y: y, Button: tea.MouseLeft}); cmd == nil || m.historyMoreFor != 30 {
		t.Fatalf("a click on the action row should request the next page, historyMoreFor=%d", m.historyMoreFor)
	}
	if m.historyCursor != "c00" {
		t.Fatalf("a click on the action row leaves the cursor, got %q", m.historyCursor)
	}
	after := listTexts(m)
	if strings.Join(after[:len(after)-1], "\n") != strings.Join(before[:len(before)-1], "\n") || !strings.HasSuffix(after[len(after)-1], "Loading…") {
		t.Fatalf("the view stays where the wheel left it, with the row now Loading…:\n%s", strings.Join(after, "\n"))
	}
	m.Update(tea.MouseMotionMsg{X: 5, Y: y})
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[y]); strings.Contains(row, bgSGR(theme.HoverBg)) {
		t.Fatalf("an in-flight row never hovers: %q", row)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 5, Y: y, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("a second click while the page is in flight must not request again")
	}
}

// TestLandedPageReturnsTheCursorToTheLastOldCommit: the action row's
// cursor gives way to the commit above it once the page lands, so the next
// down reaches the first new commit instead of chasing the row to the end.
func TestLandedPageReturnsTheCursorToTheLastOldCommit(t *testing.T) {
	instantSelectTick(t)
	m := pagingMission(t, pagingCommits(30))
	onMoreRow(t, m)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(40), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[historyRowFrameY(t, m, "subject-29")]); !strings.Contains(row, theme.GlyphBar) {
		t.Fatalf("the cursor bar returns to c29 once the page lands: %q", row)
	}
	if _, cmd := m.Update(downKey()); batchSize(t, cmd) != 1 || m.historyCursor != "c30" {
		t.Fatalf("down after the page lands reaches the first new commit, cursor %q", m.historyCursor)
	}
	onMoreRow(t, m)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.historyMoreFor != 40 {
		t.Fatalf("the grown list can request its own next page, historyMoreFor=%d", m.historyMoreFor)
	}
}

func TestNoActionRowWithoutMore(t *testing.T) {
	m := pagingMission(t, pagingCommits(3))
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(3)}}); err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(listTexts(m), "\n"); strings.Contains(joined, "more commits") {
		t.Fatalf("no action row without hasMore:\n%s", joined)
	}
	m.historyCursor = "c02"
	if _, cmd := m.Update(downKey()); cmd != nil || m.historyCursor != "c02" {
		t.Fatal("down on the last commit with nothing more to load goes nowhere")
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.historyMoreFor != -1 {
		t.Fatal("enter on the last commit is the ordinary enter")
	}
}

// TestPagingReArmsAfterReload: the driver reloads to one batch on a HEAD
// move or a worktree switch and drops any page still in flight, so a list
// that came back shorter or under a new tip must be able to page again even
// at the length the last request went out for.
func TestPagingReArmsAfterReload(t *testing.T) {
	instantSelectTick(t)
	// requested asks for the page after 30 commits from the action row.
	requested := func() *Mission {
		m := pagingMission(t, pagingCommits(30))
		onMoreRow(t, m)
		if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.historyMoreFor != 30 {
			t.Fatalf("setup: the first page request should go out, historyMoreFor=%d", m.historyMoreFor)
		}
		if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil {
			t.Fatal("setup: the request is in flight")
		}
		return m
	}
	// canRequest reports that the action row asks again: it reads "Load
	// 100 more commits" and enter on it requests a page.
	canRequest := func(m *Mission) bool {
		onMoreRow(t, m)
		historyRowFrameY(t, m, "Load 100 more commits")
		_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
		return cmd != nil && m.historyMoreFor == len(m.model.History.Commits)
	}

	m := requested()
	newTip := append([]HistoryCommitRow{{Sha: "tip", Summary: "subject-tip", Byline: "author-tip"}}, pagingCommits(29)...)
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: newTip, HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if !canRequest(m) {
		t.Fatalf("a reload under a new tip must re-arm paging, historyMoreFor=%d", m.historyMoreFor)
	}

	m = requested()
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(40), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if !canRequest(m) {
		t.Fatal("a list that shrank back to one batch must re-arm paging")
	}

	// A history-more that threw lands as a notice with the list unchanged at
	// the exact length the request went out for; historyReloaded sees neither
	// a shorter list nor a new first sha, so it alone would leave paging dead.
	m = requested()
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true}, Notice: "history-more failed"}); err != nil {
		t.Fatal(err)
	}
	if !canRequest(m) {
		t.Fatalf("a notice with the list unchanged at historyMoreFor's length must re-arm paging, historyMoreFor=%d", m.historyMoreFor)
	}

	// A worktree switch to a tree at the same tip (common across pool
	// worktrees) reloads to the identical 100 commits with the same first
	// sha, so historyReloaded also sees nothing here.
	m = requested()
	if err := m.setModelValue(Model{Tab: "history", Current: Current{Worktree: "/other/tree"}, History: HistoryModel{Commits: pagingCommits(30), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if !canRequest(m) {
		t.Fatalf("a worktree switch to a same-tip tree must re-arm paging, historyMoreFor=%d", m.historyMoreFor)
	}

	// An unrelated push leaves the list and the request alone.
	m = requested()
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || !strings.Contains(strings.Join(listTexts(m), "\n"), "Loading…") {
		t.Fatal("a push that neither reloads nor lands the page keeps the request in flight")
	}
}

func TestActionRowInertWhileFirstLoadRuns(t *testing.T) {
	m := pagingMission(t, pagingCommits(30))
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: pagingCommits(30), HasMore: true, Loading: true}}); err != nil {
		t.Fatal(err)
	}
	onMoreRow(t, m)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.historyMoreFor != -1 {
		t.Fatalf("no page request while the list is loading, historyMoreFor=%d", m.historyMoreFor)
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
	if h := m.hitTest(2, y+historyRowHeight); h.kind != hitCommitRow || h.idx != 1 {
		t.Fatalf("the next commit's summary row should be commit 1, got %+v", h)
	}
	if h := m.hitTest(1, l.topH+1); h.kind != hitTab || h.idx != 0 {
		t.Fatalf("the inactive Changes half should resolve to hitTab idx 0, got %+v", h)
	}
	if h := m.hitTest(sidebarWidth-2, l.topH+1); h.kind != hitNone {
		t.Fatalf("the active History half must be inert, got %+v", h)
	}
	if h := m.hitTest(2, l.topH+2); h.kind != hitTab || h.idx != 0 {
		t.Fatalf("the inactive half's underline row is part of its button, got %+v", h)
	}
	if h := m.hitTest(sidebarWidth-2, l.topH+2); h.kind != hitNone {
		t.Fatalf("the active half's underline must stay inert, got %+v", h)
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

// TestScrolledHistoryHitMirrorsRenderedRows repeats the render/hit lockstep
// walk with the list scrolled, so historyTop is part of the mapping.
func TestScrolledHistoryHitMirrorsRenderedRows(t *testing.T) {
	commits := make([]HistoryCommitRow, 40)
	for i := range commits {
		commits[i] = HistoryCommitRow{Sha: fmt.Sprintf("c%02d", i), Summary: fmt.Sprintf("subject-%02d", i), Byline: fmt.Sprintf("author-%02d", i), When: "1 day ago"}
	}
	m := pagingMission(t, commits)
	m.historyCursor = "c30"
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if m.historyTop == 0 {
		t.Fatal("setup: the list should have scrolled")
	}
	if n := assertHistoryHitMatchesPaint(t, m, "scrolled"); n == 0 {
		t.Fatal("setup: no commit rows painted")
	}
	seen := 0
	for idx, c := range commits {
		y := -1
		for i, line := range lines {
			if strings.Contains(sidebarPart(line), c.Summary) {
				y = i
				break
			}
		}
		if y < 0 {
			continue
		}
		seen++
		for _, row := range []int{y, y + 1} {
			if h := m.hitTest(2, row); h.kind != hitCommitRow || h.idx != idx {
				t.Fatalf("row %d painting %q resolved to %+v, want commit %d", row, c.Summary, h, idx)
			}
		}
	}
	if seen == 0 || strings.Contains(strings.Join(lines, "\n"), "subject-00") {
		t.Fatalf("setup: expected a scrolled window without the first commit, saw %d rows", seen)
	}
}

func TestLongBylineKeepsTheTime(t *testing.T) {
	width := sidebarWidth - 1
	c := HistoryCommitRow{Summary: "s", Byline: "Matthew Goodwin, Claude Opus 5.5 (1M context)", When: "3 hours ago"}
	_, b, _ := renderCommitRow(c, width, false, false, false)
	line := ansi.Strip(b)
	if !strings.HasSuffix(strings.TrimRight(line, " "), "· 3 hours ago") {
		t.Fatalf("the relative time must survive a long byline: %q", line)
	}
	if !strings.Contains(line, "Matthew Goodwin") || !strings.Contains(line, "…") {
		t.Fatalf("the byline should give up its own tail: %q", line)
	}
	if !strings.Contains(b, fgSGR(theme.Dimmer)) {
		t.Fatalf("the byline should wear Dimmer so it recedes behind the summary: %q", b)
	}
}

func TestCommitSummaryIsBoldAndRowsAreRuled(t *testing.T) {
	width := sidebarWidth - 1
	a, _, r := renderCommitRow(HistoryCommitRow{Summary: "Guard badges", Byline: "Matt", When: "1 day ago"}, width, false, false, false)
	if !strings.Contains(a, "\x1b[1;") && !strings.Contains(a, ";1;") && !strings.Contains(a, "\x1b[1m") {
		t.Fatalf("the summary should be bold: %q", a)
	}
	if ansi.Strip(r) != strings.Repeat("─", width) || !strings.Contains(r, fgSGR(theme.Rule)) {
		t.Fatalf("the third row should be a full-width Rule separator: %q", r)
	}
	_, _, selRule := renderCommitRow(HistoryCommitRow{Summary: "x"}, width, true, true, false)
	if strings.Contains(selRule, bgSGR(theme.SelBg)) {
		t.Fatalf("a selected commit's separator must stay on Bg: %q", selRule)
	}
}

func TestSeparatorRuleRowIsInert(t *testing.T) {
	m := newHistoryTestMission()
	ruleY := m.layout().topH + historyFixedTopRows + historyRowHeight - 1
	if h := m.hitTest(3, ruleY); h.kind != hitNone {
		t.Fatalf("the separator rule must not hit, got %v", h)
	}
	m.Update(tea.MouseMotionMsg{X: 3, Y: ruleY})
	if m.hoverCommit != -1 {
		t.Fatalf("hovering the separator must not hover a commit, got %d", m.hoverCommit)
	}
	if h := m.hitTest(3, ruleY-1); h.kind != hitCommitRow || h.idx != 0 {
		t.Fatalf("the byline row above the rule still belongs to commit 0, got %v", h)
	}
}

func TestLongTagKeepsSummaryReadable(t *testing.T) {
	width := sidebarWidth - 1
	tag := "release-candidate-" + strings.Repeat("x", 22)
	if lipgloss.Width(tag) != 40 {
		t.Fatalf("setup: tag should be 40 cells, got %d", lipgloss.Width(tag))
	}
	for _, tagW := range []int{20, 30, 35, 40} {
		c := HistoryCommitRow{Summary: "Fix pty paint predicate", Byline: "Matt", When: "3 hours ago", Tags: []string{tag[:tagW]}, Unpushed: true}
		a, _, _ := renderCommitRow(c, width, false, false, false)
		line := ansi.Strip(a)
		if !strings.Contains(line, "Fix pty paint predicate") {
			t.Fatalf("a %d-cell tag starved the summary: %q", tagW, line)
		}
		if !strings.Contains(line, "releas") || !strings.Contains(line, "…") {
			t.Fatalf("a %d-cell tag should stay visible, middle-truncated: %q", tagW, line)
		}
		if pillW := lipgloss.Width(pill(middleTruncate(tag[:tagW], width/3-2), theme.Lav)); pillW > width/3 {
			t.Fatalf("setup: the capped pill should fit a third of the row, got %d", pillW)
		}
	}
	short, _, _ := renderCommitRow(HistoryCommitRow{Summary: "Guard badges", Tags: []string{"v0.9.1"}}, width, false, false, false)
	if !strings.Contains(ansi.Strip(short), " v0.9.1 ") {
		t.Fatalf("a short tag must render whole: %q", ansi.Strip(short))
	}
}

func TestChangesKeybarKeepsTabKeyAtNarrowWidth(t *testing.T) {
	out := ansi.Strip(renderKeybar(100, "changes"))
	if !strings.Contains(out, "2 history") {
		t.Fatalf("at 100 columns the Changes keybar must still show \"2 history\":\n%s", out)
	}
}

// TestJustifyClippedLeftLeavesGapBeforeRight pins a real repro: at 100
// columns the Changes keybar's left side clips to exactly maxLeft, which
// left no cells for right's own PlaceHorizontal to pad with -- the ellipsis
// ran straight into "q quit" with no separating space.
func TestJustifyClippedLeftLeavesGapBeforeRight(t *testing.T) {
	out := ansi.Strip(renderKeybar(100, "changes"))
	idx := strings.Index(out, "…")
	if idx == -1 {
		t.Fatalf("setup: expected the left side clipped with an ellipsis at 100 columns:\n%s", out)
	}
	rest := out[idx+len("…"):]
	if !strings.HasPrefix(rest, " ") {
		t.Fatalf("a clipped left must leave a space before the right hint, got %q", out[idx:])
	}
}

// TestJustifyWideWidthUnchanged pins the other half: once left already fits
// (no clipping), justify's output must stay exactly what it always was.
func TestJustifyWideWidthUnchanged(t *testing.T) {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	out := justify(on, 130, "left text", "right text")
	want := on.Render("  ") + "left text" + lipgloss.PlaceHorizontal(130-3-len("left text"), lipgloss.Right, "right text", lipgloss.WithWhitespaceStyle(on)) + on.Render(" ")
	if out != want {
		t.Fatalf("a wide-width strip where left already fits must be byte-identical:\ngot  %q\nwant %q", out, want)
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

// listTexts is the painted commit list, one trimmed row per list row.
func listTexts(m *Mission) []string {
	lines := strings.Split(m.View().Content, "\n")
	l := m.layout()
	var out []string
	for y := l.topH + historyFixedTopRows; y < l.topH+l.bodyH; y++ {
		out = append(out, listRowText(lines[y]))
	}
	return out
}

func wheelOverList(m *Mission, button tea.MouseButton) tea.Cmd {
	_, cmd := m.Update(tea.MouseWheelMsg{X: 5, Y: m.layout().topH + historyFixedTopRows + 2, Button: button})
	return cmd
}

// TestWheelOverHistoryListScrollsTheView: GitHub Desktop's wheel scrolls
// the list, never the selection, so a tick moves the view three lines and
// selects, loads, and pages nothing.
func TestWheelOverHistoryListScrollsTheView(t *testing.T) {
	m := groupedMission(t, 30, true)
	before := listTexts(m)
	if cmd := wheelOverList(m, tea.MouseWheelDown); cmd != nil {
		t.Fatal("a wheel tick over the list must emit nothing")
	}
	if m.historyCursor != "sha00" || m.historyAnchor != "" {
		t.Fatalf("a wheel tick must not move the cursor, got %q", m.historyCursor)
	}
	after := listTexts(m)
	if strings.Join(after[:len(after)-wheelStep], "\n") != strings.Join(before[wheelStep:], "\n") {
		t.Fatalf("a tick should scroll the list %d lines:\nbefore %q\nafter  %q", wheelStep, before[:6], after[:6])
	}
	assertHistoryHitMatchesPaint(t, m, "wheel-scrolled")
	if cmd := wheelOverList(m, tea.MouseWheelUp); cmd != nil || strings.Join(listTexts(m), "\n") != strings.Join(before, "\n") {
		t.Fatal("a tick back up should return to the first frame and emit nothing")
	}
	if cmd := wheelOverList(m, tea.MouseWheelUp); cmd != nil || listTexts(m)[0] != "Today" {
		t.Fatal("a tick up at the top stays at the top")
	}
}

// TestWheelToTheEndRequestsNoPage: scrolling reaches the end of the loaded
// list and stops there; nothing loads while scrolling.
func TestWheelToTheEndRequestsNoPage(t *testing.T) {
	m := groupedMission(t, 30, true)
	var last []string
	for range 60 {
		if cmd := wheelOverList(m, tea.MouseWheelDown); cmd != nil {
			t.Fatal("no wheel tick may emit, even at the end of the list")
		}
		last = listTexts(m)
	}
	if m.historyMoreFor != -1 {
		t.Fatalf("scrolling to the end must not request a page, historyMoreFor=%d", m.historyMoreFor)
	}
	if m.historyCursor != "sha00" {
		t.Fatalf("the cursor stays put, got %q", m.historyCursor)
	}
	joined := strings.Join(last, "\n")
	if !strings.Contains(joined, "subject-29") || strings.Contains(joined, "subject-00") {
		t.Fatalf("sixty ticks should rest on the list's end:\n%s", joined)
	}
	assertHistoryHitMatchesPaint(t, m, "wheel-end")
}

// TestKeyClickAndReloadEndFreeScroll: once the wheel has scrolled the
// cursor away, a key move, a click, or a reload brings the viewport back to
// following the cursor.
func TestKeyClickAndReloadEndFreeScroll(t *testing.T) {
	instantSelectTick(t)
	scrolled := func() *Mission {
		m := groupedMission(t, 30, true)
		for range 8 {
			wheelOverList(m, tea.MouseWheelDown)
		}
		if strings.Contains(strings.Join(listTexts(m), "\n"), "subject-00") {
			t.Fatal("setup: the wheel should have scrolled the cursor out of view")
		}
		return m
	}
	cursorPainted := func(m *Mission, summary string) bool {
		for _, text := range listTexts(m) {
			if text == summary {
				return true
			}
		}
		return false
	}

	m := scrolled()
	m.Update(downKey())
	if m.historyCursor != "sha01" || !cursorPainted(m, "subject-01") {
		t.Fatalf("a key move should move from the cursor and bring it back into view, cursor %q", m.historyCursor)
	}

	m = scrolled()
	texts := listTexts(m)
	y := -1
	for i, text := range texts {
		if strings.HasPrefix(text, "subject-") {
			y = i
			break
		}
	}
	target := texts[y]
	m.Update(tea.MouseClickMsg{X: 2, Y: m.layout().topH + historyFixedTopRows + y, Button: tea.MouseLeft})
	for range 4 {
		m.Update(downKey())
	}
	if !cursorPainted(m, fmt.Sprintf("subject-%02d", m.historyIndex(m.historyCursor))) {
		t.Fatalf("after clicking %q the viewport should follow the cursor again", target)
	}

	m = scrolled()
	reloaded := append([]HistoryCommitRow{{Sha: "tip", Summary: "subject-tip", Byline: "author-tip", Group: "Today", Selected: true}}, groupedCommits(30)...)
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: reloaded, HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	if !cursorPainted(m, "subject-00") {
		t.Fatalf("a reload should end free scroll so the cursor (still sha00) is in view:\n%s", strings.Join(listTexts(m), "\n"))
	}
}

func TestKeybarPerTab(t *testing.T) {
	history := ansi.Strip(renderKeybar(130, "history"))
	for _, want := range []string{"1 changes", "⇧↑↓ range", "↑↓ commits", "enter files", "/ filter", "e expand", "q quit"} {
		if !strings.Contains(history, want) {
			t.Fatalf("History keybar missing %q:\n%s", want, history)
		}
	}
	if !strings.Contains(history, "enter files · / filter · e expand") {
		t.Fatalf("\"/ filter\" sits right after \"enter files\" so it survives a narrow terminal:\n%s", history)
	}
	if narrow := ansi.Strip(renderKeybar(80, "history")); !strings.Contains(narrow, "/ filter") || !strings.HasSuffix(strings.TrimRight(narrow, " "), "q quit") {
		t.Fatalf("at 80 columns the History keybar keeps \"/ filter\" and \"q quit\" flush right:\n%s", narrow)
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

func fixtureHeader() HistoryHeader {
	return *historyFixtureModel().History.Header
}

func strippedHeader(h HistoryHeader, expanded bool, width int) []string {
	lines := historyHeaderLines(h, expanded, false, width)
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = ansi.Strip(l)
	}
	return out
}

func TestHeaderCollapsedShowsSummaryMetaAndExpander(t *testing.T) {
	lines := strippedHeader(fixtureHeader(), false, 80)
	if !strings.Contains(lines[0], "Fix pty paint predicate") || !strings.Contains(lines[0], "⌄") {
		t.Fatalf("the first line should carry the summary and the ⌄ expander: %q", lines[0])
	}
	if !strings.Contains(strings.Join(lines, "\n"), "Matt · s1 · +12 −4") {
		t.Fatalf("the collapsed header needs a byline · short sha · +N −M meta line:\n%s", strings.Join(lines, "\n"))
	}
}

func TestHeaderExpandedShowsFullShaAndAuthors(t *testing.T) {
	out := strings.Join(strippedHeader(fixtureHeader(), true, 80), "\n")
	for _, want := range []string{"s1full", "Matt <m@x>", "12 added lines", "4 removed lines", "⌃"} {
		if !strings.Contains(out, want) {
			t.Fatalf("the expanded header is missing %q:\n%s", want, out)
		}
	}
}

func TestHeaderClipsDescriptionToTwoLinesCollapsed(t *testing.T) {
	h := fixtureHeader()
	h.Body = "body one\nbody two\nbody three\nbody four\nbody five"
	collapsed := strings.Join(strippedHeader(h, false, 80), "\n")
	for _, want := range []string{"body one", "body two"} {
		if !strings.Contains(collapsed, want) {
			t.Fatalf("collapsed should show %q:\n%s", want, collapsed)
		}
	}
	for _, hidden := range []string{"body three", "body four", "body five"} {
		if strings.Contains(collapsed, hidden) {
			t.Fatalf("collapsed must clip the description to two lines, found %q:\n%s", hidden, collapsed)
		}
	}
	expanded := strings.Join(strippedHeader(h, true, 80), "\n")
	for _, want := range []string{"body one", "body two", "body three", "body four", "body five"} {
		if !strings.Contains(expanded, want) {
			t.Fatalf("expanded should show every description line, missing %q:\n%s", want, expanded)
		}
	}
}

func TestHeaderRangeReadsShowingChanges(t *testing.T) {
	h := fixtureHeader()
	h.RangeCount = 2
	lines := strippedHeader(h, false, 80)
	if len(lines) != 1 {
		t.Fatalf("a range header is one line with no meta line, got %d:\n%s", len(lines), strings.Join(lines, "\n"))
	}
	if strings.TrimSpace(lines[0]) != "Showing changes from 2 commits" {
		t.Fatalf("a range header should read \"Showing changes from 2 commits\", got %q", lines[0])
	}
	if strings.ContainsAny(lines[0], "⌄⌃") {
		t.Fatalf("a range header has no expander: %q", lines[0])
	}
	raw := historyHeaderLines(h, false, false, 80)[0]
	if !strings.Contains(raw, "1;"+fgSGR(theme.Text)) && !strings.Contains(raw, fgSGR(theme.Text)+";1") {
		t.Fatalf("the range header should be bold Text like the board: %q", raw)
	}
}

func TestHeaderLinesNeverWrap(t *testing.T) {
	h := fixtureHeader()
	h.Summary = strings.Repeat("s", 300)
	h.Body = "修正する修正する修正する修正する修正する修正する修正する修正する修正する修正する修正する\n" + strings.Repeat("b", 200) + "\n\tindented\twith\ttabs " + strings.Repeat("t", 80)
	h.Tags = []string{"v0.9.1", "v0.9.0", "v0.8.9", "release-candidate-long-name", "v0.8.7", "v0.8.6"}
	h.Authors = []string{strings.Repeat("Author ", 20) + "<a@x>"}
	h.Byline = strings.Repeat("Author ", 20)
	for _, width := range []int{30, 50, 80, 120} {
		for _, expanded := range []bool{false, true} {
			for _, hover := range []bool{false, true} {
				for i, line := range historyHeaderLines(h, expanded, hover, width) {
					if strings.Contains(line, "\n") {
						t.Fatalf("width %d expanded=%v line %d wrapped: %q", width, expanded, i, line)
					}
					if w := lipgloss.Width(line); w != width {
						t.Fatalf("width %d expanded=%v line %d: width %d: %q", width, expanded, i, w, line)
					}
				}
			}
		}
	}
}

func TestHeaderHidesZeroLineCounts(t *testing.T) {
	h := fixtureHeader()
	h.LinesAdded, h.LinesDeleted = 0, 0
	collapsed := strings.Join(strippedHeader(h, false, 80), "\n")
	if strings.Contains(collapsed, "+0") || strings.Contains(collapsed, "−0") {
		t.Fatalf("zero line counts must hide in the collapsed meta:\n%s", collapsed)
	}
	expanded := strings.Join(strippedHeader(h, true, 80), "\n")
	if strings.Contains(expanded, "added lines") || strings.Contains(expanded, "removed lines") {
		t.Fatalf("zero line counts must hide in the expanded meta:\n%s", expanded)
	}
}

func TestHistoryPaneSlates(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Model)
		want string
	}{
		{"unborn", func(m *Model) { m.History = HistoryModel{} }, "No history"},
		{"first load", func(m *Model) { m.History = HistoryModel{Loading: true} }, "Loading history…"},
		{"nothing selected", func(m *Model) { m.History.Header = nil }, "No commit selected"},
		{"non-contiguous", func(m *Model) {
			m.History.Header.RangeCount, m.History.Header.Contiguous = 2, false
		}, "Unable to display diff when multiple non-consecutive commits are selected."},
	}
	for _, c := range cases {
		model := historyFixtureModel()
		c.edit(&model)
		m := New(nil)
		m.width, m.height = 130, 38
		if err := m.setModelValue(model); err != nil {
			t.Fatal(err)
		}
		out := m.renderHistoryPane(m.diffWidth(), 20)
		if got := lipgloss.Height(out); got != 20 {
			t.Fatalf("%s: the slate must fill the pane's 20 rows, got %d", c.name, got)
		}
		if plain := ansi.Strip(out); !strings.Contains(plain, c.want) {
			t.Fatalf("%s: pane should read %q:\n%s", c.name, c.want, plain)
		}
		if h := m.historyPaneHit(3, 0); h.kind != hitNone {
			t.Fatalf("%s: a slate has no hit targets, got %+v", c.name, h)
		}
	}
}

func TestHistoryFilesWidthClamps(t *testing.T) {
	for _, c := range [][2]int{{60, 24}, {90, 30}, {200, 40}} {
		if got := historyFilesWidth(c[0]); got != c[1] {
			t.Fatalf("historyFilesWidth(%d) = %d, want %d", c[0], got, c[1])
		}
	}
	for _, c := range [][2]int{{55, 24}, {54, 18}, {33, 12}, {26, 12}, {14, 12}, {10, 9}} {
		if got := historyFilesWidth(c[0]); got != c[1] {
			t.Fatalf("where the diff would drop under 30 cells historyFilesWidth(%d) = %d, want %d", c[0], got, c[1])
		}
	}
}

func TestReadOnlyDiffHasNoStageAffordances(t *testing.T) {
	if out := ansi.Strip(renderDiffHeader(DiffModel{Path: "a", ReadOnly: true}, 80)); strings.Contains(out, "space stages") {
		t.Fatalf("a read-only diff header must not offer staging: %q", out)
	}
	if out := ansi.Strip(renderDiffHeader(DiffModel{Path: "a"}, 80)); !strings.Contains(out, "space stages") {
		t.Fatalf("setup: the Changes diff header should still offer staging: %q", out)
	}
	ro := DiffModel{Path: "a", ReadOnly: true}
	for _, line := range []DiffLine{{Kind: "add", Text: "x", SelIdx: 0}, {Kind: "add", Text: "x", SelIdx: 0, Selected: true}} {
		out := renderDiffLine(ro, line, 40, true, true)
		if strings.Contains(out, fgSGR(theme.GutterHoverBar)) || strings.Contains(out, theme.GlyphBar) {
			t.Fatalf("a read-only line must never paint a stage bar: %q", out)
		}
	}
	m := newHistoryTestMission()
	m.focus = focusDiff
	m.model.Diff.Lines = []DiffLine{{Kind: "add", Text: "x", NewNo: 1, SelIdx: 0}, {Kind: "hunk", Text: "@@ -1 +1 @@", SelIdx: -1}}
	for _, k := range []tea.KeyPressMsg{{Code: tea.KeySpace}, {Code: 's', Text: "s"}, {Code: 'd', Text: "d"}} {
		if _, cmd := m.diffKey(k); cmd != nil {
			t.Fatalf("%q on a read-only diff must do nothing", k.String())
		}
	}
	for _, x := range []int{0, diffGutterWidth + 2} {
		if h := m.diffHit(x, 1, 60); h.kind != hitDiffLine {
			t.Fatalf("a read-only diff line at x=%d must resolve to hitDiffLine, got %+v", x, h)
		}
	}
	if h := m.diffHit(0, 2, 60); h.kind != hitDiffLine {
		t.Fatalf("a read-only hunk row is not a toggle, got %+v", h)
	}
}

// historyPaneX is the frame column of pane-relative column px.
func historyPaneX(px int) int { return sidebarWidth + 1 + px }

func TestHistoryPaneHitMapsHeaderFilesAndDiff(t *testing.T) {
	m := newHistoryTestMission()
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	l := m.layout()
	if h := m.hitTest(historyPaneX(10), l.topH); h.kind != hitHistoryExpander {
		t.Fatalf("the pane's first row should be the expander, got %+v", h)
	}
	filesW := historyFilesWidth(m.diffWidth())
	fileY := -1
	for y, line := range lines {
		if strings.Contains(ansi.Cut(line, historyPaneX(0), historyPaneX(filesW)), "lib/mission/model.ts") {
			fileY = y
			break
		}
	}
	if fileY < 0 {
		t.Fatal("the file row is not painted in the file column")
	}
	if h := m.hitTest(historyPaneX(3), fileY); h.kind != hitHistoryFile || h.idx != 0 {
		t.Fatalf("the painted file row should resolve to hitHistoryFile 0, got %+v", h)
	}
	if h := m.hitTest(historyPaneX(3), fileY-1); h.kind != hitNone {
		t.Fatalf("the \"N changed files\" row must be inert, got %+v", h)
	}
	headerH := len(m.historyHeader(m.diffWidth(), l.bodyH))
	if !strings.Contains(lines[l.topH+headerH], "┬") {
		t.Fatalf("setup: frame row %d should be the rule: %q", l.topH+headerH, lines[l.topH+headerH])
	}
	for _, px := range []int{3, filesW, filesW + 5} {
		if h := m.hitTest(historyPaneX(px), l.topH+headerH); h.kind != hitNone {
			t.Fatalf("the rule row must be inert at pane x=%d, got %+v", px, h)
		}
	}
	if h := m.hitTest(historyPaneX(3), fileY+1); h.kind != hitNone {
		t.Fatalf("the filler row below the last file must be inert, got %+v", h)
	}
	if h := m.hitTest(historyPaneX(filesW), fileY); h.kind != hitNone {
		t.Fatalf("the column divider must be inert, got %+v", h)
	}
	for _, dx := range []int{1, diffGutterWidth + 2} {
		if h := m.hitTest(historyPaneX(filesW+1+dx), fileY); h.kind != hitDiffLine || h.idx != 0 {
			t.Fatalf("the first diff line at dx=%d should resolve to hitDiffLine 0, got %+v", dx, h)
		}
	}
	if !strings.Contains(ansi.Cut(lines[fileY], historyPaneX(filesW+1), m.width), "x") {
		t.Fatalf("setup: the first diff line should paint beside the first file row: %q", lines[fileY])
	}
}

func TestEnterStepsFocusListFilesDiffAndEscBack(t *testing.T) {
	m := newHistoryTestMission()
	enter := tea.KeyPressMsg{Code: tea.KeyEnter}
	esc := tea.KeyPressMsg{Code: tea.KeyEscape}
	for _, want := range []focusKind{focusHistoryFiles, focusDiff} {
		m.Update(enter)
		if m.focus != want {
			t.Fatalf("enter should step focus to %v, got %v", want, m.focus)
		}
	}
	for _, want := range []focusKind{focusHistoryFiles, focusList} {
		m.Update(esc)
		if m.focus != want {
			t.Fatalf("esc should step focus back to %v, got %v", want, m.focus)
		}
	}
}

func TestExpandKeyTogglesHeader(t *testing.T) {
	m := newHistoryTestMission()
	x := historyPaneX(3)
	m.View()
	before, ok := findHitY(m, x, hitHistoryFile)
	if !ok {
		t.Fatal("no row resolves to the file row")
	}
	collapsed := len(historyHeaderLines(fixtureHeader(), false, false, m.diffWidth()))
	expanded := len(historyHeaderLines(fixtureHeader(), true, false, m.diffWidth()))
	m.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	if !m.historyExpanded {
		t.Fatal("e should expand the header")
	}
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	after, _ := findHitY(m, x, hitHistoryFile)
	if after-before != expanded-collapsed || expanded <= collapsed {
		t.Fatalf("the file row should move down by %d header lines, moved %d", expanded-collapsed, after-before)
	}
	if !strings.Contains(lines[after], "lib/mission/model.ts") {
		t.Fatalf("the hit-test's file row must be where the render painted it: %q", lines[after])
	}
	m.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	if m.historyExpanded {
		t.Fatal("a second e should collapse the header")
	}
}

func twoFileHistoryModel() Model {
	model := historyFixtureModel()
	model.History.Files = []HistoryFileRow{{Path: "lib/mission/model.ts", Status: "modified"}, {Path: "lib/mission/driver.ts", Status: "new"}}
	return model
}

func twoFileHistoryMission() *Mission {
	m := New(nil)
	m.width, m.height = 130, 38
	_ = m.setModelValue(twoFileHistoryModel())
	return m
}

// TestHistoryDownThenUpReSelectsNothing: the driver's select resets its file
// cursor, so a move that settles back on the commit already showing must not
// re-select it.
func TestHistoryDownThenUpReSelectsNothing(t *testing.T) {
	instantSelectTick(t)
	m := newHistoryTestMission()
	_, down := m.Update(downKey())
	_, up := m.Update(upKey())
	for i, cmd := range []tea.Cmd{down, up} {
		if cmd == nil {
			t.Fatalf("move %d should schedule a tick", i)
		}
		if _, emit := m.Update(cmd()); emit != nil {
			t.Fatalf("tick %d re-selected the commit already showing", i)
		}
	}
	_, down = m.Update(downKey())
	if _, emit := m.Update(down()); emit == nil {
		t.Fatal("a settled move away from the showing commit must still emit")
	}
}

func TestHistoryClickBackToShowingCommitDuringDebounceReSelectsNothing(t *testing.T) {
	instantSelectTick(t)
	m := newHistoryTestMission()
	_, down := m.Update(downKey())
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: m.layout().topH + historyFixedTopRows, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("clicking back onto the commit the driver still shows must not re-select it")
	}
	if _, emit := m.Update(down()); emit != nil {
		t.Fatal("the pending tick must not re-select the showing commit either")
	}
}

func TestHistoryFileDownThenUpReSelectsNothing(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	_, down := m.Update(downKey())
	if m.historyFile != "lib/mission/driver.ts" {
		t.Fatalf("down should move the file cursor, got %q", m.historyFile)
	}
	_, up := m.Update(upKey())
	for i, cmd := range []tea.Cmd{down, up} {
		if cmd == nil {
			t.Fatalf("file move %d should schedule a tick", i)
		}
		if _, emit := m.Update(cmd()); emit != nil {
			t.Fatalf("file tick %d re-selected the file already showing", i)
		}
	}
	_, down = m.Update(downKey())
	if _, emit := m.Update(down()); emit == nil {
		t.Fatal("a settled file move must emit")
	}
	if _, cmd := m.Update(downKey()); cmd != nil {
		t.Fatal("down on the last file changes nothing and must schedule nothing")
	}
}

// TestFileClickKeepsPendingCommitSelect: the commit and file debounces are
// independent, so a file click inside the commit debounce window must not
// swallow the commit select.
func TestFileClickKeepsPendingCommitSelect(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	_, down := m.Update(downKey())
	m.View()
	y, ok := findHitY(m, historyPaneX(3), hitHistoryFile)
	if !ok {
		t.Fatal("no file row to click")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: historyPaneX(3), Y: y + 1, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("clicking another file should emit mission:history-file")
	}
	if m.focus != focusHistoryFiles || m.historyFile != "lib/mission/driver.ts" {
		t.Fatalf("a file click should focus the column and move its cursor, got focus=%v file=%q", m.focus, m.historyFile)
	}
	if _, emit := m.Update(down()); emit == nil {
		t.Fatal("the pending commit select must survive a file click")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: historyPaneX(3), Y: y + 1, Button: tea.MouseLeft}); cmd != nil {
		t.Fatal("clicking the file already showing must not re-select it")
	}
}

// TestFileCursorFollowsDriverSelection: the driver's commit select resets
// its file to the first one, which may share a path with the file the view
// last showed; outside a pending move the view's cursor follows the driver.
func TestFileCursorFollowsDriverSelection(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	m.historyFile = "lib/mission/driver.ts"
	reselected := twoFileHistoryModel()
	reselected.History.Commits[0].Selected = false
	reselected.History.Commits[1].Selected = true
	if err := m.setModelValue(reselected); err != nil {
		t.Fatal(err)
	}
	if m.historyFile != "lib/mission/model.ts" {
		t.Fatalf("a new commit selection should adopt the driver's first file, got %q", m.historyFile)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m.Update(downKey())
	moved := reselected
	moved.History.SelectedFile = "lib/mission/driver.ts"
	moved.History.Files = twoFileHistoryModel().History.Files
	m.Update(upKey())
	if err := m.setModelValue(moved); err != nil {
		t.Fatal(err)
	}
	if m.historyFile != "lib/mission/model.ts" {
		t.Fatalf("a push during a pending move must keep the view's cursor, got %q", m.historyFile)
	}
}

// TestFileCursorIgnoresStalePush: a push that still carries the driver's old
// file (sent before the driver handled the view's file select) must not snap
// the cursor back; the driver's file is adopted only once it changes.
func TestFileCursorIgnoresStalePush(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	m.View()
	y, _ := findHitY(m, historyPaneX(3), hitHistoryFile)
	if _, cmd := m.Update(tea.MouseClickMsg{X: historyPaneX(3), Y: y + 1, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("setup: clicking the second file should emit")
	}
	if err := m.setModelValue(twoFileHistoryModel()); err != nil {
		t.Fatal(err)
	}
	if m.historyFile != "lib/mission/driver.ts" {
		t.Fatalf("a stale push must not snap the cursor back to the driver's old file, got %q", m.historyFile)
	}
	_, up := m.Update(upKey())
	if up == nil || m.historyFile != "lib/mission/model.ts" {
		t.Fatalf("a move after the stale push should start from the clicked file, got %q", m.historyFile)
	}
	if _, emit := m.Update(up()); emit == nil {
		t.Fatal("setup: the settled move back to the first file should emit")
	}
	adopted := twoFileHistoryModel()
	adopted.History.SelectedFile = "lib/mission/driver.ts"
	if err := m.setModelValue(adopted); err != nil {
		t.Fatal(err)
	}
	if m.historyFile != "lib/mission/driver.ts" {
		t.Fatalf("a driver file that changed since the last push should be adopted, got %q", m.historyFile)
	}
}

func TestHistoryFileRowNeverWraps(t *testing.T) {
	for _, path := range []string{"a.ts", strings.Repeat("dir/", 40) + "file.ts", "修正/修正する修正する修正する修正する修正する.ts"} {
		for _, flags := range [][3]bool{{false, false, false}, {true, false, true}, {false, true, false}} {
			out := renderHistoryFileRow(HistoryFileRow{Path: path, Status: "renamed"}, 29, flags[0], flags[1], flags[2])
			if strings.Contains(out, "\n") || lipgloss.Width(out) != 29 {
				t.Fatalf("file row for %q must be exactly 29 cells on one line, got %d: %q", path, lipgloss.Width(out), out)
			}
		}
	}
}

func TestExpandedLongBodyKeepsPaneHeight(t *testing.T) {
	m := newHistoryTestMission()
	model := historyFixtureModel()
	model.History.Header.Body = strings.Repeat("line\n", 60) + "last"
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	m.historyExpanded = true
	out := m.View().Content
	if got := lipgloss.Height(out); got != m.height {
		t.Fatalf("an expanded 61-line description must not grow the frame past %d rows, got %d", m.height, got)
	}
	lines := strings.Split(ansi.Strip(out), "\n")
	y, ok := findHitY(m, historyPaneX(3), hitHistoryFile)
	if !ok || !strings.Contains(lines[y], "lib/mission/model.ts") {
		t.Fatalf("the file row must stay reachable and hit where it paints, y=%d ok=%v", y, ok)
	}
	if !strings.Contains(out, "s1full") {
		t.Fatal("a capped expanded header still keeps its meta line")
	}
}

func sweepHistoryModel() Model {
	model := twoFileHistoryModel()
	model.History.Files = append(model.History.Files, HistoryFileRow{Path: "ui/internal/views/mission/a-rather-long-file-name_test.go", Status: "deleted"})
	model.History.Header.Body = "first line of the description that runs well past a narrow pane\nsecond\nthird\nfourth"
	model.History.Header.Authors = []string{"Matt <m@x>", "Claude <c@x>"}
	model.History.Header.Tags = []string{"v0.9.1"}
	for i, g := range []string{"Today", "Today", "a date group label far longer than the sidebar is wide, which must clip"} {
		model.History.Commits[i].Group = g
	}
	model.Diff = DiffModel{Path: "ui/internal/views/mission/history.go", Kind: "text", Stats: "+349 -16", ReadOnly: true, Lines: []DiffLine{
		{Kind: "hunk", Text: "@@ -5,6 +5,8 @@ func (m *Mission) historyIndex(sha string) int {", SelIdx: -1},
		{Kind: "context", Text: "package mission", OldNo: 5, NewNo: 5, SelIdx: -1},
		{Kind: "del", Text: "\tswitch v.String() { // a deleted line long enough to overflow a narrow diff column", OldNo: 6, SelIdx: -1},
		{Kind: "add", Text: "\tkey := v.String() // an added line long enough to overflow a narrow diff column", NewNo: 6, SelIdx: -1},
	}}
	return model
}

// TestHistoryFrameFitsEveryWidth: a frame taller or wider than the terminal
// scrolls or wraps the whole board, so every History frame must be exactly
// m.height lines of exactly m.width cells.
func TestHistoryFrameFitsEveryWidth(t *testing.T) {
	model := sweepHistoryModel()
	model.History.HasMore = true
	for _, height := range []int{24, 38} {
		for width := 61; width <= 200; width++ {
			for _, expanded := range []bool{false, true} {
				for _, filter := range []string{"", "guard", "zzz"} {
					m := New(nil)
					m.width, m.height = width, height
					if err := m.setModelValue(model); err != nil {
						t.Fatal(err)
					}
					m.historyExpanded = expanded
					if filter != "" {
						typeKeys(m, "/"+filter)
					}
					lines := strings.Split(m.View().Content, "\n")
					if len(lines) != height {
						t.Fatalf("%dx%d expanded=%v filter=%q: frame has %d lines", width, height, expanded, filter, len(lines))
					}
					for y, line := range lines {
						if w := lipgloss.Width(line); w != width {
							t.Fatalf("%dx%d expanded=%v filter=%q row %d: %d cells: %q", width, height, expanded, filter, y, w, ansi.Strip(line))
						}
					}
				}
			}
		}
	}
}

func TestExpandedHeaderCapMarksDroppedRows(t *testing.T) {
	m := newHistoryTestMission()
	model := historyFixtureModel()
	model.History.Header.Body = strings.Repeat("line\n", 60) + "last"
	model.History.Header.Authors = []string{"Matt <m@x>", "Claude <c@x>"}
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	m.historyExpanded = true
	l := m.layout()
	limit := l.bodyH / 2
	header := m.historyHeader(m.diffWidth(), l.bodyH)
	if len(header) != limit {
		t.Fatalf("the capped header should be %d rows, got %d", limit, len(header))
	}
	full := len(historyHeaderLines(*model.History.Header, true, false, m.diffWidth()))
	marker := ansi.Strip(header[limit-2])
	if want := fmt.Sprintf("… %d more lines", full-limit+1); !strings.Contains(marker, want) {
		t.Fatalf("the row above the meta line should read %q, got %q", want, marker)
	}
	if !strings.Contains(header[limit-2], fgSGR(theme.Faint)) {
		t.Fatalf("the marker should be Faint: %q", header[limit-2])
	}
	if !strings.Contains(ansi.Strip(header[limit-1]), "s1full") || !strings.Contains(ansi.Strip(header[0]), "Fix pty paint predicate") {
		t.Fatal("the capped header keeps its title and meta rows")
	}
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if !strings.Contains(lines[l.topH+limit-2], "more lines") {
		t.Fatalf("the frame should paint the marker at row %d: %q", l.topH+limit-2, lines[l.topH+limit-2])
	}
	if h := m.hitTest(historyPaneX(3), l.topH+limit+2); h.kind != hitHistoryFile || !strings.Contains(lines[l.topH+limit+2], "lib/mission/model.ts") {
		t.Fatalf("the file row under a capped header must hit where it paints, got %+v", h)
	}
}

func TestNonContiguousSlateWrapsInsteadOfClipping(t *testing.T) {
	model := historyFixtureModel()
	model.History.Header.RangeCount, model.History.Header.Contiguous = 2, false
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	out := m.renderHistoryPane(60, 20)
	plain := ansi.Strip(out)
	for _, want := range []string{"Unable to display diff", "are selected."} {
		if !strings.Contains(plain, want) {
			t.Fatalf("a 60-cell slate should wrap, not clip, and still show %q:\n%s", want, plain)
		}
	}
	lines := strings.Split(out, "\n")
	if len(lines) != 20 {
		t.Fatalf("the wrapped slate must stay 20 rows, got %d", len(lines))
	}
	for i, line := range lines {
		if w := lipgloss.Width(line); w != 60 {
			t.Fatalf("slate row %d: %d cells, want 60", i, w)
		}
	}
	if got := strings.Split(centeredMessage(10, 2, theme.Faint, "one two three four five six"), "\n"); len(got) != 2 {
		t.Fatalf("a message taller than its box must not grow past the height, got %d rows", len(got))
	}
}

// TestIdleBaseIsTheDriversSelection: the driver re-selects the first commit
// on a reload while the view's cursor stays on a listed commit, so a
// settled move back to the cursor, or a click on it, must still select it.
func TestIdleBaseIsTheDriversSelection(t *testing.T) {
	instantSelectTick(t)
	diverged := func() *Mission {
		m := newHistoryTestMission()
		m.historyCursor = "s3"
		return m
	}
	m := diverged()
	_, up := m.Update(upKey())
	_, down := m.Update(downKey())
	if _, emit := m.Update(up()); emit != nil {
		t.Fatal("the superseded tick must not emit")
	}
	if _, emit := m.Update(down()); emit == nil {
		t.Fatal("settling on s3 while the driver shows s1 must select s3")
	}
	m = diverged()
	m.Update(upKey())
	_, up = m.Update(upKey())
	if _, emit := m.Update(up()); emit != nil || m.historyCursor != "s1" {
		t.Fatalf("settling on s1, the commit the driver shows, must select nothing (cursor %q)", m.historyCursor)
	}
	m = diverged()
	y := m.layout().topH + historyFixedTopRows + 2*historyRowHeight
	if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft}); cmd == nil {
		t.Fatal("clicking the cursor row while the driver shows another commit must select it")
	}
}

func TestHistoryKeysWorkInEveryFocus(t *testing.T) {
	m := newHistoryTestMission()
	m.focus = focusDiff
	m.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	if !m.historyExpanded {
		t.Fatal("e should expand the header from the History diff")
	}
	c := newMouseTestMission()
	c.focus = focusDiff
	c.Update(tea.KeyPressMsg{Code: 'e', Text: "e"})
	if c.historyExpanded {
		t.Fatal("e in the Changes diff must not touch the History header")
	}
	m.focus = focusHistoryFiles
	if _, cmd := m.Update(tea.KeyPressMsg{Code: 'f', Text: "f"}); cmd == nil {
		t.Fatal("f in the file column should run the action")
	}
	m.Update(tea.KeyPressMsg{Code: '/', Text: "/"})
	if m.focus != focusFilter {
		t.Fatalf("/ in the file column should focus the History filter, got %v", m.focus)
	}
	m.focus = focusHistoryFiles
	for _, k := range []rune{'b', 'w', 'r'} {
		m.modal = nil
		m.focus = focusHistoryFiles
		m.Update(tea.KeyPressMsg{Code: k, Text: string(k)})
		if m.modal == nil || m.focus != focusModal {
			t.Fatalf("%c in the file column should open its foldout", k)
		}
	}
}

func TestHistoryWheelIgnoresHeaderRuleAndDivider(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	m.model.Diff.Lines = append(m.model.Diff.Lines, DiffLine{Kind: "context", Text: "y"}, DiffLine{Kind: "context", Text: "z"}, DiffLine{Kind: "context", Text: "w"})
	m.View()
	l := m.layout()
	headerH := len(m.historyHeader(m.diffWidth(), l.bodyH))
	filesW := historyFilesWidth(m.diffWidth())
	fileY, _ := findHitY(m, historyPaneX(3), hitHistoryFile)
	points := [][2]int{
		{historyPaneX(3), l.topH},
		{historyPaneX(filesW + 5), l.topH},
		{historyPaneX(3), l.topH + headerH},
		{historyPaneX(filesW + 5), l.topH + headerH},
		{historyPaneX(filesW), fileY},
	}
	for _, p := range points {
		if _, cmd := m.Update(tea.MouseWheelMsg{X: p[0], Y: p[1], Button: tea.MouseWheelDown}); cmd != nil || m.historyFile != "lib/mission/model.ts" || m.diffCursor != 0 {
			t.Fatalf("a wheel tick at (%d,%d) must be inert, got file=%q diffCursor=%d", p[0], p[1], m.historyFile, m.diffCursor)
		}
	}
}

func TestHistoryHoverFileAndExpander(t *testing.T) {
	m := newHistoryTestMission()
	m.View()
	y, _ := findHitY(m, historyPaneX(3), hitHistoryFile)
	m.Update(tea.MouseMotionMsg{X: historyPaneX(3), Y: y})
	if m.hoverHistoryFile != 0 {
		t.Fatalf("motion over the file row should hover it, got %d", m.hoverHistoryFile)
	}
	m.historyFile = ""
	filesW := historyFilesWidth(m.diffWidth())
	if row := strings.Split(m.View().Content, "\n")[y]; !strings.Contains(ansi.Cut(row, historyPaneX(0), historyPaneX(filesW)), bgSGR(theme.HoverBg)) {
		t.Fatalf("a hovered file row should paint HoverBg: %q", row)
	}
	top := m.layout().topH
	m.Update(tea.MouseMotionMsg{X: historyPaneX(10), Y: top})
	if !m.hoverExpander || m.hoverHistoryFile != -1 {
		t.Fatalf("motion over the title row should hover the expander and clear the file hover, got expander=%v file=%d", m.hoverExpander, m.hoverHistoryFile)
	}
	if row := strings.Split(m.View().Content, "\n")[top]; !strings.Contains(ansi.Cut(row, historyPaneX(0), m.width), bgSGR(theme.HoverBg)) {
		t.Fatalf("the hovered title row should paint HoverBg: %q", row)
	}
	m.Update(tea.MouseMotionMsg{X: 0, Y: 0})
	if m.hoverExpander {
		t.Fatal("leaving the title row should clear the expander hover")
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: historyPaneX(10), Y: top, Button: tea.MouseLeft}); cmd != nil || !m.historyExpanded {
		t.Fatalf("clicking the title row should expand the header without emitting, expanded=%v", m.historyExpanded)
	}
}

func TestHistoryWheelScrollsTheRegionUnderThePointer(t *testing.T) {
	instantSelectTick(t)
	m := twoFileHistoryMission()
	m.View()
	y, _ := findHitY(m, historyPaneX(3), hitHistoryFile)
	_, cmd := m.Update(tea.MouseWheelMsg{X: historyPaneX(3), Y: y, Button: tea.MouseWheelDown})
	if m.historyFile != "lib/mission/driver.ts" {
		t.Fatalf("a wheel tick over the file column should move the file cursor, got %q", m.historyFile)
	}
	if _, ok := cmd().(historyDebounceMsg); !ok {
		t.Fatal("a wheel move over the file column should route through the file debounce")
	}
	m.model.Diff.Lines = append(m.model.Diff.Lines, DiffLine{Kind: "context", Text: "y"}, DiffLine{Kind: "context", Text: "z"}, DiffLine{Kind: "context", Text: "w"})
	filesW := historyFilesWidth(m.diffWidth())
	m.Update(tea.MouseWheelMsg{X: historyPaneX(filesW + 5), Y: y, Button: tea.MouseWheelDown})
	if m.diffCursor != wheelStep {
		t.Fatalf("a wheel tick over the diff should move the diff cursor %d lines, got %d", wheelStep, m.diffCursor)
	}
}

// groupedCommits is n commits in runs of four per date group, each with a
// summary and byline no other commit's starts with, so a painted row names
// exactly one commit.
func groupedCommits(n int) []HistoryCommitRow {
	groups := []string{"Today", "Yesterday", "Earlier this week", "Last week", "August 2026"}
	commits := make([]HistoryCommitRow, n)
	for i := range commits {
		commits[i] = HistoryCommitRow{
			Sha: fmt.Sprintf("sha%02d", i), ShortSha: fmt.Sprintf("sh%02d", i),
			Summary: fmt.Sprintf("subject-%02d", i), Byline: fmt.Sprintf("author-%02d", i), When: "1 day ago",
			Group: groups[min(i/4, len(groups)-1)],
		}
	}
	return commits
}

func groupedMission(t *testing.T, n int, hasMore bool) *Mission {
	t.Helper()
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: groupedCommits(n), HasMore: hasMore}}); err != nil {
		t.Fatal(err)
	}
	return m
}

// listRowText is a painted sidebar row without its thumb column or cursor
// bar, trimmed.
func listRowText(line string) string {
	return strings.TrimSpace(strings.TrimLeft(ansi.Truncate(ansi.Strip(line), sidebarWidth-1, ""), "▌ "))
}

// assertHistoryHitMatchesPaint walks every list row of the painted frame and
// checks the hit test resolves it to what the row shows: a commit's summary
// or byline row to that commit, the action row to itself, and a header,
// rule, notice, or filler row to nothing.
func assertHistoryHitMatchesPaint(t *testing.T, m *Mission, label string) (seen int) {
	t.Helper()
	lines := strings.Split(m.View().Content, "\n")
	l := m.layout()
	commits := m.model.History.Commits
	for y := l.topH + historyFixedTopRows; y < l.topH+l.bodyH; y++ {
		text := listRowText(lines[y])
		want := hit{}
		if strings.HasSuffix(text, "more commits") {
			want = hit{kind: hitHistoryMore}
		}
		for i, c := range commits {
			if c.Summary != "" && strings.HasPrefix(text, c.Summary) || c.Byline != "" && strings.HasPrefix(text, c.Byline) {
				want = hit{kind: hitCommitRow, idx: i}
				seen++
			}
		}
		if got := m.hitTest(2, y); got.kind != want.kind || got.idx != want.idx {
			t.Fatalf("%s: frame row %d paints %q but hits %+v, want %+v", label, y, text, got, want)
		}
	}
	return seen
}

func TestHistoryFilterBoxSitsUnderTheTabs(t *testing.T) {
	m := newHistoryTestMission()
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	top := m.layout().topH
	if !strings.Contains(sidebarPart(lines[top+5]), "Filter history") {
		t.Fatalf("the History filter box should read \"Filter history\" under the tabs gap: %q", lines[top+5])
	}
	if h := m.hitTest(5, top+3); h.kind != hitNone {
		t.Fatalf("the tabs gap stays inert, got %+v", h)
	}
	for y := top + 4; y <= top+6; y++ {
		if h := m.hitTest(5, y); h.kind != hitFilterRow {
			t.Fatalf("frame row %d is the filter box and should hit it, got %+v", y, h)
		}
	}
	if !strings.Contains(sidebarPart(lines[top+7]), "Fix pty paint predicate") {
		t.Fatalf("the commit list should start right under the filter box: %q", lines[top+7])
	}
	if h := m.hitTest(2, top+7); h.kind != hitCommitRow || h.idx != 0 {
		t.Fatalf("the first list row should be commit 0, got %+v", h)
	}
	m.Update(tea.MouseMotionMsg{X: 5, Y: top + 5})
	if !m.hoverFilterRow {
		t.Fatal("motion over the History filter box should hover it")
	}
}

func TestHistoryGroupHeadersOncePerRunAndInert(t *testing.T) {
	m := groupedMission(t, 9, false)
	m.height = 50
	raw := strings.Split(m.View().Content, "\n")
	counts := map[string]int{}
	var headerYs []int
	for y, line := range raw {
		text := listRowText(line)
		switch text {
		case "Today", "Yesterday", "Earlier this week", "Last week", "August 2026":
		default:
			continue
		}
		counts[text]++
		headerYs = append(headerYs, y)
		part := sidebarPart(line)
		if !strings.HasPrefix(ansi.Strip(part), "  "+text) {
			t.Fatalf("a header sits two cells in: %q", ansi.Strip(part))
		}
		if !strings.Contains(part, "1;"+fgSGR(theme.Dim)) && !strings.Contains(part, fgSGR(theme.Dim)+";1") {
			t.Fatalf("a header is bold Dim: %q", part)
		}
		if !strings.Contains(part, bgSGR(theme.Bg)) {
			t.Fatalf("a header sits on Bg: %q", part)
		}
		if next := listRowText(raw[y+1]); !strings.HasPrefix(next, "subject-") {
			t.Fatalf("a header should sit right above its run's first summary, got %q", next)
		}
	}
	if counts["Today"] != 1 || counts["Yesterday"] != 1 || counts["Earlier this week"] != 1 || len(counts) != 3 {
		t.Fatalf("one header per run, got %v", counts)
	}
	if first := listRowText(raw[m.layout().topH+historyFixedTopRows]); first != "Today" {
		t.Fatalf("the list should open on its first run's header, got %q", first)
	}
	for _, y := range headerYs {
		if h := m.hitTest(2, y); h.kind != hitNone {
			t.Fatalf("header row %d must be inert, got %+v", y, h)
		}
		m.Update(tea.MouseMotionMsg{X: 2, Y: y})
		if m.hoverCommit != -1 {
			t.Fatalf("hovering header row %d must hover nothing, got %d", y, m.hoverCommit)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft}); cmd != nil || m.historyCursor != "sha00" {
			t.Fatalf("clicking header row %d must do nothing, cursor %q", y, m.historyCursor)
		}
	}
	if seen := assertHistoryHitMatchesPaint(t, m, "grouped"); seen != 18 {
		t.Fatalf("all nine commits should paint two hit rows each, saw %d", seen)
	}
	assertFullyBgFilled(t, "grouped", m.View().Content, m.width)
}

// TestHistoryWindowKeepsTheCursorBlockAcrossHeaders scrolls a long grouped
// list with the keyboard: the viewport counts header and rule lines, and the
// cursor's summary, byline, and rule all stay painted.
func TestHistoryWindowKeepsTheCursorBlockAcrossHeaders(t *testing.T) {
	instantSelectTick(t)
	m := groupedMission(t, 30, false)
	for range 17 {
		m.Update(downKey())
	}
	if m.historyCursor != "sha17" {
		t.Fatalf("setup: seventeen downs should reach sha17, got %q", m.historyCursor)
	}
	lines := strings.Split(m.View().Content, "\n")
	l := m.layout()
	summaryY := -1
	for y := l.topH + historyFixedTopRows; y < l.topH+l.bodyH; y++ {
		if listRowText(lines[y]) == "subject-17" {
			summaryY = y
		}
	}
	if summaryY < 0 {
		t.Fatal("the cursor's summary scrolled out of view")
	}
	if summaryY+2 >= l.topH+l.bodyH || !strings.HasPrefix(listRowText(lines[summaryY+1]), "author-17") || !strings.HasPrefix(listRowText(lines[summaryY+2]), "───") {
		t.Fatal("the cursor's byline and rule should stay painted under its summary")
	}
	if strings.Contains(ansi.Strip(strings.Join(lines, "\n")), "subject-00") {
		t.Fatal("setup: the list should have scrolled past the first commit")
	}
	assertHistoryHitMatchesPaint(t, m, "scrolled")
}

// typeKeys sends text one printable key at a time and returns the last
// key's cmd.
func typeKeys(m *Mission, text string) tea.Cmd {
	var cmd tea.Cmd
	for _, r := range text {
		_, cmd = m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	return cmd
}

// listSummaries is the commit summaries the list paints, top to bottom.
func listSummaries(m *Mission) []string {
	var out []string
	for _, text := range listTexts(m) {
		if strings.HasPrefix(text, "subject-") || strings.HasPrefix(text, "fix ") {
			out = append(out, strings.Fields(text)[0])
		}
	}
	return out
}

// filterMission is groupedMission with a fruit after each summary. Every
// fixed part of a commit's filter target ("subject-", "author-", "sh",
// digits) avoids the letters i, k, w, and z, so "i" matches exactly fig
// (05), iris (08), and kiwi (10), "iw" only kiwi, and "zzz" nothing.
func filterMission(t *testing.T, hasMore bool) *Mission {
	t.Helper()
	fruit := []string{"apple", "banana", "cherry", "damson", "elder", "fig", "grape", "hazel", "iris", "jujube", "kiwi", "lemon"}
	commits := groupedCommits(len(fruit))
	for i := range commits {
		commits[i].Summary += " " + fruit[i]
	}
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: commits, HasMore: hasMore}}); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestHistoryFilterNarrowsLiveAsYouType(t *testing.T) {
	instantSelectTick(t)
	m := filterMission(t, false)
	typeKeys(m, "/")
	if m.focus != focusFilter {
		t.Fatalf("/ on the History list should focus its filter, got %v", m.focus)
	}
	typeKeys(m, "i")
	if got := strings.Join(listSummaries(m), ","); got != "subject-05,subject-08,subject-10" {
		t.Fatalf("one keystroke should narrow the list with no enter, got %s", got)
	}
	if row := sidebarLine(t, m.View().Content, "❯ i"); !strings.Contains(row, fgSGR(theme.Pink)) {
		t.Fatalf("the focused History filter box shows the typed text in a Pink border: %q", row)
	}
	typeKeys(m, "w")
	if got := strings.Join(listSummaries(m), ","); got != "subject-10" {
		t.Fatalf("a second keystroke narrows again, got %s", got)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if got := strings.Join(listSummaries(m), ","); got != "subject-05,subject-08,subject-10" {
		t.Fatalf("backspace widens the list again, got %s", got)
	}
	if m.filterText != "" || m.model.Filter != "" {
		t.Fatalf("the History filter never touches the Changes filter, got %q", m.filterText)
	}
	assertHistoryHitMatchesPaint(t, m, "filtered")
}

// TestHistoryFilterKeepsMatchesChronological: fzf ranks the tighter match
// first, but the list keeps history order.
func TestHistoryFilterKeepsMatchesChronological(t *testing.T) {
	commits := []HistoryCommitRow{
		{Sha: "a", ShortSha: "a", Summary: "fix the whole pipeline around a parser", Byline: "Pat"},
		{Sha: "b", ShortSha: "b", Summary: "fix parser", Byline: "Sam"},
	}
	targets := []string{commits[0].Summary + " Pat a a", commits[1].Summary + " Sam b b"}
	if ranked := picker.Rank("fixparser", targets, false); len(ranked) != 2 || ranked[0].Index != 1 {
		t.Fatalf("setup: fzf should rank the tighter match first, got %+v", ranked)
	}
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: commits}}); err != nil {
		t.Fatal(err)
	}
	typeKeys(m, "/fixparser")
	if got := strings.Join(listSummaries(m), ","); got != "fix,fix" {
		t.Fatalf("both commits should match, got %s", got)
	}
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	first, second := -1, -1
	for y, line := range lines {
		part := sidebarPart(line)
		if strings.Contains(part, "fix the whole pipeline") && first < 0 {
			first = y
		}
		if strings.Contains(part, "fix parser") && second < 0 {
			second = y
		}
	}
	if first < 0 || second < 0 || first > second {
		t.Fatalf("the older-listed commit must stay first, rows %d and %d", first, second)
	}
}

// TestHistoryFilterReHomesTheCursorWithOneSelect: a keystroke that hides
// the cursor's commit moves the cursor to the first match through the
// ordinary debounce, so fast typing settles into one select.
func TestHistoryFilterReHomesTheCursorWithOneSelect(t *testing.T) {
	instantSelectTick(t)
	m := filterMission(t, false)
	typeKeys(m, "/")
	first := typeKeys(m, "i")
	if m.historyCursor != "sha05" {
		t.Fatalf("hiding sha00 should re-home the cursor to the first match sha05, got %q", m.historyCursor)
	}
	second := typeKeys(m, "w")
	if m.historyCursor != "sha10" {
		t.Fatalf("hiding sha05 should re-home the cursor to sha10, got %q", m.historyCursor)
	}
	if first == nil || second == nil {
		t.Fatal("each re-home schedules the debounced select")
	}
	if _, emit := m.Update(first()); emit != nil {
		t.Fatal("the superseded tick must not emit")
	}
	if _, emit := m.Update(second()); emit == nil {
		t.Fatal("the settled tick selects the re-homed cursor")
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyBackspace}); cmd != nil {
		t.Fatal("an edit that keeps the cursor's commit visible schedules nothing")
	}
	if row := sidebarLine(t, m.View().Content, "subject-10"); !strings.Contains(row, theme.GlyphBar) {
		t.Fatalf("the cursor bar stays on the re-homed commit: %q", row)
	}
}

func TestHistoryFilterEnterKeepsEscClears(t *testing.T) {
	instantSelectTick(t)
	m := filterMission(t, false)
	typeKeys(m, "/iw")
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.focus != focusList {
		t.Fatalf("enter returns focus to the list without emitting, focus %v", m.focus)
	}
	if got := strings.Join(listSummaries(m), ","); got != "subject-10" {
		t.Fatalf("enter keeps the filter, got %s", got)
	}
	if row := sidebarLine(t, m.View().Content, "❯ iw"); strings.Contains(row, fgSGR(theme.Pink)) {
		t.Fatalf("the unfocused box still shows the kept filter, without the focus border: %q", row)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyDown}); cmd != nil || m.historyCursor != "sha10" {
		t.Fatalf("with one match, down has nowhere to go, cursor %q", m.historyCursor)
	}
	typeKeys(m, "/")
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.focus != focusList || len(listSummaries(m)) < 7 {
		t.Fatalf("esc clears the filter and returns to the list, focus %v, %d rows", m.focus, len(listSummaries(m)))
	}
	if !strings.Contains(m.View().Content, "Filter history") {
		t.Fatal("a cleared filter box shows its placeholder again")
	}
	if row := sidebarLine(t, m.View().Content, "subject-10"); !strings.Contains(row, theme.GlyphBar) {
		t.Fatalf("clearing the filter keeps the cursor where it was: %q", row)
	}
}

func TestHistoryFilterBoxClickFocuses(t *testing.T) {
	m := newHistoryTestMission()
	if _, cmd := m.Update(tea.MouseClickMsg{X: 5, Y: m.layout().topH + 5, Button: tea.MouseLeft}); cmd != nil || m.focus != focusFilter {
		t.Fatalf("a click on the History filter box focuses it, focus %v", m.focus)
	}
	typeKeys(m, "guard")
	if got := listTexts(m); !strings.HasPrefix(got[0], "Guard badges") {
		t.Fatalf("typing after the click filters the list, first row %q", got[0])
	}
}

// TestChangesFilterUnaffectedByHistoryFilter: the Changes filter still
// commits through the driver on enter and never reads the History filter.
func TestChangesFilterUnaffectedByHistoryFilter(t *testing.T) {
	m := newMouseTestMission()
	typeKeys(m, "/xy")
	if m.focus != focusFilter || m.filterText != "xy" {
		t.Fatalf("the Changes filter still takes the typed text, got %q", m.filterText)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil {
		t.Fatal("enter on the Changes filter still emits mission:select")
	}
	if !strings.Contains(ansi.Strip(renderFilterRow("", "Filter changes", false, false, sidebarWidth)), "Filter changes") {
		t.Fatal("the Changes placeholder is unchanged")
	}
}

func TestHistoryFilterNoMatches(t *testing.T) {
	m := groupedMission(t, 12, false)
	typeKeys(m, "/zzz")
	texts := listTexts(m)
	notice := -1
	for i, text := range texts {
		if text == "No matching commits" {
			notice = i
		}
	}
	if notice < 0 || notice < len(texts)/2-2 || notice > len(texts)/2+1 {
		t.Fatalf("a centered \"No matching commits\" should fill the empty list:\n%s", strings.Join(texts, "\n"))
	}
	y := m.layout().topH + historyFixedTopRows + notice
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[y]); !strings.Contains(row, fgSGR(theme.Faint)) {
		t.Fatalf("the notice is Faint: %q", row)
	}
	if strings.Contains(strings.Join(texts, "\n"), "more commits") {
		t.Fatal("no action row without hasMore")
	}
	assertHistoryHitMatchesPaint(t, m, "no matches")
	assertFullyBgFilled(t, "no matches", m.View().Content, m.width)

	m = groupedMission(t, 12, true)
	typeKeys(m, "/zzz")
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	moreY := historyRowFrameY(t, m, "Search 100 more commits")
	if row := sidebarPart(strings.Split(m.View().Content, "\n")[moreY]); !strings.Contains(row, theme.GlyphBar) {
		t.Fatalf("with nothing to match, the Search row holds the cursor: %q", row)
	}
	assertHistoryHitMatchesPaint(t, m, "no matches, more")
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.historyMoreFor != 12 {
		t.Fatalf("enter on the Search row requests the next page, historyMoreFor=%d", m.historyMoreFor)
	}
}

// TestHistoryFilteredRangeSpansRealHistory: navigation steps over the
// visible matches, but a shift range still selects every commit between
// anchor and cursor, hidden ones included.
func TestHistoryFilteredRangeSpansRealHistory(t *testing.T) {
	instantSelectTick(t)
	commits := []HistoryCommitRow{
		{Sha: "a", ShortSha: "a", Summary: "alpha one", Byline: "Pat", Selected: true},
		{Sha: "b", ShortSha: "b", Summary: "beta", Byline: "Pat"},
		{Sha: "c", ShortSha: "c", Summary: "gamma", Byline: "Pat"},
		{Sha: "d", ShortSha: "d", Summary: "alpha two", Byline: "Pat"},
	}
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.setModelValue(Model{Tab: "history", History: HistoryModel{Commits: commits, HasMore: true}}); err != nil {
		t.Fatal(err)
	}
	typeKeys(m, "/alpha")
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	historyRowFrameY(t, m, "Search 100 more commits")
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift}); cmd == nil || m.historyCursor != "d" {
		t.Fatalf("shift+down steps over hidden commits to the next match, cursor %q", m.historyCursor)
	}
	if got := strings.Join(m.historySelectionShas(), ","); got != "a,b,c,d" {
		t.Fatalf("the range is the contiguous span in real history, got %s", got)
	}
	out := m.View().Content
	for _, summary := range []string{"alpha one", "alpha two"} {
		if row := sidebarLine(t, out, summary); !strings.Contains(row, bgSGR(theme.SelBg)) {
			t.Fatalf("visible commits in the range wear SelBg: %q", row)
		}
	}
	if _, cmd := m.Update(downKey()); cmd != nil || !m.historyOnMoreRow() {
		t.Fatalf("a plain down from the last match steps onto the Search row, onMore=%v", m.historyOnMore)
	}
	if got := strings.Join(m.historySelectionShas(), ","); got != "a,b,c,d" {
		t.Fatalf("stepping onto the Search row leaves the range as it is, got %s", got)
	}
}

// TestClickAfterLocalNoticeHitsThePaintedRow: a click clears the one-row
// local notice, which lengthens the list; the click must still land on the
// row the noticed frame painted, whether the list follows the cursor at its
// end or holds where the wheel left it.
func TestClickAfterLocalNoticeHitsThePaintedRow(t *testing.T) {
	instantSelectTick(t)
	for _, wheel := range []bool{false, true} {
		m := New(nil)
		m.width, m.height = 130, 38
		commits := groupedCommits(40)
		commits[0].Selected = true
		if err := m.setModelValue(Model{Tab: "history", Current: Current{Repo: "r", Detached: true}, History: HistoryModel{Commits: commits, HasMore: true}}); err != nil {
			t.Fatal(err)
		}
		for range 40 {
			if wheel {
				wheelOverList(m, tea.MouseWheelDown)
			} else {
				m.Update(downKey())
			}
		}
		m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
		if m.noticeText() == "" {
			t.Fatal("setup: b on a detached HEAD posts a local notice")
		}
		lines := strings.Split(m.View().Content, "\n")
		l := m.layout()
		checked := 0
		for y := l.topH + historyFixedTopRows; y < l.topH+l.bodyH; y++ {
			text := listRowText(lines[y])
			save := *m
			m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft})
			switch {
			case strings.HasSuffix(text, "more commits"):
				if m.historyMoreFor != len(commits) {
					t.Fatalf("wheel=%v: a click on the painted action row (frame row %d) should request a page", wheel, y)
				}
				checked++
			case strings.HasPrefix(text, "subject-") || strings.HasPrefix(text, "author-"):
				if got := m.model.History.Commits[m.historyIndex(m.historyCursor)]; !strings.HasPrefix(text, got.Summary) && !strings.HasPrefix(text, got.Byline) {
					t.Fatalf("wheel=%v: a click on frame row %d painting %q selected %q", wheel, y, text, got.Summary)
				}
				checked++
			default:
				if m.historyCursor != save.historyCursor || m.historyMoreFor != save.historyMoreFor {
					t.Fatalf("wheel=%v: a click on inert frame row %d painting %q changed the selection to %q", wheel, y, text, m.historyCursor)
				}
			}
			*m = save
		}
		if checked < 10 {
			t.Fatalf("wheel=%v: setup: only %d clickable rows painted", wheel, checked)
		}
	}
}

// TestChangesClickAfterLocalNoticeHitsThePaintedRow: the docked commit box
// sits one row higher while the notice shows, so a click on the painted
// description box's top border must focus the description, not the summary
// box painted above it.
func TestChangesClickAfterLocalNoticeHitsThePaintedRow(t *testing.T) {
	m := newMouseTestMission()
	m.localNotice = "menu lands with polish"
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	y := -1
	for i, line := range lines {
		if strings.Contains(sidebarPart(line), "Description") {
			y = i
		}
	}
	if y < 1 {
		t.Fatal("setup: the description box is not painted")
	}
	m.Update(tea.MouseClickMsg{X: 5, Y: y - 1, Button: tea.MouseLeft})
	if m.focus != focusDescription {
		t.Fatalf("a click on the painted description box border should focus the description, got focus %v", m.focus)
	}
}

func TestFullFrameHistoryPaneStatesFullyPaintBackground(t *testing.T) {
	m := twoFileHistoryMission()
	model := twoFileHistoryModel()
	model.History.Header.Body = "first\n\nthird"
	model.History.Header.Tags = []string{"v0.9.1"}
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	m.historyExpanded = true
	m.focus = focusHistoryFiles
	m.View()
	y, _ := findHitY(m, historyPaneX(3), hitHistoryFile)
	m.Update(tea.MouseMotionMsg{X: historyPaneX(3), Y: y + 1})
	assertFullyBgFilled(t, "history pane", m.View().Content, m.width)

	m.Update(tea.MouseMotionMsg{X: historyPaneX(10), Y: m.layout().topH})
	assertFullyBgFilled(t, "hovered title", m.View().Content, m.width)

	model.History.Header.RangeCount = 2
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	assertFullyBgFilled(t, "range header", m.View().Content, m.width)

	model.Diff = DiffModel{Kind: "none", ReadOnly: true}
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ansi.Strip(m.View().Content), "No file selected") {
		t.Fatal("a History diff with files but none selected should read \"No file selected\"")
	}
	assertFullyBgFilled(t, "no file selected", m.View().Content, m.width)

	model.History.Files = nil
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	if plain := ansi.Strip(m.View().Content); strings.Contains(plain, "No file selected") || strings.Contains(plain, "select a file") {
		t.Fatal("a commit with no files suppresses the diff message")
	}
	assertFullyBgFilled(t, "no files", m.View().Content, m.width)

	model.History.Header = nil
	if err := m.setModelValue(model); err != nil {
		t.Fatal(err)
	}
	assertFullyBgFilled(t, "slate", m.View().Content, m.width)
}
