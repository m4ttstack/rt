package mission

import (
	"fmt"
	"image/color"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

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

// bgSGR is fgSGR's background counterpart, mirroring the picker view's
// helper of the same name (picker_test.go).
func bgSGR(c color.Color) string {
	r, g, b, _ := c.RGBA()
	return fmt.Sprintf("48;2;%d;%d;%d", r>>8, g>>8, b>>8)
}

func TestRenderChangeRowPartialShowsMixedGlyphAndMeta(t *testing.T) {
	out := renderChangeRow(ChangeRow{Path: "lib/ui/pick.ts", Status: "modified", Include: "partial"}, sidebarWidth, false, false)
	if !strings.Contains(out, "◪") {
		t.Fatalf("partial row missing the mixed glyph:\n%s", out)
	}
	if !strings.Contains(out, "partial") {
		t.Fatalf("partial row missing its \"partial\" meta:\n%s", out)
	}
}

func TestRenderChangeRowAllAndNoneGlyphs(t *testing.T) {
	all := renderChangeRow(ChangeRow{Path: "a.go", Status: "new", Include: "all"}, sidebarWidth, false, false)
	if !strings.Contains(all, theme.GlyphOn) {
		t.Fatalf("all-included row missing %q:\n%s", theme.GlyphOn, all)
	}
	if strings.Contains(all, "partial") {
		t.Fatalf("all-included row must not show partial meta:\n%s", all)
	}
	none := renderChangeRow(ChangeRow{Path: "b.go", Status: "deleted", Include: "none"}, sidebarWidth, false, false)
	if !strings.Contains(none, theme.GlyphStopped) {
		t.Fatalf("none-included row missing %q:\n%s", theme.GlyphStopped, none)
	}
}

// TestRenderChangeRowHoverPaintsHoverBgUnlessCursor pins the mouse board's
// row/cursor split: a hovered row not under the cursor wears HoverBg, but
// hover on the cursor row must never displace its own SelBg.
func TestRenderChangeRowHoverPaintsHoverBgUnlessCursor(t *testing.T) {
	hovered := renderChangeRow(ChangeRow{Path: "a.go", Status: "modified", Include: "none"}, sidebarWidth, false, true)
	if !strings.Contains(hovered, bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered non-cursor row should wear HoverBg:\n%s", hovered)
	}
	cursorHovered := renderChangeRow(ChangeRow{Path: "a.go", Status: "modified", Include: "none"}, sidebarWidth, true, true)
	if strings.Contains(cursorHovered, bgSGR(theme.HoverBg)) {
		t.Fatalf("hover must never override the cursor row's SelBg:\n%s", cursorHovered)
	}
	if !strings.Contains(cursorHovered, bgSGR(theme.SelBg)) {
		t.Fatalf("cursor row should keep SelBg while hovered:\n%s", cursorHovered)
	}
}

func TestRenderCommitButtonDisabledWearsPanelBg(t *testing.T) {
	out := renderCommitButton(40, "Commit 2 files to main", false)
	if !strings.Contains(out, bgSGR(theme.Panel)) {
		t.Fatalf("disabled button should wear Panel bg: %q", out)
	}
	enabled := renderCommitButton(40, "Commit 2 files to main", true)
	if !strings.Contains(enabled, bgSGR(theme.Pink)) {
		t.Fatalf("enabled button should wear Pink bg: %q", enabled)
	}
}

func TestRenderUndoStripAppearsWithFixtureModel(t *testing.T) {
	out := renderUndoStrip(LastCommit{Summary: "fix parser", When: "2 minutes ago", Undoable: true}, sidebarWidth)
	for _, want := range []string{"Committed 2 minutes ago", "fix parser", "Undo"} {
		if !strings.Contains(out, want) {
			t.Fatalf("undo strip missing %q:\n%s", want, out)
		}
	}
}

// TestRenderUndoStripClipsLongSummaryToSidebarWidth pins the fix for the
// overflow mouseFixtureModel's own comment routes around: a last-commit
// summary wider than the strip's available space must not push the composed
// line past sidebarWidth, or it drags the whole sidebar block wider with it.
func TestRenderUndoStripClipsLongSummaryToSidebarWidth(t *testing.T) {
	longSummary := strings.Repeat("a very long commit summary that keeps going ", 5)
	out := renderUndoStrip(LastCommit{Summary: longSummary, When: "2 minutes ago", Undoable: true}, sidebarWidth)
	for _, line := range strings.Split(out, "\n") {
		if w := lipgloss.Width(line); w != sidebarWidth {
			t.Fatalf("undo strip row width = %d, want sidebarWidth %d:\n%s", w, sidebarWidth, out)
		}
	}
}

func TestRenderKeybarContainsSpaceStage(t *testing.T) {
	out := ansi.Strip(renderKeybar(100))
	if !strings.Contains(out, "space stage") {
		t.Fatalf("keybar missing \"space stage\":\n%s", out)
	}
	if !strings.Contains(out, "q quit") {
		t.Fatalf("keybar missing \"q quit\":\n%s", out)
	}
}

func TestRenderDiffLineHunkPaintsSurfaceAndLav(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "hunk", Text: "@@ -1,3 +1,4 @@"}, 40, false, false)
	if !strings.Contains(out, bgSGR(theme.Surface)) {
		t.Fatalf("hunk line should wear Surface bg: %q", out)
	}
	if !strings.Contains(out, fgSGR(theme.Lav)) {
		t.Fatalf("hunk line should wear Lav text: %q", out)
	}
	if !strings.Contains(out, "@@ -1,3 +1,4 @@") {
		t.Fatalf("hunk line missing its text: %q", out)
	}
}

func TestRenderDiffLineSelectedAddShowsPinkBar(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "add", Text: "import x", Selected: true, SelIdx: 0}, 40, false, false)
	if !strings.Contains(out, fgSGR(theme.Pink)+"m"+theme.GlyphBar) {
		t.Fatalf("selected add line should show a Pink stage bar: %q", out)
	}
}

func TestRenderDiffLineUnselectedShowsNoBar(t *testing.T) {
	out := ansi.Strip(renderDiffLine(DiffModel{}, DiffLine{Kind: "context", Text: "unchanged"}, 40, false, false))
	if strings.Contains(out, theme.GlyphBar) {
		t.Fatalf("unselected line must not show the stage bar glyph: %q", out)
	}
}

// TestRenderDiffLineHoverPaintsRowHoverBg pins the diff pane's own row-hover
// paint, independent of the gutter-specific bar preview.
func TestRenderDiffLineHoverPaintsRowHoverBg(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "context", Text: "unchanged"}, 40, true, false)
	if !strings.Contains(out, bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered diff line should wear HoverBg: %q", out)
	}
}

// TestRenderDiffLineGutterHoverPreviewsBarInGutterHoverColor pins the
// gutter-specific hover cue: an unselected add/del line's stage bar previews
// in GutterHoverBar, distinct from the solid Pink a selected line wears.
func TestRenderDiffLineGutterHoverPreviewsBarInGutterHoverColor(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "add", Text: "import x", SelIdx: 0}, 40, true, true)
	// The bar's foreground and the row's HoverBg background combine into one
	// SGR escape (the "m" terminator sits after both parameter runs), so this
	// checks the color and the glyph separately rather than one joined run.
	if !strings.Contains(out, fgSGR(theme.GutterHoverBar)) {
		t.Fatalf("gutter-hovered unselected line should preview the bar in GutterHoverBar: %q", out)
	}
	if !strings.Contains(ansi.Strip(out), theme.GlyphBar) {
		t.Fatalf("gutter-hovered unselected line should show the stage bar glyph: %q", out)
	}
}

func TestRenderDiffPaneBinaryShowsExactMessage(t *testing.T) {
	m := &Mission{}
	m.model.Diff = DiffModel{Kind: "binary", Path: "logo.png"}
	out := ansi.Strip(m.renderDiffPane(60, 10))
	if !strings.Contains(out, "This binary file has changed.") {
		t.Fatalf("binary diff missing its exact message:\n%s", out)
	}
}

func TestRenderDiffPaneNoneShowsSelectAFile(t *testing.T) {
	m := &Mission{}
	out := ansi.Strip(m.renderDiffPane(60, 10))
	if !strings.Contains(out, "select a file") {
		t.Fatalf("empty diff missing the select-a-file hint:\n%s", out)
	}
}

// modalFixtureModel mirrors ui/fixtures/session-model-mission.json's repo/
// branch/worktree rows (kept in sync by hand: model_test.go pins the same
// fixture's field values) without paying JSON decode cost per test.
func modalFixtureModel() Model {
	return Model{
		Current: Current{Repo: "repo-tools", RepoLabel: "repo-tools", Branch: "rt-191-mission-tui"},
		Repos: []RepoRow{
			{ID: "repo-tools", Label: "repo-tools", Group: "recent", Current: true,
				Badge: Badge{Staged: 1, Unstaged: 2, Untracked: 1, Ahead: 3, Behind: 2}},
			{ID: "chat", Label: "chat", Group: "recent", Badge: Badge{Clean: true}},
		},
		Branches: []BranchRow{
			{Name: "rt-191-mission-tui", Current: true, Ahead: 3, Behind: 2, Group: "recent"},
			{Name: "main", Ahead: 0, Behind: 5, Group: "other"},
			{Name: "rt-190-picker-polish", GuardedBy: "checked out in worktree frodo", Group: "guarded"},
		},
		Worktrees: []WorktreeRow{
			{Path: "/w/gandalf", Name: "gandalf", Branch: "rt-191-mission-tui", Current: true},
			{Path: "/w/frodo", Name: "frodo", Branch: "rt-190-picker-polish", OnDeck: true},
		},
	}
}

func newTestMission() *Mission {
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = modalFixtureModel()
	return m
}

func TestModalOpenDimsParentAndEscRestoresUndimmed(t *testing.T) {
	m := newTestMission()
	before := m.View().Content
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	opened := m.View().Content
	if opened == before {
		t.Fatalf("opening the repo modal left the frame unchanged")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	after := m.View().Content
	if after != before {
		t.Fatalf("esc did not restore the undimmed parent:\nbefore:\n%s\nafter:\n%s", before, after)
	}
}

func TestModalFilterNarrowsViaMatchRank(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	m.Update(tea.KeyPressMsg{Code: 'c', Text: "c"})
	m.Update(tea.KeyPressMsg{Code: 'h', Text: "h"})
	out := m.View().Content
	if !strings.Contains(out, "chat") {
		t.Fatalf("filtered modal missing the matching row:\n%s", out)
	}
	// The dimmed parent's own top bar keeps showing "repo-tools" as the
	// current-repo label regardless of the modal's filter, so the ranked
	// match set -- not a screen-wide substring check -- is the only reliable
	// way to assert the non-matching row actually dropped out of the list.
	if len(m.modal.matches) != 1 || m.modal.rows[m.modal.matches[0].Index].value != "chat" {
		t.Fatalf("match.Rank should leave exactly the \"chat\" row: %+v", m.modal.matches)
	}
}

func TestModalGuardedBranchRowSkippedByCursorMovement(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	if row, ok := m.modal.selectedRow(); !ok || row.value != "rt-191-mission-tui" {
		t.Fatalf("initial cursor: %+v ok=%v", row, ok)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if row, ok := m.modal.selectedRow(); !ok || row.value != "main" {
		t.Fatalf("after one down: %+v ok=%v", row, ok)
	}
	// The guarded row sits right after "main"; a second down must skip it
	// straight to the action slot rather than landing on it.
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if !m.modal.onActionSlot() {
		t.Fatalf("expected the action slot after skipping the guarded row, cursor=%d", m.modal.cursor)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if !m.modal.onActionSlot() {
		t.Fatalf("cursor moved past the last slot")
	}
}

func TestModalGuardedBranchRowIsDimmerWithLockGlyph(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	out := m.View().Content
	if !strings.Contains(out, fgSGR(theme.Dimmer)+"m"+theme.GlyphLock) {
		t.Fatalf("guarded row should show the lock glyph in Dimmer:\n%s", out)
	}
}

func TestModalRepoRowsShowDirtyAheadBehindBadges(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	out := m.View().Content
	for _, want := range []string{fgSGR(theme.Peach) + "m●4", fgSGR(theme.Mint) + "m2↓", fgSGR(theme.Cyan) + "m3↑"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in repo modal:\n%s", want, out)
		}
	}
}

func TestModalRepoCleanRowShowsMintCheck(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	out := m.View().Content
	if !strings.Contains(out, fgSGR(theme.Mint)+"m"+theme.GlyphDone) {
		t.Fatalf("clean repo row missing the Mint check:\n%s", out)
	}
}

func TestModalWorktreeCurrentGlyphMintAndOnDeckReady(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	out := m.View().Content
	if !strings.Contains(out, fgSGR(theme.Mint)+"m"+theme.GlyphOn) {
		t.Fatalf("current worktree row missing Mint %s:\n%s", theme.GlyphOn, out)
	}
	if !strings.Contains(out, "ready") {
		t.Fatalf("on-deck worktree row missing its ready label:\n%s", out)
	}
}

func TestModalBranchActionRowWearsLavAndActionHighlight(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if !m.modal.onActionSlot() {
		t.Fatalf("setup: expected the action slot, cursor=%d", m.modal.cursor)
	}
	out := m.View().Content
	if !strings.Contains(out, "New branch from rt-191-mission-tui") {
		t.Fatalf("missing the action row label:\n%s", out)
	}
	// The row's foreground and background combine into one SGR escape, so
	// the "m" terminator sits after both parameter runs, not right after fg.
	if !strings.Contains(out, fgSGR(theme.Lav)) {
		t.Fatalf("action row should wear Lav:\n%s", out)
	}
	if !strings.Contains(out, bgSGR(theme.ActionHighlight(theme.Lav))) {
		t.Fatalf("cursor on the action row should wear ActionHighlight bg:\n%s", out)
	}
}

// TestModalRowHoverPaintsHoverBgUnlessCursor mirrors the changes row's own
// hover/cursor split inside the modal overlay.
func TestModalRowHoverPaintsHoverBgUnlessCursor(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	m.modal.hoverRow = 1
	out := m.View().Content
	if !strings.Contains(out, bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered modal row should wear HoverBg:\n%s", out)
	}
}

// ─── mouse routing ──────────────────────────────────────────────────────

// mouseFixtureModel is a small, self-contained model for the mouse-routing
// tests below: three Changes rows and a short diff, laid out identically to
// s5open's subprocess fixture (mission_test.go) -- tabs(2)+filter(3)+
// master(1) body rows ahead of the list, no stash/amend/undo strip -- so the
// row-index-to-y arithmetic below stays this short and fixed rather than
// depending on whichever commit summary a lastCommit fixture happens to carry.
func mouseFixtureModel() Model {
	return Model{
		Current: Current{Repo: "repo-tools", Branch: "main"},
		Changes: []ChangeRow{
			{Path: "a.go", Status: "modified", Include: "none"},
			{Path: "b.go", Status: "modified", Include: "none"},
			{Path: "c.go", Status: "modified", Include: "none"},
		},
		ChangedTotal: 3,
		Diff: DiffModel{
			Path: "a.go", Kind: "text",
			Lines: []DiffLine{
				{Kind: "context", Text: "one"},
				{Kind: "context", Text: "two"},
				{Kind: "context", Text: "three"},
				{Kind: "context", Text: "four"},
				{Kind: "context", Text: "five"},
			},
		},
		Commit: CommitModel{ButtonLabel: "Commit 3 files to main"},
	}
}

func newMouseTestMission() *Mission {
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = mouseFixtureModel()
	m.selected = "a.go"
	return m
}

// TestMouseMotionOverFileRowSetsHoverNotCursor pins the mouse board's
// central invariant inside mission's own Update wiring (render_test.go
// already pins the row-paint half via renderChangeRow directly): motion
// over a non-cursor row sets the render hint, never the cursor.
func TestMouseMotionOverFileRowSetsHoverNotCursor(t *testing.T) {
	m := newMouseTestMission()
	next, _ := m.Update(tea.MouseMotionMsg{X: 10, Y: 9}) // row index 1 ("b.go")
	m = next.(*Mission)
	if m.hoverFile != 1 {
		t.Fatalf("hovering row 1 should set hoverFile=1, got %d", m.hoverFile)
	}
	if m.selected != "a.go" {
		t.Fatalf("hover must never move the cursor, got selected=%q", m.selected)
	}
	lines := strings.Split(m.View().Content, "\n")
	if !strings.Contains(lines[9], bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered row should paint HoverBg:\n%s", lines[9])
	}
	if !strings.Contains(lines[8], bgSGR(theme.SelBg)) || strings.Contains(lines[8], bgSGR(theme.HoverBg)) {
		t.Fatalf("cursor row must keep SelBg, never HoverBg:\n%s", lines[8])
	}
}

// TestMouseWheelOverDiffScrollsIt is the brief's own Step 1 example: a wheel
// tick with the pointer over the diff pane moves the diff line cursor
// (there being no scroll offset independent of the cursor -- see
// mouseWheel's own comment), which is what actually slides the window.
func TestMouseWheelOverDiffScrollsIt(t *testing.T) {
	m := newMouseTestMission()
	next, _ := m.Update(tea.MouseWheelMsg{X: 60, Y: 5, Button: tea.MouseWheelDown})
	m = next.(*Mission)
	if m.diffCursor != wheelStep {
		t.Fatalf("wheel down over the diff pane should move diffCursor by wheelStep, got %d", m.diffCursor)
	}
	next, _ = m.Update(tea.MouseWheelMsg{X: 60, Y: 5, Button: tea.MouseWheelUp})
	m = next.(*Mission)
	if m.diffCursor != 0 {
		t.Fatalf("wheel up should move diffCursor back down, got %d", m.diffCursor)
	}
}

// TestMouseWheelOverListMovesListCursor covers the base list's own half of
// the same contract, clamped to the last row once wheelStep overruns it.
func TestMouseWheelOverListMovesListCursor(t *testing.T) {
	m := newMouseTestMission()
	next, _ := m.Update(tea.MouseWheelMsg{X: 10, Y: 9, Button: tea.MouseWheelDown})
	m = next.(*Mission)
	if m.selected != "c.go" {
		t.Fatalf("wheel down over the list should move the cursor to the last row, got %q", m.selected)
	}
}

// TestMouseWheelOverModalMovesCursorSkippingGuardedRow covers the third
// pane: the overlay's own cursor, via its existing moveCursor (which already
// skips a guarded row for the keyboard).
func TestMouseWheelOverModalMovesCursorSkippingGuardedRow(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	next, _ := m.Update(tea.MouseWheelMsg{Button: tea.MouseWheelDown})
	m = next.(*Mission)
	if row, ok := m.modal.selectedRow(); !ok || row.value != "main" {
		t.Fatalf("wheel down in the branch modal should move to \"main\", got %+v ok=%v", row, ok)
	}
}

// TestMouseDoubleClickFileRowFocusesDiff pins the double-click half of the
// file-row click contract; a lone click only moves the cursor (covered by
// TestMouseClickFileRowMovesCursorWithoutEmitting below).
func TestMouseDoubleClickFileRowFocusesDiff(t *testing.T) {
	m := newMouseTestMission()
	now := time.Now()
	m.nowFn = func() time.Time { return now }
	m.Update(tea.MouseClickMsg{X: 20, Y: 9, Button: tea.MouseLeft})
	now = now.Add(100 * time.Millisecond)
	next, _ := m.Update(tea.MouseClickMsg{X: 20, Y: 9, Button: tea.MouseLeft})
	m = next.(*Mission)
	if m.focus != focusDiff {
		t.Fatalf("a second click within the window should focus the diff, got focus=%v", m.focus)
	}
	if m.selected != "b.go" {
		t.Fatalf("double click should have selected row 1's path, got %q", m.selected)
	}
}

// TestMouseClickFileRowMovesCursorWithoutEmitting pins the single-click
// half: it moves the cursor into list focus, and produces no intent.
func TestMouseClickFileRowMovesCursorWithoutEmitting(t *testing.T) {
	m := newMouseTestMission()
	next, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: 10, Button: tea.MouseLeft})
	m = next.(*Mission)
	if m.selected != "c.go" {
		t.Fatalf("click should move the cursor to row 2, got %q", m.selected)
	}
	if m.focus != focusList {
		t.Fatalf("a file-row click should land in list focus, got %v", m.focus)
	}
	if cmd != nil {
		t.Fatal("a single click on a file row must not emit")
	}
}

// TestMouseClickFilterRowFocusesFilter pins the filter zone (absolute y in
// [2,5): tabs takes y 0-1, the filter box the next three).
func TestMouseClickFilterRowFocusesFilter(t *testing.T) {
	m := newMouseTestMission()
	next, _ := m.Update(tea.MouseClickMsg{X: 5, Y: 4, Button: tea.MouseLeft})
	m = next.(*Mission)
	if m.focus != focusFilter {
		t.Fatalf("clicking the filter row should focus the filter, got %v", m.focus)
	}
}

// TestMouseClickCommitButtonGuardsOnCanCommit mirrors the keyboard's own
// ctrl-enter guard (mission_test.go's TestCtrlEnterDoesNotEmitWhenCanCommitFalse):
// a commit-button click with CanCommit false must not emit.
func TestMouseClickCommitButtonGuardsOnCanCommit(t *testing.T) {
	m := newMouseTestMission() // ButtonLabel set, CanCommit left false
	_, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: 19, Button: tea.MouseLeft})
	if cmd != nil {
		t.Fatal("a commit-button click with CanCommit false must not emit")
	}
}

func TestMiddleTruncateKeepsHeadAndTail(t *testing.T) {
	long := "ui/internal/views/mission/some/very/deep/nested/file.go"
	out := middleTruncate(long, 20)
	if lipgloss.Width(out) != 20 {
		t.Fatalf("middleTruncate width = %d, want 20: %q", lipgloss.Width(out), out)
	}
	if !strings.HasPrefix(out, "ui/in") {
		t.Fatalf("middleTruncate dropped the head: %q", out)
	}
	if !strings.HasSuffix(out, "file.go") {
		t.Fatalf("middleTruncate dropped the tail (the filename): %q", out)
	}
	if !strings.Contains(out, "…") {
		t.Fatalf("middleTruncate missing the ellipsis: %q", out)
	}
}
