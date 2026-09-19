package mission

import (
	"encoding/json"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/session"
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
		Action:  ActionModel{Kind: "pull", Title: "Pull origin", Meta: "2 commits behind", Ahead: 3, Behind: 2},
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
		// The segment's rest-state BgSubtle band now combines into the same
		// SGR run as the icon's own foreground, so the color and the glyph
		// are checked separately rather than as one adjoining "fgm+glyph" run.
		if !strings.Contains(out, fgSGR(c.color)) {
			t.Fatalf("%s glyph should wear its accent color %q in\n%s", c.kind, fgSGR(c.color), out)
		}
		if !strings.Contains(ansi.Strip(out), c.glyph) {
			t.Fatalf("%s glyph %q missing from\n%s", c.kind, c.glyph, out)
		}
	}
}

func TestRenderBranchSegmentDetachedValueWearsPeach(t *testing.T) {
	out := renderBranchSegment(Model{Current: Current{Detached: true, Branch: "a1b2c3d"}}, 40, false, false)
	// The rest-state BgSubtle band combines into the same SGR run as the
	// value's own foreground, so the bold+fg run is checked without
	// requiring it to be immediately followed by "m".
	if !strings.Contains(out, "1;"+fgSGR(theme.Peach)) {
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

// TestClipNonPositiveWidthReturnsEmpty pins the guard clip needs because
// lipgloss v2.0.6's MaxWidth does not truncate on a zero or negative budget:
// without the early return, clip(s, 0) would fall through to Render(s) and
// hand back the full, unclipped string.
func TestClipNonPositiveWidthReturnsEmpty(t *testing.T) {
	if out := clip("hello", 0); out != "" {
		t.Fatalf("clip(_, 0) = %q, want empty", out)
	}
	if out := clip("hello", -3); out != "" {
		t.Fatalf("clip(_, -3) = %q, want empty", out)
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

// TestRenderCommitBoxAmendingOverridesButtonLabel pins item 5: amending
// swaps the button's own text for "Amend last commit" (a display-only
// override -- the enabled flag the caller computed still gates the button's
// treatment, amending or not), while a non-amending box keeps the wire label.
func TestRenderCommitBoxAmendingOverridesButtonLabel(t *testing.T) {
	const wireLabel = "Commit 2 files to main"
	amending := renderCommitBox(sidebarWidth, "", "", true, wireLabel, false)
	amendingPlain := ansi.Strip(amending)
	if !strings.Contains(amendingPlain, "Amend last commit") {
		t.Fatalf("amending commit box should show \"Amend last commit\":\n%s", amendingPlain)
	}
	if strings.Contains(amendingPlain, wireLabel) {
		t.Fatalf("amending commit box must not still show the wire label:\n%s", amendingPlain)
	}
	if !strings.Contains(amending, bgSGR(theme.Panel)) {
		t.Fatalf("amending with CanCommit false should still wear Panel (disabled): %q", amending)
	}

	notAmending := ansi.Strip(renderCommitBox(sidebarWidth, "", "", false, wireLabel, true))
	if !strings.Contains(notAmending, wireLabel) {
		t.Fatalf("non-amending commit box should keep the wire label:\n%s", notAmending)
	}
	if strings.Contains(notAmending, "Amend last commit") {
		t.Fatalf("non-amending commit box must not show the amend override:\n%s", notAmending)
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

// TestRenderDiffLineHunkHeaderStaysOneRow pins the one-row invariant diffHit
// relies on: lipgloss wraps (rather than truncates) non-inline content at a
// fixed Width, so an unclipped function-context suffix would otherwise spill
// onto a second row and desync gutter-click targeting.
func TestRenderDiffLineHunkHeaderStaysOneRow(t *testing.T) {
	longHeader := "@@ -120,7 +120,9 @@ func someVeryLongFunctionNameThatWouldWrapWithoutClipping(argOne, argTwo, argThree int) error {"
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "hunk", Text: longHeader}, 40, false, false)
	if strings.Contains(out, "\n") {
		t.Fatalf("hunk header must render as exactly one row: %q", out)
	}
}

func TestRenderDiffLineSelectedAddShowsPinkBar(t *testing.T) {
	out := renderDiffLine(DiffModel{}, DiffLine{Kind: "add", Text: "import x", Selected: true, SelIdx: 0}, 40, false, false)
	// The row's own Bg fill combines into the same SGR run as the bar's
	// foreground, so the color and the glyph are checked separately.
	if !strings.Contains(out, fgSGR(theme.Pink)) {
		t.Fatalf("selected add line should show a Pink stage bar: %q", out)
	}
	if !strings.Contains(ansi.Strip(out), theme.GlyphBar) {
		t.Fatalf("selected add line missing the stage bar glyph: %q", out)
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

// TestRenderDiffPaneNoneWithChangesShowsSelectAFile pins the pre-seed state
// (docs/design/mission/EmptyState.png only replaces the truly clean case):
// changes exist but the driver's own selection hasn't landed yet, so the
// pane still shows the plain hint rather than the empty-state card.
func TestRenderDiffPaneNoneWithChangesShowsSelectAFile(t *testing.T) {
	m := &Mission{}
	m.model.Changes = []ChangeRow{{Path: "a.go", Status: "modified", Include: "none"}}
	m.model.ChangedTotal = 1
	out := ansi.Strip(m.renderDiffPane(60, 10))
	if !strings.Contains(out, "select a file") {
		t.Fatalf("empty diff with changes missing the select-a-file hint:\n%s", out)
	}
	if strings.Contains(out, "No local changes") {
		t.Fatalf("empty diff with changes must not show the clean-worktree card:\n%s", out)
	}
}

// TestRenderDiffPaneFilteredToEmptyWithNonzeroTotalShowsSelectAFile pins a
// CodeRabbit finding on PR rt#353: the wire's Changes field is the FILTERED
// list (lib/mission/model.ts computes changedTotal from allChanges, before
// the filter narrows changes), so a filter that matches nothing on a dirty
// worktree must not read as "the worktree is clean" -- ChangedTotal, not
// len(Changes), is the empty-state gate.
func TestRenderDiffPaneFilteredToEmptyWithNonzeroTotalShowsSelectAFile(t *testing.T) {
	m := &Mission{}
	m.model.Changes = nil // the typed filter matched none of the real changes
	m.model.ChangedTotal = 3
	out := ansi.Strip(m.renderDiffPane(60, 10))
	if !strings.Contains(out, "select a file") {
		t.Fatalf("filtered-to-empty diff with a nonzero total missing the select-a-file hint:\n%s", out)
	}
	if strings.Contains(out, "No local changes") {
		t.Fatalf("filtered-to-empty diff with a nonzero total must not show the clean-worktree card:\n%s", out)
	}
}

// ─── empty state (docs/design/mission/EmptyState.png) ──────────────────

// TestRenderDiffPaneEmptyStateShowsTitleAndAllFourHints pins the
// clean-worktree card's content: zero changes and no diff shows the title,
// subline, and all four key hints, replacing the lone "select a file" line.
func TestRenderDiffPaneEmptyStateShowsTitleAndAllFourHints(t *testing.T) {
	m := &Mission{}
	out := ansi.Strip(m.renderDiffPane(60, 20))
	for _, want := range []string{
		"No local changes",
		"the working tree is clean",
		"f  run the fetch/pull/push action",
		"b  switch branch",
		"w  switch worktree",
		"r  switch repository",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("empty state missing %q:\n%s", want, out)
		}
	}
}

// TestRenderDiffPaneEmptyStateCentersWithinPaneWidth pins the layout half:
// the title and every hint line sit centered within the diff pane's own
// width, not flush left.
func TestRenderDiffPaneEmptyStateCentersWithinPaneWidth(t *testing.T) {
	m := &Mission{}
	const width = 60
	out := ansi.Strip(m.renderDiffPane(width, 20))
	for _, want := range []string{"No local changes", "the working tree is clean", "run the fetch/pull/push action"} {
		line := lineContaining(t, out, want)
		if lipgloss.Width(line) != width {
			t.Fatalf("line %q should pad to the pane width %d, got %d", line, width, lipgloss.Width(line))
		}
		leading := len(line) - len(strings.TrimLeft(line, " "))
		trailing := len(line) - len(strings.TrimRight(line, " "))
		if leading < 2 || trailing < 2 {
			t.Fatalf("line should carry roughly equal padding on both sides to read as centered: %q (leading=%d trailing=%d)", line, leading, trailing)
		}
	}
}

// TestRenderDiffPaneEmptyStateColorsTitleKeysAndLabels pins the token
// contract: the title is bold Text, a hint's key is bold Pink, its label
// Dimmer.
func TestRenderDiffPaneEmptyStateColorsTitleKeysAndLabels(t *testing.T) {
	m := &Mission{}
	out := m.renderDiffPane(60, 20)
	if !strings.Contains(out, "1;"+fgSGR(theme.Text)) {
		t.Fatalf("title should wear bold Text: %q", out)
	}
	if !strings.Contains(out, "1;"+fgSGR(theme.Pink)) {
		t.Fatalf("a hint key should wear bold Pink: %q", out)
	}
	if !strings.Contains(out, fgSGR(theme.Dimmer)) {
		t.Fatalf("a hint label should wear Dimmer: %q", out)
	}
}

// TestRenderEmptyStateCardNarrowWidthDoesNotWrapOrGrow pins a CodeRabbit
// finding on PR rt#353: renderEmptyStateCard pre-padded every line to its
// own natural widest line BEFORE applying the pane's own width, so a pane
// narrower than the longest hint ("f  run the fetch/pull/push action")
// left lipgloss to WRAP that overflowing line rather than truncate it,
// growing the block past height and pushing whatever follows it down a
// row. The card must still come back at exactly height rows, each exactly
// width cells, however narrow the pane is.
func TestRenderEmptyStateCardNarrowWidthDoesNotWrapOrGrow(t *testing.T) {
	const width, height = 20, 10
	out := renderEmptyStateCard(width, height)
	lines := strings.Split(out, "\n")
	if len(lines) != height {
		t.Fatalf("narrow card should render exactly %d rows, got %d:\n%s", height, len(lines), ansi.Strip(out))
	}
	for i, line := range lines {
		if w := lipgloss.Width(line); w != width {
			t.Fatalf("row %d should be exactly width %d, got %d: %q", i, width, w, line)
		}
	}
}

func lineContaining(t *testing.T, out, want string) string {
	t.Helper()
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, want) {
			return line
		}
	}
	t.Fatalf("no line contains %q:\n%s", want, out)
	return ""
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

// TestModalGuardedBranchRowNameOnlyReasonMovedToHeader pins the item-3
// reshuffle: the row itself drops its own inline GuardedBy text (that detail
// now lives only in the group header, item 1), and its rendered line has the
// lock glyph positioned after the label rather than in the leading status
// column a current-row dot would occupy.
func TestModalGuardedBranchRowNameOnlyReasonMovedToHeader(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	out := ansi.Strip(m.View().Content)
	if strings.Contains(out, "checked out in worktree frodo") {
		t.Fatalf("the row-level guard reason should have moved to the group header, not stayed inline:\n%s", out)
	}
	nameLine := ""
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "rt-190-picker-polish") {
			nameLine = line
			break
		}
	}
	if nameLine == "" {
		t.Fatalf("guarded row name missing from the modal:\n%s", out)
	}
	nameIdx := strings.Index(nameLine, "rt-190-picker-polish")
	lockIdx := strings.Index(nameLine, theme.GlyphLock)
	if lockIdx == -1 || lockIdx < nameIdx {
		t.Fatalf("lock glyph should trail the branch name (right edge, badge slot): %q", nameLine)
	}
}

// TestModalGroupHeadersLabelEveryGroupInBranchAndRepoModals pins item 1: a
// Dimmer header line names each group -- "recent" (present even though it is
// the first group GroupContiguous orders), the fixed guarded-reason banner
// (never a row's own specific GuardedBy text), and a repo's own Group value.
func TestModalGroupHeadersLabelEveryGroupInBranchAndRepoModals(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	branchOut := m.View().Content
	for _, want := range []string{"recent", "other", "guarded · checked out in another worktree"} {
		if !strings.Contains(ansi.Strip(branchOut), want) {
			t.Fatalf("branch modal missing group header %q:\n%s", want, branchOut)
		}
	}
	// "recent" is the first group GroupContiguous orders (it holds the
	// current branch); pinning its own header line's color -- not just
	// Dimmer's presence anywhere in the frame -- confirms the FIRST group
	// gets a header too, not only later boundaries. The composited frame
	// carries the sidebar's own content to the left of the modal on this
	// same row, so the header is found by its "│ recent" border-plus-text
	// shape (modalGroupHeaderLine's own leading space, right after the
	// box's left border), not by the whole line's trimmed text.
	found := false
	for _, line := range strings.Split(branchOut, "\n") {
		plain := ansi.Strip(line)
		if !strings.Contains(plain, "│ recent") {
			continue
		}
		found = true
		if !strings.Contains(line, fgSGR(theme.Dimmer)) {
			t.Fatalf("the recent group's own header should wear Dimmer: %q", line)
		}
	}
	if !found {
		t.Fatalf("recent group header line not found:\n%s", branchOut)
	}

	m2 := newTestMission()
	m2.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	repoOut := ansi.Strip(m2.View().Content)
	if !strings.Contains(repoOut, "recent") {
		t.Fatalf("repo modal missing its own Group value as a header:\n%s", repoOut)
	}
}

// TestModalWorktreeStaysFlatWithNoGroupHeaders pins item 1's other half: the
// worktree modal never groups, so it must show neither a group header nor
// the fixed guarded-reason banner text.
func TestModalWorktreeStaysFlatWithNoGroupHeaders(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	out := ansi.Strip(m.View().Content)
	if strings.Contains(out, "guarded · checked out") {
		t.Fatalf("worktree modal must never show a group header:\n%s", out)
	}
}

// TestModalFilterPlaceholdersPerModal pins item 4: each foldout's empty-query
// placeholder names itself, and the worktree one appends the current repo.
func TestModalFilterPlaceholdersPerModal(t *testing.T) {
	cases := []struct {
		key  rune
		want string
	}{
		{'r', "filter repos"},
		{'b', "filter branches"},
		{'w', "filter worktrees · repo-tools"},
	}
	for _, c := range cases {
		m := newTestMission()
		m.Update(tea.KeyPressMsg{Code: c.key, Text: string(c.key)})
		out := ansi.Strip(m.View().Content)
		if !strings.Contains(out, c.want) {
			t.Fatalf("%c modal missing placeholder %q:\n%s", c.key, c.want, out)
		}
	}
}

// TestModalKeybarListsOnlyWiredKeysPerModal pins item 2: each foldout's own
// keybar row, inside the border, names exactly its wired keys and never the
// boards' unwired ctrl-f/ctrl-w/ctrl-d.
func TestModalKeybarListsOnlyWiredKeysPerModal(t *testing.T) {
	cases := []struct {
		key  rune
		want string
	}{
		{'r', "enter open · esc close"},
		{'b', "enter checkout · ctrl-n new branch · esc close"},
		{'w', "enter switch · ctrl-n provision · esc close"},
	}
	for _, c := range cases {
		m := newTestMission()
		m.Update(tea.KeyPressMsg{Code: c.key, Text: string(c.key)})
		out := ansi.Strip(m.View().Content)
		if !strings.Contains(out, c.want) {
			t.Fatalf("%c modal keybar: want %q in:\n%s", c.key, c.want, out)
		}
		for _, banned := range []string{"ctrl-f", "ctrl-w", "ctrl-d"} {
			if strings.Contains(out, banned) {
				t.Fatalf("%c modal keybar must never show the unwired %q:\n%s", c.key, banned, out)
			}
		}
	}
}

// TestModalKeybarWearsMainKeybarGrammar pins the color half of item 2: the
// key glyph wears KeybarKey, bold, the label KeybarLabel -- the same tokens
// renderKeybar (changes.go) uses for the main bar. Bold combines into one
// SGR run alongside the foreground and (here, unlike the main bar) an
// explicit Surface background, so this checks for bold's "1" parameter and
// the KeybarKey color as two members of that run rather than assuming which
// order lipgloss lists them in.
func TestModalKeybarWearsMainKeybarGrammar(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	out := m.View().Content
	keybarLine := ""
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(ansi.Strip(line), "enter open") {
			keybarLine = line
			break
		}
	}
	if keybarLine == "" {
		t.Fatalf("modal keybar line not found:\n%s", out)
	}
	if !strings.Contains(keybarLine, fgSGR(theme.KeybarKey)) || !strings.Contains(keybarLine, ";1m") {
		t.Fatalf("modal keybar key should wear bold KeybarKey: %q", keybarLine)
	}
	if !strings.Contains(keybarLine, fgSGR(theme.KeybarLabel)) {
		t.Fatalf("modal keybar label should wear KeybarLabel: %q", keybarLine)
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

// ─── notice strip ───────────────────────────────────────────────────────

// TestModelPushWithWireNoticePaintsIt: the driver's own refusals arrive in
// the wire model's Notice field and must reach the notice strip, exactly
// like a view-local refusal does.
func TestModelPushWithWireNoticePaintsIt(t *testing.T) {
	m := newTestMission()
	mod := modalFixtureModel()
	mod.Notice = "amend refused: stack root"
	raw, err := json.Marshal(mod)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := m.Update(session.ModelUpdate{Raw: raw})
	m = next.(*Mission)
	if out := ansi.Strip(m.View().Content); !strings.Contains(out, "amend refused: stack root") {
		t.Fatalf("wire Notice never painted:\n%s", out)
	}
}

// TestWireNoticeWinsOverLocalNotice: when both the wire Notice and a
// view-local refusal are pending, the driver's own wins the single strip.
func TestWireNoticeWinsOverLocalNotice(t *testing.T) {
	m := newTestMission()
	m.model.Notice = "wire refusal"
	m.localNotice = "local refusal"
	out := ansi.Strip(m.View().Content)
	if !strings.Contains(out, "wire refusal") {
		t.Fatalf("wire notice should paint:\n%s", out)
	}
	if strings.Contains(out, "local refusal") {
		t.Fatalf("local notice must yield to the wire one:\n%s", out)
	}
}

// ─── commit drafts vs pushes ────────────────────────────────────────────

// TestPushNeverClobbersDraftsOrAmendToggle: local drafts are authoritative.
// A model push while a draft sits in a NON-focused field (focus is the list
// here) must keep the draft, and must never reset a locally toggled amend.
func TestPushNeverClobbersDraftsOrAmendToggle(t *testing.T) {
	m := newTestMission()
	m.summaryInput.SetValue("draft summary")
	m.descriptionInput.SetValue("draft description")
	m.amendLocal = true

	raw, err := json.Marshal(modalFixtureModel())
	if err != nil {
		t.Fatal(err)
	}
	next, _ := m.Update(session.ModelUpdate{Raw: raw})
	m = next.(*Mission)

	if got := m.summaryInput.Value(); got != "draft summary" {
		t.Fatalf("push clobbered the summary draft: %q", got)
	}
	if got := m.descriptionInput.Value(); got != "draft description" {
		t.Fatalf("push clobbered the description draft: %q", got)
	}
	if !m.amendLocal {
		t.Fatal("push reset the local amend toggle")
	}
}

// TestPushSeedsEmptyCommitFields: wire values still land, but only into
// fields that hold no draft.
func TestPushSeedsEmptyCommitFields(t *testing.T) {
	m := newTestMission()
	mod := modalFixtureModel()
	mod.Commit.Summary = "wire summary"
	mod.Commit.Description = "wire description"
	raw, err := json.Marshal(mod)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := m.Update(session.ModelUpdate{Raw: raw})
	m = next.(*Mission)

	if got := m.summaryInput.Value(); got != "wire summary" {
		t.Fatalf("empty summary field should seed from the wire: %q", got)
	}
	if got := m.descriptionInput.Value(); got != "wire description" {
		t.Fatalf("empty description field should seed from the wire: %q", got)
	}
}

// TestCommitEmitClearsLocalDrafts: sending the commit is what clears the
// box -- the wire can no longer do it, since drafts outrank pushes.
func TestCommitEmitClearsLocalDrafts(t *testing.T) {
	m := newTestMission()
	m.model.Commit.CanCommit = true
	m.focus = focusSummary
	m.summaryInput.SetValue("msg")
	m.descriptionInput.SetValue("body")
	m.amendLocal = true
	_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter, Mod: tea.ModCtrl})
	if cmd == nil {
		t.Fatal("ctrl+enter with the gate open must emit")
	}
	if m.summaryInput.Value() != "" || m.descriptionInput.Value() != "" || m.amendLocal {
		t.Fatalf("emitting the commit should clear the local drafts: %q %q amend=%v",
			m.summaryInput.Value(), m.descriptionInput.Value(), m.amendLocal)
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
// file-row click contract; a lone click moves the cursor and emits that
// row's select (covered by TestMouseClickFileRowEmitsOnlyOnRowChange below).
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

// TestMouseClickFileRowEmitsOnlyOnRowChange pins the single-click half: a
// click on the row already under the cursor is inert, while a click that
// moves the cursor to a different row emits that row's mission:select so
// the driver loads its diff.
func TestMouseClickFileRowEmitsOnlyOnRowChange(t *testing.T) {
	m := newMouseTestMission()
	next, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: 8, Button: tea.MouseLeft})
	m = next.(*Mission)
	if cmd != nil {
		t.Fatal("a click on the row already under the cursor must not emit")
	}
	next, cmd = m.Update(tea.MouseClickMsg{X: 20, Y: 10, Button: tea.MouseLeft})
	m = next.(*Mission)
	if m.selected != "c.go" {
		t.Fatalf("click should move the cursor to row 2, got %q", m.selected)
	}
	if m.focus != focusList {
		t.Fatalf("a file-row click should land in list focus, got %v", m.focus)
	}
	if cmd == nil {
		t.Fatal("a click that changed the cursor row must emit mission:select")
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

// commitButtonY returns the commit button's absolute frame row via the SAME
// layout() arithmetic View paints with (mission.go's sidebarBlocks/
// sidebarHit split), so a click test never hardcodes a y that drifts when
// the sidebar's bottom-dock gap resizes.
func commitButtonY(m *Mission) int {
	l := m.layout()
	off := 1 // the rule above the commit box
	if m.amendLocal {
		off++
	}
	off += 3 // summary box
	off += 4 // description box
	return l.topH + l.sidebarTopH + l.sidebarFillerH + off
}

// TestMouseClickCommitButtonGuardsOnCanCommit mirrors the keyboard's own
// ctrl-enter guard (mission_test.go's TestCtrlEnterDoesNotEmitWithEmptySummary):
// with CanCommit false, no local amend, and no summary, a button click must
// not emit.
func TestMouseClickCommitButtonGuardsOnCanCommit(t *testing.T) {
	m := newMouseTestMission() // ButtonLabel set, CanCommit left false
	_, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: commitButtonY(m), Button: tea.MouseLeft})
	if cmd != nil {
		t.Fatal("a commit-button click with the gate closed must not emit")
	}
}

// TestMouseClickCommitButtonEmitsWhenEnabled: CanCommit true plus a typed
// summary opens the click path.
func TestMouseClickCommitButtonEmitsWhenEnabled(t *testing.T) {
	m := newMouseTestMission()
	m.model.Commit.CanCommit = true
	m.summaryInput.SetValue("msg")
	_, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: commitButtonY(m), Button: tea.MouseLeft})
	if cmd == nil {
		t.Fatal("a commit-button click with the gate open must emit")
	}
}

// TestMouseClickCommitButtonEnabledByLocalAmend: a local amend toggle opens
// the same click path even while the wire CanCommit is false (nothing
// staged), since amending re-uses the last commit's own changes.
func TestMouseClickCommitButtonEnabledByLocalAmend(t *testing.T) {
	m := newMouseTestMission()
	m.amendLocal = true
	m.summaryInput.SetValue("msg")
	_, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: commitButtonY(m), Button: tea.MouseLeft})
	if cmd == nil {
		t.Fatal("a commit-button click while locally amending must emit")
	}
}

// TestCommitButtonRendersDisabledUntilSummaryTyped pins the render half of
// the commit gate: the Pink (enabled) button treatment appears only once a
// summary exists, even with the wire CanCommit true.
func TestCommitButtonRendersDisabledUntilSummaryTyped(t *testing.T) {
	m := newMouseTestMission()
	m.model.Commit.CanCommit = true
	if strings.Contains(m.View().Content, bgSGR(theme.Pink)) {
		t.Fatalf("empty-summary frame must not paint the enabled Pink button")
	}
	m.summaryInput.SetValue("msg")
	if !strings.Contains(m.View().Content, bgSGR(theme.Pink)) {
		t.Fatalf("typed-summary frame should paint the enabled Pink button")
	}
}

// ─── sidebar bottom-dock ────────────────────────────────────────────────

// TestCommitButtonDocksToSidebarBottomWithShortList pins the Main.png/
// EmptyState.png contract: with a short Changes list, the stash/rule/
// commit-box/undo block sits at the BOTTOM of the sidebar column, not
// floating directly under the list, so the commit button's row is derived
// from the pane height (layout()'s own sidebarFillerH) rather than the row
// count.
func TestCommitButtonDocksToSidebarBottomWithShortList(t *testing.T) {
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = mouseFixtureModel() // 3 changes rows, no stash, no undo
	m.summaryInput.SetValue("msg")

	l := m.layout()
	if l.sidebarFillerH == 0 {
		t.Fatalf("setup: expected a nonzero filler gap for a 3-row list at height 30, got layout=%+v", l)
	}
	wantY := l.topH + l.sidebarTopH + l.sidebarFillerH + 1 /*rule*/ + 3 /*summary box*/ + 4 /*description box*/

	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if wantY >= len(lines) || !strings.Contains(lines[wantY], "Commit 3 files to main") {
		got := ""
		if wantY < len(lines) {
			got = lines[wantY]
		}
		t.Fatalf("commit button should dock at layout-derived row %d, got %q", wantY, got)
	}
}

// TestSidebarFillerRowsAreBgFilledAndBlank pins the gap itself: every row
// between the changes list and the docked block is blank (no stray content)
// and still wears the Bg fill Change 1 established, not a bare terminal
// default.
func TestSidebarFillerRowsAreBgFilledAndBlank(t *testing.T) {
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = mouseFixtureModel()

	l := m.layout()
	rawLines := strings.Split(m.View().Content, "\n")
	plainLines := strings.Split(ansi.Strip(m.View().Content), "\n")
	for y := l.topH + l.sidebarTopH; y < l.topH+l.sidebarTopH+l.sidebarFillerH; y++ {
		sidebarPlain := plainLines[y][:min(len(plainLines[y]), sidebarWidth)]
		if strings.TrimSpace(sidebarPlain) != "" {
			t.Fatalf("filler row %d should be blank in the sidebar column, got %q", y, sidebarPlain)
		}
		if !strings.Contains(rawLines[y], bgSGR(theme.Bg)) {
			t.Fatalf("filler row %d should still wear the Bg fill: %q", y, rawLines[y])
		}
	}
}

// TestCommitButtonDocksToSidebarBottomWithZeroChanges covers
// EmptyState.png: with no changes at all the docked block still sits at
// the pane's bottom, not immediately under the (empty) list.
func TestCommitButtonDocksToSidebarBottomWithZeroChanges(t *testing.T) {
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = Model{
		Current: Current{Repo: "repo-tools", Branch: "main"},
		Commit:  CommitModel{ButtonLabel: "Commit 0 files to main"},
	}

	l := m.layout()
	if l.sidebarFillerH == 0 {
		t.Fatalf("setup: expected a nonzero filler gap with zero changes, got layout=%+v", l)
	}
	wantY := l.topH + l.sidebarTopH + l.sidebarFillerH + 1 + 3 + 4

	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if wantY >= len(lines) || !strings.Contains(lines[wantY], "Commit 0 files to main") {
		got := ""
		if wantY < len(lines) {
			got = lines[wantY]
		}
		t.Fatalf("commit button should dock at layout-derived row %d, got %q", wantY, got)
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

// TestMiddleTruncateClipsWideRunesToDisplayWidth pins the CJK-path fix: the
// old rune-count guard let a run of double-width runes through unclipped
// because their rune count fit even though their cell width did not.
func TestMiddleTruncateClipsWideRunesToDisplayWidth(t *testing.T) {
	wide := strings.Repeat("文", 15) + ".go"
	out := middleTruncate(wide, 20)
	if lipgloss.Width(out) > 20 {
		t.Fatalf("middleTruncate must not exceed its display-width budget: width=%d w=20 %q", lipgloss.Width(out), out)
	}
}

// TestRenderChangeRowWideRuneFilenameStaysAtWidth exercises the same defect
// through the real caller: an unclipped CJK path wraps lipgloss's
// non-inline Width() block onto extra rows (Width pads/wraps but never
// truncates), so the row must still come back as exactly one line.
func TestRenderChangeRowWideRuneFilenameStaysAtWidth(t *testing.T) {
	row := ChangeRow{Path: strings.Repeat("文件", 20) + "/main.go", Status: "modified", Include: "none"}
	out := renderChangeRow(row, 40, false, false)
	if strings.Contains(out, "\n") {
		t.Fatalf("change row must render as exactly one row: %q", out)
	}
	if lipgloss.Width(out) != 40 {
		t.Fatalf("change row must render at exactly width 40, got %d: %q", lipgloss.Width(out), out)
	}
}

// ─── surface fills (docs/design/mission/Main.png: filled top and keybar
// bands, no terminal-default bleed-through anywhere in the frame) ─────────

// TestTopBarSegmentRestPaintsBgSubtleBandFullWidth pins the top-bar band: at
// rest (no hover, no open foldout) both the label and value rows wear
// BgSubtle from the very first cell through the trailing pad, not just
// behind the text itself.
func TestTopBarSegmentRestPaintsBgSubtleBandFullWidth(t *testing.T) {
	out := renderRepoSegment(pullModel(), sidebarWidth, false, false)
	lines := strings.Split(out, "\n")
	if len(lines) != 2 {
		t.Fatalf("segment should render exactly 2 rows, got %d:\n%s", len(lines), out)
	}
	labelRow, valueRow := lines[0], lines[1]
	if !strings.Contains(labelRow, bgSGR(theme.BgSubtle)) {
		t.Fatalf("label row should wear the BgSubtle band: %q", labelRow)
	}
	if idx := strings.LastIndex(labelRow, bgSGR(theme.BgSubtle)); idx <= strings.Index(labelRow, "Current Repository") {
		t.Fatalf("BgSubtle should still be painting the trailing pad after the label text: %q", labelRow)
	}
	if !strings.Contains(valueRow, bgSGR(theme.BgSubtle)) {
		t.Fatalf("value row should wear the BgSubtle band: %q", valueRow)
	}
	if idx := strings.LastIndex(valueRow, bgSGR(theme.BgSubtle)); idx <= strings.Index(valueRow, "repo-tools") {
		t.Fatalf("BgSubtle should still be painting the trailing pad after the value text: %q", valueRow)
	}
}

// TestTopBarSegmentHoverAndOpenStillWinOverBgSubtleBand guards the
// composition-order caution: hover's HoverBg and an open foldout's Surface
// must still replace the rest-state BgSubtle band, never sit beside it.
func TestTopBarSegmentHoverAndOpenStillWinOverBgSubtleBand(t *testing.T) {
	hovered := renderRepoSegment(pullModel(), sidebarWidth, true, false)
	if strings.Contains(hovered, bgSGR(theme.BgSubtle)) {
		t.Fatalf("hovered segment must not still carry the rest BgSubtle band: %q", hovered)
	}
	if !strings.Contains(hovered, bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered segment should wear HoverBg: %q", hovered)
	}
	open := renderRepoSegment(pullModel(), sidebarWidth, false, true)
	if strings.Contains(open, bgSGR(theme.BgSubtle)) {
		t.Fatalf("open segment must not still carry the rest BgSubtle band: %q", open)
	}
	if !strings.Contains(open, bgSGR(theme.Surface)) {
		t.Fatalf("open segment should wear Surface: %q", open)
	}
}

// TestRenderChangeRowRestPaintsBgBandFullWidth pins the body-row half of the
// same contract: a Changes row at rest (no cursor, no hover) wears Bg from
// the leading cursor gutter through the trailing pad past the path text.
func TestRenderChangeRowRestPaintsBgBandFullWidth(t *testing.T) {
	out := renderChangeRow(ChangeRow{Path: "a.go", Status: "modified", Include: "none"}, sidebarWidth, false, false)
	if !strings.Contains(out, bgSGR(theme.Bg)) {
		t.Fatalf("row at rest should wear the Bg band: %q", out)
	}
	if idx := strings.LastIndex(out, bgSGR(theme.Bg)); idx <= strings.Index(out, "a.go") {
		t.Fatalf("Bg should still be painting the trailing pad after the path text: %q", out)
	}
}

// ─── Nerd Font segment icons ───────────────────────────────────────────

// TestTopBarSegmentsWearNerdFontOcticons pins the repo/worktree/branch
// segments to their ratified octicons (docs/design/mission/README.md),
// replacing the old checkbox-state glyphs; the checkbox family itself
// (renderChangeRow, renderMasterRow) is untouched, so this only checks the
// top bar.
func TestTopBarSegmentsWearNerdFontOcticons(t *testing.T) {
	m := pullModel()
	repo := renderRepoSegment(m, sidebarWidth, false, false)
	if !strings.Contains(ansi.Strip(repo), theme.GlyphRepo) {
		t.Fatalf("repo segment missing its Nerd Font icon: %q", repo)
	}
	worktree := renderWorktreeSegment(m, 40, false, false)
	if !strings.Contains(ansi.Strip(worktree), theme.GlyphWorktree) {
		t.Fatalf("worktree segment missing its Nerd Font icon: %q", worktree)
	}
	branch := renderBranchSegment(Model{Current: Current{Branch: "main"}}, 40, false, false)
	if !strings.Contains(ansi.Strip(branch), theme.GlyphBranch) {
		t.Fatalf("branch segment missing its Nerd Font icon: %q", branch)
	}
}

// TestRenderBranchSegmentDetachedUsesBranchGlyphNotCircle pins the
// detached state's own half: it keeps its Peach treatment and "On <sha>"
// value, but drops the old ○/● circle swap in favor of the same branch
// octicon the normal state wears.
func TestRenderBranchSegmentDetachedUsesBranchGlyphNotCircle(t *testing.T) {
	out := renderBranchSegment(Model{Current: Current{Detached: true, Branch: "a1b2c3d"}}, 40, false, false)
	stripped := ansi.Strip(out)
	if !strings.Contains(stripped, theme.GlyphBranch) {
		t.Fatalf("detached segment should still wear the branch octicon: %q", out)
	}
	if strings.Contains(stripped, "○") || strings.Contains(stripped, "●") {
		t.Fatalf("detached segment must drop the old circle-glyph swap: %q", out)
	}
	// The detached VALUE text ("On a1b2c3d") also wears Peach, so a bare
	// Contains(out, fgSGR(Peach)) would still pass even if the icon itself
	// lost its own Peach foreground; sgrImmediatelyBefore anchors the check
	// to the glyph's own adjacent SGR run instead.
	glyphIdx := strings.Index(out, theme.GlyphBranch)
	if glyphIdx == -1 {
		t.Fatalf("branch octicon not found in detached segment: %q", out)
	}
	if sgr := sgrImmediatelyBefore(out, glyphIdx); !strings.Contains(sgr, fgSGR(theme.Peach)) {
		t.Fatalf("detached segment's icon should wear Peach at the glyph itself, got SGR %q in: %q", sgr, out)
	}
}

// sgrImmediatelyBefore returns the raw SGR escape sequence
// ("\x1b[...m") sitting immediately before idx in s, or "" if idx isn't
// immediately preceded by one -- used to pin a color to the exact glyph it
// paints rather than to "appears somewhere in this render."
func sgrImmediatelyBefore(s string, idx int) string {
	if idx < 2 || s[idx-1] != 'm' {
		return ""
	}
	start := strings.LastIndex(s[:idx-1], "\x1b[")
	if start == -1 {
		return ""
	}
	return s[start:idx]
}

// TestNerdFontIconsMeasureAsOneCell pins the PUA-codepoint width footgun:
// go-runewidth must measure these as single cells or renderSegment's own
// prefix-width padding math (topbar.go) silently drifts by one.
func TestNerdFontIconsMeasureAsOneCell(t *testing.T) {
	for _, g := range []string{theme.GlyphRepo, theme.GlyphWorktree, theme.GlyphBranch} {
		if w := lipgloss.Width(g); w != 1 {
			t.Fatalf("glyph %q should measure as 1 cell, got %d", g, w)
		}
	}
}

// TestRenderKeybarRestPaintsBgSubtleBandFullWidth pins the keybar band: its
// own trailing pad (after "q quit," the last thing justify places) still
// wears BgSubtle, not just the text ahead of it.
func TestRenderKeybarRestPaintsBgSubtleBandFullWidth(t *testing.T) {
	out := renderKeybar(120)
	if !strings.Contains(out, bgSGR(theme.BgSubtle)) {
		t.Fatalf("keybar should wear the BgSubtle band: %q", out)
	}
	if idx := strings.LastIndex(out, bgSGR(theme.BgSubtle)); idx <= strings.LastIndex(out, "quit") {
		t.Fatalf("BgSubtle should still be painting after the trailing \"quit\" label: %q", out)
	}
}

// ─── full-frame background fill (every cell, not just spot rows) ────────

// sgrParamsRe matches one SGR escape's parameter list.
var sgrParamsRe = regexp.MustCompile("\x1b\\[([0-9;]*)m")

// bgCoverage walks a single already-rendered frame line the way a real
// terminal applies SGR state while printing, and returns, per visible
// column, whether that cell carries an explicit background (48;2;.../
// 48;5;...) rather than falling through to the terminal's own default. A
// spot-row "Contains(bgSGR(...))" check only proves a color appears
// somewhere in the line; this is what actually proves the WHOLE row is
// covered, which is what caught the holes a spot check missed (a bare
// clip() ellipsis, an unstyled pill separator, an unstyled border cell).
func bgCoverage(line string) []bool {
	cover := make([]bool, 0, len(line))
	hasBg := false
	i := 0
	for i < len(line) {
		if loc := sgrParamsRe.FindStringIndex(line[i:]); loc != nil && loc[0] == 0 {
			params := strings.Split(sgrParamsRe.FindStringSubmatch(line[i:])[1], ";")
			for pi := 0; pi < len(params); pi++ {
				switch params[pi] {
				case "", "0", "49":
					hasBg = false
				case "38":
					if pi+1 < len(params) {
						if params[pi+1] == "2" {
							pi += 4
						} else if params[pi+1] == "5" {
							pi += 2
						}
					}
				case "48":
					hasBg = true
					if pi+1 < len(params) {
						if params[pi+1] == "2" {
							pi += 4
						} else if params[pi+1] == "5" {
							pi += 2
						}
					}
				}
			}
			i += loc[1]
			continue
		}
		r := []rune(line[i:])[0]
		cover = append(cover, hasBg)
		i += len(string(r))
	}
	return cover
}

// assertFullyBgFilled fails with the first uncovered cell it finds in any
// row of content, naming the row/column/line so a regression is easy to
// place back in the source.
func assertFullyBgFilled(t *testing.T, label, content string, width int) {
	t.Helper()
	for y, line := range strings.Split(content, "\n") {
		cov := bgCoverage(line)
		if len(cov) != width {
			t.Fatalf("%s row %d: rendered width %d, want %d: %q", label, y, len(cov), width, line)
		}
		for x, has := range cov {
			if !has {
				t.Fatalf("%s row %d col %d has no background fill (terminal default would bleed through): %q", label, y, x, line)
			}
		}
	}
}

// TestFullFramePopulatedEveryRowFullyPaintsBackground pins the whole-frame
// contract at cell granularity against the shared fixture (repo/worktree/
// branch segments, a 3-row Changes list with a partial row, a stash strip,
// an undo strip with a summary long enough to clip, and a real diff): every
// column of every row -- both panes and the divider -- carries an explicit
// background.
func TestFullFramePopulatedEveryRowFullyPaintsBackground(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", "session-model-mission.json"))
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(b, &envelope); err != nil {
		t.Fatal(err)
	}
	m := New(nil)
	m.width, m.height = 130, 38
	if err := m.SetModel(envelope.Model); err != nil {
		t.Fatal(err)
	}
	assertFullyBgFilled(t, "populated", m.View().Content, m.width)
}

// TestFullFrameEmptyStateEveryRowFullyPaintsBackground is the same contract
// against docs/design/mission/EmptyState.png's scenario: zero changes, the
// sidebar's bottom-dock filler in play, and the diff pane's centered card.
// Goes through SetModel (a real wire push), not a direct m.model assignment:
// leaving Commit.Placeholder unseeded routes the summary/description
// textinputs through a different internal render branch than production
// ever takes, and is its own false hole.
func TestFullFrameEmptyStateEveryRowFullyPaintsBackground(t *testing.T) {
	m := New(nil)
	m.width, m.height = 100, 30
	raw, err := json.Marshal(Model{
		Current: Current{Repo: "repo-tools", Branch: "main"},
		Commit:  CommitModel{ButtonLabel: "Commit 0 files to main", Placeholder: "Summary (required)"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(raw); err != nil {
		t.Fatal(err)
	}
	assertFullyBgFilled(t, "empty-state", m.View().Content, m.width)
}
