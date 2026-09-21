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
	"rt-ui/internal/views/picker"
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

// TestRenderSegmentChevronSitsTwoCellsBeforeTheRightEdge pins the owner's
// ratified breathing-room ruling (2026-09-20, "mission segment chevrons get
// their right padding"): the chevron used to render flush against the
// divider; now it sits 2 cells of the segment's own background in from the
// right edge, for all three foldout segments. The action segment has no
// chevron and is covered separately (TestRenderActionSegmentPillsStayFlush).
func TestRenderSegmentChevronSitsTwoCellsBeforeTheRightEdge(t *testing.T) {
	const width = 40
	cases := []struct {
		name string
		out  string
	}{
		{"repo", renderRepoSegment(pullModel(), width, false, false)},
		{"worktree", renderWorktreeSegment(pullModel(), width, false, false)},
		{"branch", renderBranchSegment(Model{Current: Current{Branch: "main"}}, width, false, false)},
	}
	chevronRune := []rune(theme.GlyphChevron)[0]
	for _, c := range cases {
		lines := strings.Split(c.out, "\n")
		row2 := []rune(ansi.Strip(lines[1]))
		if len(row2) != width {
			t.Fatalf("%s: value row should be exactly %d cells, got %d: %q", c.name, width, len(row2), string(row2))
		}
		chevronIdx := -1
		for i, r := range row2 {
			if r == chevronRune {
				chevronIdx = i
				break
			}
		}
		if chevronIdx == -1 {
			t.Fatalf("%s: chevron not found in value row: %q", c.name, string(row2))
		}
		if want := width - 3; chevronIdx != want {
			t.Fatalf("%s: chevron should sit at cell %d (2 blank cells before the right edge), got %d: %q", c.name, want, chevronIdx, string(row2))
		}
		if trailing := strings.TrimSpace(string(row2[width-2:])); trailing != "" {
			t.Fatalf("%s: the 2 cells after the chevron should be blank: %q", c.name, string(row2))
		}
	}
}

// TestRenderSegmentLongValueClipsWithoutTouchingChevron pins the other half
// of the same ruling: a long repo/branch name must clip to leave the new
// 2-cell gap intact, not grow into it and collide with the chevron.
func TestRenderSegmentLongValueClipsWithoutTouchingChevron(t *testing.T) {
	const width = 30
	long := "a-very-long-repo-or-branch-name-that-would-otherwise-collide"
	out := renderBranchSegment(Model{Current: Current{Branch: long}}, width, false, false)
	lines := strings.Split(out, "\n")
	row2 := []rune(ansi.Strip(lines[1]))
	if len(row2) != width {
		t.Fatalf("value row should stay exactly %d cells, got %d: %q", width, len(row2), string(row2))
	}
	if !strings.Contains(string(row2), theme.GlyphChevron) {
		t.Fatalf("chevron should still render even with a long value: %q", string(row2))
	}
	if trailing := strings.TrimSpace(string(row2[width-2:])); trailing != "" {
		t.Fatalf("the 2 cells after the chevron should stay blank even with a long value: %q", string(row2))
	}
}

// TestRenderActionSegmentPillsStayFlush pins the other half of the owner's
// ruling: the action segment has no chevron, and its ahead/behind pills
// keep hugging the right edge exactly as before -- the new gap is a
// chevron-only accessory, not a blanket renderSegment change.
func TestRenderActionSegmentPillsStayFlush(t *testing.T) {
	const width = 30
	out := renderActionSegment(ActionModel{Kind: "pull", Title: "Pull origin", Meta: "2 commits behind", Ahead: 3, Behind: 2}, width, false, false)
	lines := strings.Split(out, "\n")
	row2 := []rune(ansi.Strip(lines[1]))
	if len(row2) != width {
		t.Fatalf("value row should be exactly %d cells, got %d: %q", width, len(row2), string(row2))
	}
	if trailing := strings.TrimSpace(string(row2[len(row2)-2:])); trailing == "" {
		t.Fatalf("the action segment's pills should still hug the right edge (no new gap): %q", string(row2))
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

// TestRenderMasterRowClipsLongCountsToOneRow sweeps the same CodeRabbit
// finding class (PR #353, 2026-09-19) into the master row: changedTotal/
// stagedTotal are driver ints with no practical upper bound, and the row
// used to reach Width() unclipped.
func TestRenderMasterRowClipsLongCountsToOneRow(t *testing.T) {
	out := renderMasterRow(999999999999, 999999999999, sidebarWidth)
	if strings.Contains(out, "\n") {
		t.Fatalf("master row should render exactly 1 row even with huge counts: %q", out)
	}
	if got := lipgloss.Width(ansi.Strip(out)); got != sidebarWidth {
		t.Fatalf("master row should stay exactly sidebarWidth %d, got %d: %q", sidebarWidth, got, out)
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
			{Name: "rt-191-mission-tui", Current: true, Ahead: 3, Behind: 2, Group: "other"},
			{Name: "main", Ahead: 0, Behind: 5, Group: "default branch", Default: true, When: "2 days ago"},
			{Name: "rt-190-picker-polish", GuardedBy: "checked out in worktree frodo", Group: "guarded", When: "3 days ago"},
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

// ─── modal width rule (owner's round-2 ruling, 2026-09-19): a foldout's
// width is max(its anchor segment's width, its content's natural width) ──

// TestRepoModalWidthMatchesSidebarWidth pins the owner's explicit ask: the
// repo segment spans the whole sidebar, so its modal renders exactly
// sidebarWidth wide -- the same width as the repo button.
func TestRepoModalWidthMatchesSidebarWidth(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	if inner := modalWidth(m.modal, m.width); inner != sidebarWidth-2 {
		t.Fatalf("repo modal inner width should be sidebarWidth-2=%d, got %d", sidebarWidth-2, inner)
	}
}

// TestBranchModalWidthGrowsForContentWhenWiderThanItsSegment pins the other
// half at a normal frame width: the branch segment is much narrower than
// sidebarWidth, so its modal keeps sizing off its own content rather than
// shrinking to the segment's own span.
func TestBranchModalWidthGrowsForContentWhenWiderThanItsSegment(t *testing.T) {
	m := newTestMission() // width=100: segW is well under modalContentMin
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	if inner := modalWidth(m.modal, m.width); inner < modalContentMin {
		t.Fatalf("branch modal should still use its own content-driven width, got %d", inner)
	}
}

// TestBranchModalWidthFloorsAtSegmentWidthOnAWideFrame pins the floor half
// of the ruling at a frame wide enough that the branch segment's own span
// exceeds even modalContentMax: the modal must still grow to match it
// rather than clamping to the content cap.
func TestBranchModalWidthFloorsAtSegmentWidthOnAWideFrame(t *testing.T) {
	m := newTestMission()
	m.width = 300
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	wantFloor := segmentWidth(zoneBranch, m.width) - 2
	if wantFloor <= modalContentMax {
		t.Fatalf("setup: expected the branch segment's floor to exceed modalContentMax at width 300, got floor=%d max=%d", wantFloor, modalContentMax)
	}
	if inner := modalWidth(m.modal, m.width); inner < wantFloor {
		t.Fatalf("branch modal should floor at its segment width %d, got %d", wantFloor, inner)
	}
}

// TestWorktreeModalWidthFloorsAtSegmentWidthOnAWideFrame mirrors the branch
// case for the worktree segment.
func TestWorktreeModalWidthFloorsAtSegmentWidthOnAWideFrame(t *testing.T) {
	m := newTestMission()
	m.width = 300
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	wantFloor := segmentWidth(zoneWorktree, m.width) - 2
	if inner := modalWidth(m.modal, m.width); inner < wantFloor {
		t.Fatalf("worktree modal should floor at its segment width %d, got %d", wantFloor, inner)
	}
}

// TestSettlingWorktreeShowsInTheTopBar uses newTestMission's own fixture
// width (100, unmodified) rather than an artificially wide frame -- at 100
// the worktree segment is narrow enough (segmentBottomAvail == 9) that the
// marker only survives if the name gives way to it, which is the behavior
// under test.
func TestSettlingWorktreeShowsInTheTopBar(t *testing.T) {
	m := newTestMission()
	m.model.Current.Settling = true
	screen := ansi.Strip(m.View().Content)
	if !strings.Contains(screen, "settling") {
		t.Fatalf("settling worktree not marked in the top bar:\n%s", screen)
	}
}

// TestSettlingMarkerSurvivesLongWorktreeNameAtRealisticWidth pins a normal
// 130-column terminal (renderTopBar's three-way split gives the worktree
// segment 27 cells there) against a worktree name long enough to fill that
// whole segment on its own. The marker must still render, and the name --
// not the marker -- is what gets clipped.
func TestSettlingMarkerSurvivesLongWorktreeNameAtRealisticWidth(t *testing.T) {
	const segmentWidthAt130Cols = 27
	const longName = "glitter-pty-gate-and-docs"
	out := ansi.Strip(renderWorktreeSegment(Model{Current: Current{WorktreeName: longName, Settling: true}}, segmentWidthAt130Cols, false, false))
	if !strings.Contains(out, "settling") {
		t.Fatalf("settling marker lost to clipping at a realistic width:\n%s", out)
	}
	if strings.Contains(out, longName) {
		t.Fatalf("worktree name rendered in full instead of giving way to the marker:\n%s", out)
	}
}

// TestSettlingIndicatorSurvivesAtEightyColumns pins an 80-column frame
// (segW == 10, segmentBottomAvail == 2 -- too small even for the bare word
// "settling") against the realistic case an agent's terminal actually hits.
// The name+marker text budget cannot carry the word at this width, so the
// spinner icon that replaces the worktree glyph is the fallback indication:
// renderSegment never clips the icon column the way it clips the bottom
// row's text.
func TestSettlingIndicatorSurvivesAtEightyColumns(t *testing.T) {
	const segmentWidthAt80Cols = 10
	out := ansi.Strip(renderWorktreeSegment(Model{Current: Current{WorktreeName: "some-worktree", Settling: true}}, segmentWidthAt80Cols, false, false))
	if !strings.Contains(out, theme.SpinnerFrames[0]) {
		t.Fatalf("settling indicator missing at 80 columns:\n%s", out)
	}
}

// TestSettlingIndicatorAt130ColumnsUnchanged pins that the 130-column
// behavior above the 97-column marker-fits threshold is untouched by the
// spinner fallback: the full word still renders alongside the icon.
func TestSettlingIndicatorAt130ColumnsUnchanged(t *testing.T) {
	const segmentWidthAt130Cols = 27
	out := ansi.Strip(renderWorktreeSegment(Model{Current: Current{WorktreeName: "gandalf", Settling: true}}, segmentWidthAt130Cols, false, false))
	if !strings.Contains(out, settlingMarker) {
		t.Fatalf("settling marker missing at 130 columns:\n%s", out)
	}
	if !strings.Contains(out, theme.SpinnerFrames[0]) {
		t.Fatalf("settling spinner icon missing at 130 columns:\n%s", out)
	}
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

// TestCtrlNEntersNamingMode pins the naming sub-mode's own internal flag: an
// action row's ctrl-n opens the name field rather than emitting straight
// away (mission_test.go's session tests pin the emission side of the same
// contract).
func TestCtrlNEntersNamingMode(t *testing.T) {
	for _, tc := range []struct {
		name string
		open rune
	}{
		{"branch", 'b'},
		{"worktree", 'w'},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := newTestMission()
			m.Update(tea.KeyPressMsg{Code: tc.open, Text: string(tc.open)})
			m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
			if !m.modal.naming {
				t.Fatal("ctrl-n did not enter naming mode")
			}
		})
	}
}

// TestNamingEnterWithBlankNameLeavesModalOpenAndNaming mirrors the gate the
// commit button applies to its own summary: a whitespace-only name is inert.
func TestNamingEnterWithBlankNameLeavesModalOpenAndNaming(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	for _, r := range "   " {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.modal == nil || !m.modal.naming {
		t.Fatal("a blank enter should leave the modal open and still naming")
	}
}

// TestEscLeavesNamingButKeepsTheModalOpen pins the two-step esc: the first
// esc backs out of naming only, the second closes the modal.
func TestEscLeavesNamingButKeepsTheModalOpen(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})

	if m.modal == nil {
		t.Fatal("first esc closed the modal, want it to only leave naming")
	}
	if m.modal.naming {
		t.Fatal("esc did not leave naming mode")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.modal != nil {
		t.Fatal("second esc did not close the modal")
	}
}

// TestNamingTypingDoesNotFilterTheList pins the reason naming keeps its own
// field separate from query: refilter resets the cursor on every keystroke,
// which typing a name must not do to the row list underneath it.
func TestNamingTypingDoesNotFilterTheList(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	before := len(m.modal.matches)
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	for _, r := range "zzzz" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if got := len(m.modal.matches); got != before {
		t.Fatalf("typing a name refiltered the list to %d rows, want %d unchanged", got, before)
	}
}

// TestNamingEnterWithATypedNameClosesTheModal pins commitModalName's own
// closeModal call: mission_test.go's session tests can only observe the
// emitted intent, not the view's own modal field, so this is the one place
// a regression that dropped the close (while still emitting) would surface.
func TestNamingEnterWithATypedNameClosesTheModal(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	for _, r := range "my-feature" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.modal != nil {
		t.Fatal("modal stayed open after a successful create")
	}
}

// TestNamingKeepsTheModalGeometryIdentical pins the reason the name field
// reuses the filter line rather than adding one: modalHitTest is a
// hand-rolled parallel copy of modalBoxLines' own layout, so any line-count
// or width drift here would desync every click in the modal.
func TestNamingKeepsTheModalGeometryIdentical(t *testing.T) {
	// width=18 is narrow enough that renderMissionModal's own box-width
	// clamp bites: unless modalNameWidth tracks that same clamp, the name
	// field is built wider than the line it composes onto, and lipgloss's
	// wrap (rather than truncate) on Width() turns the overflow into an
	// extra physical row in the composited frame.
	for _, width := range []int{100, 18} {
		t.Run(fmt.Sprintf("width=%d", width), func(t *testing.T) {
			m := newTestMission()
			m.width = width
			m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
			before := m.View().Content
			innerBefore := modalInnerWidth(m.modal, m.width)
			m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
			after := m.View().Content
			innerAfter := modalInnerWidth(m.modal, m.width)

			if innerBefore != innerAfter {
				t.Fatalf("modal inner width changed from %d to %d while naming", innerBefore, innerAfter)
			}

			beforeLines := strings.Split(before, "\n")
			afterLines := strings.Split(after, "\n")
			if len(beforeLines) != len(afterLines) {
				t.Fatalf("naming changed the frame height: %d lines, want %d", len(afterLines), len(beforeLines))
			}
			for i := range beforeLines {
				if bw, aw := lipgloss.Width(beforeLines[i]), lipgloss.Width(afterLines[i]); bw != aw {
					t.Fatalf("line %d width changed from %d to %d while naming", i, bw, aw)
				}
			}
		})
	}
}

func TestNamingShowsItsPlaceholderAndKeybar(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	screen := ansi.Strip(m.View().Content)

	if !strings.Contains(screen, "new branch name") {
		t.Fatalf("name placeholder missing:\n%s", screen)
	}
	if strings.Contains(screen, "filter branches") {
		t.Fatalf("filter placeholder still painted while naming:\n%s", screen)
	}
	if !strings.Contains(screen, "enter create") || !strings.Contains(screen, "esc cancel") {
		t.Fatalf("naming keybar missing:\n%s", screen)
	}
}

// TestNamingHidesTheRowCursor pins modalRowLine's own cursor glyph
// (theme.GlyphBar in theme.Pink, on a theme.SelBg background): while naming,
// enter creates rather than acting on the cursor row, so painting that row
// as the cursor target would be a lie.
func TestNamingHidesTheRowCursor(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	withCursor := ansi.Strip(m.View().Content)
	m.Update(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	naming := ansi.Strip(m.View().Content)

	if strings.Count(naming, theme.GlyphBar) >= strings.Count(withCursor, theme.GlyphBar) {
		t.Fatalf("row cursor still painted while naming:\n%s", naming)
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

// TestModalGroupHeadersLabelEveryGroupInBranchAndRepoModals pins item 1 (and
// its item-4 taxonomy update): a Dimmer header line names each group --
// "other" (present even though it is the first group GroupContiguous
// orders, holding the current branch), "default branch", the fixed
// guarded-reason banner (never a row's own specific GuardedBy text), and a
// repo's own Group value.
func TestModalGroupHeadersLabelEveryGroupInBranchAndRepoModals(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	branchOut := m.View().Content
	for _, want := range []string{"other", "default branch", "guarded · checked out in another worktree"} {
		if !strings.Contains(ansi.Strip(branchOut), want) {
			t.Fatalf("branch modal missing group header %q:\n%s", want, branchOut)
		}
	}
	// "other" is the first group GroupContiguous orders (it holds the
	// current branch); pinning its own header line's color -- not just
	// Dimmer's presence anywhere in the frame -- confirms the FIRST group
	// gets a header too, not only later boundaries. The composited frame
	// carries the sidebar's own content to the left of the modal on this
	// same row, so the header is found by its "│ other" border-plus-text
	// shape (modalGroupHeaderLine's own leading space, right after the
	// box's left border), not by the whole line's trimmed text.
	found := false
	for _, line := range strings.Split(branchOut, "\n") {
		plain := ansi.Strip(line)
		if !strings.Contains(plain, "│ other") {
			continue
		}
		found = true
		if !strings.Contains(line, fgSGR(theme.Dimmer)) {
			t.Fatalf("the other group's own header should wear Dimmer: %q", line)
		}
	}
	if !found {
		t.Fatalf("other group header line not found:\n%s", branchOut)
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

// TestBranchModalNonCurrentRowShowsRelativeDateInsteadOfPills pins item 4
// (GitHub-Desktop parity): a non-current row's badge slot carries its own
// relative date, Dimmer, rather than ahead/behind pills -- even though the
// wire still carries Ahead/Behind on every row, only the current row's
// badgeData is ever populated (newBranchModal), so a non-current row's pills
// would render empty regardless; this pins that the date fills the slot
// instead of leaving it blank.
func TestBranchModalNonCurrentRowShowsRelativeDateInsteadOfPills(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	out := ansi.Strip(m.View().Content)
	line := lineContaining(t, out, "main")
	if !strings.Contains(line, "2 days ago") {
		t.Fatalf("default-branch row should show its relative date: %q", line)
	}
	if strings.Contains(line, "↓") || strings.Contains(line, "↑") {
		t.Fatalf("non-current row must not show ahead/behind pills: %q", line)
	}
}

// TestBranchModalCurrentRowKeepsPillsNotDate pins the other half: the
// current row still shows ahead/behind pills (When is always "" for it, by
// the driver's own contract), never a date in that slot.
func TestBranchModalCurrentRowKeepsPillsNotDate(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	out := ansi.Strip(m.View().Content)
	line := lineContaining(t, out, "rt-191-mission-tui")
	if !strings.Contains(line, "↓") || !strings.Contains(line, "↑") {
		t.Fatalf("current row should keep its ahead/behind pills: %q", line)
	}
}

// TestBranchModalGuardedRowKeepsLockEvenWithADate pins the priority order in
// modalRowLine: guarded outranks When, so a guarded row with a relative date
// on the wire still shows only the lock glyph in that slot.
func TestBranchModalGuardedRowKeepsLockEvenWithADate(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	out := m.View().Content
	line := lineContaining(t, ansi.Strip(out), "rt-190-picker-polish")
	if strings.Contains(line, "3 days ago") {
		t.Fatalf("guarded row should show the lock glyph, not its date: %q", line)
	}
	if !strings.Contains(line, theme.GlyphLock) {
		t.Fatalf("guarded row missing its lock glyph: %q", line)
	}
}

// TestModalGroupHeaderLineClipsLongTextToOneRow sweeps the same CodeRabbit
// finding class (PR #353, 2026-09-19) into the modal group header: a repo's
// own Group value (repoGroup's "host/owner") is driver-supplied and
// unbounded, modalWidth never accounts for header text when sizing the box,
// and the header row used to reach Width() unclipped -- a wrap there would
// occupy 2 physical rows where modalDisplayLines' scroll-viewport math
// assumes exactly 1.
func TestModalGroupHeaderLineClipsLongTextToOneRow(t *testing.T) {
	const width = 30
	long := "github.com/a-very-long-organization-name-that-would-otherwise-wrap"
	out := modalGroupHeaderLine(long, width)
	if strings.Contains(out, "\n") {
		t.Fatalf("group header should render exactly 1 row even with a long group value: %q", out)
	}
	if got := lipgloss.Width(ansi.Strip(out)); got != width {
		t.Fatalf("group header should stay exactly %d wide, got %d: %q", width, got, out)
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

// TestModalFilterLineClipsLongQueryToOneRow sweeps the same CodeRabbit
// finding class (PR #353, 2026-09-19) into the modal's own filter row: the
// query is user-typed and unbounded, and modalFixedRows reserves exactly 1
// fixed row for it above the scrollable region.
func TestModalFilterLineClipsLongQueryToOneRow(t *testing.T) {
	const width = 30
	long := strings.Repeat("a very long typed filter query ", 3)
	ms := &modalState{query: long, placeholder: "filter branches"}
	out := modalFilterLine(ms, width)
	if strings.Contains(out, "\n") {
		t.Fatalf("filter row should render exactly 1 row even with a long query: %q", out)
	}
	if got := lipgloss.Width(ansi.Strip(out)); got != width {
		t.Fatalf("filter row should stay exactly %d wide, got %d: %q", width, got, out)
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

// ─── modal full-height + scrolling (Addendum C, ratified 2026-09-19): every
// foldout spans the full frame height, GHD-style, with a scrollable row
// region and a pinned bottom block ──────────────────────────────────────

// longBranchModalFixture returns a Mission with 220 branches -- far more
// than any plausible pane's row region -- opened on the branch modal, so
// the scrolling contract can be pinned against a list that must scroll
// regardless of frame size.
func longBranchModalFixture(t *testing.T) *Mission {
	t.Helper()
	branches := make([]BranchRow, 220)
	for i := range branches {
		branches[i] = BranchRow{Name: fmt.Sprintf("branch-%03d", i), Group: "other"}
	}
	m := New(nil)
	m.width, m.height = 100, 30
	// SetModel, not a direct m.model assignment: it seeds Commit.Placeholder
	// onto the summary textinput, which a bare assignment skips. Without it,
	// bubbles' textinput takes a different internal render branch (a
	// virtual-cursor cell in Reverse(true) with no background) that this
	// test's own bg-coverage assertions would otherwise misread as a real
	// production hole.
	raw, err := json.Marshal(Model{
		Current:  Current{Repo: "repo-tools", Branch: "branch-000"},
		Branches: branches,
		Commit:   CommitModel{Placeholder: "Summary (required)"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(raw); err != nil {
		t.Fatal(err)
	}
	m.Update(tea.KeyPressMsg{Code: 'b', Text: "b"})
	return m
}

// modalBoxBottomRow finds the modal's own bottom border row by scanning
// from the BOTTOM of the frame upward: the dimmed sidebar underneath still
// carries its own bordered boxes (the filter row, in particular), which
// also paint "╰" -- scanning top-down would find one of those instead of
// the modal's own border whenever the modal's own anchor column doesn't
// happen to overlap the sidebar. The modal is always the tallest bordered
// box in the frame once open, so its own border is the last "╰" found.
func modalBoxBottomRow(t *testing.T, m *Mission) int {
	t.Helper()
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	for y := len(lines) - 1; y >= 0; y-- {
		if strings.Contains(lines[y], "╰") {
			return y
		}
	}
	return -1
}

// TestModalSpansFullFrameHeightForShortAndLongLists pins the core of
// Addendum C: a foldout's bottom edge is always the frame's own last row,
// regardless of match count -- both a short (fixture) list and a 220-row
// list, across all three foldout kinds.
func TestModalSpansFullFrameHeightForShortAndLongLists(t *testing.T) {
	cases := []struct {
		name string
		key  rune
	}{
		{"repo", 'r'},
		{"branch", 'b'},
		{"worktree", 'w'},
	}
	for _, c := range cases {
		m := newTestMission()
		m.Update(tea.KeyPressMsg{Code: c.key, Text: string(c.key)})
		if got := modalBoxBottomRow(t, m); got != m.height-1 {
			t.Fatalf("%s modal (short list): bottom border row = %d, want %d (the frame's last row)", c.name, got, m.height-1)
		}
	}

	long := longBranchModalFixture(t)
	if got := modalBoxBottomRow(t, long); got != long.height-1 {
		t.Fatalf("branch modal (220-row list): bottom border row = %d, want %d", got, long.height-1)
	}
}

// TestModalPinnedKeybarIsSecondToLastRow pins the pinned-bottom-block half
// of the ruling: the in-modal keybar is always the row immediately above
// the closing border, whether the row region is mostly empty (short list)
// or scrolling (long list).
func TestModalPinnedKeybarIsSecondToLastRow(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	bottom := modalBoxBottomRow(t, m)
	if !strings.Contains(lines[bottom-1], "enter open") {
		t.Fatalf("row above the closing border should be the keybar, got %q", lines[bottom-1])
	}

	long := longBranchModalFixture(t)
	longLines := strings.Split(ansi.Strip(long.View().Content), "\n")
	longBottom := modalBoxBottomRow(t, long)
	if !strings.Contains(longLines[longBottom-1], "enter checkout") {
		t.Fatalf("long-list branch modal: row above the closing border should be the keybar, got %q", longLines[longBottom-1])
	}
}

// TestModalLongListScrollsWithCursorAndThumb pins the hard scrolling
// requirement: moving the cursor to the LAST of 220 branches must keep it
// visible in the row region, and the thumb must reach the rail's bottom.
func TestModalLongListScrollsWithCursorAndThumb(t *testing.T) {
	m := longBranchModalFixture(t)
	ms := m.modal
	for i := 0; i < len(ms.matches)-1; i++ {
		m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	}
	if row, ok := ms.selectedRow(); !ok || row.value != "branch-219" {
		t.Fatalf("setup: expected the cursor on the last branch, got %+v ok=%v", row, ok)
	}
	out := ansi.Strip(m.View().Content)
	if !strings.Contains(out, "branch-219") {
		t.Fatalf("the last branch should be visible after scrolling to it:\n%s", out)
	}
	displayLines := modalDisplayLines(ms)
	above, below := modalFixedRows(ms)
	boxInnerHeight := m.height - m.layout().topH - 2
	rowRegionH := boxInnerHeight - above - below
	thumbTop, thumbH := picker.ThumbSpan(ms.scrollTop, rowRegionH, len(displayLines))
	if thumbTop+thumbH != rowRegionH {
		t.Fatalf("thumb should reach the row region's own bottom once scrolled to the end: top=%d h=%d regionH=%d", thumbTop, thumbH, rowRegionH)
	}
}

// TestModalShortListFillerIsSurface pins the short-list half: the leftover
// row-region space below a short list (never the dimmed parent, never bare
// cells) is filled with the modal's own Surface background.
func TestModalShortListFillerIsSurface(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"}) // 2 repo rows, well short of a 30-row frame
	out := m.View().Content
	lines := strings.Split(out, "\n")
	bottom := modalBoxBottomRow(t, m)
	// A row well below the 2 real repo rows but still above the pinned
	// keybar/rule block should be Surface-filled filler.
	fillerY := bottom - 3
	if !strings.Contains(lines[fillerY], bgSGR(theme.Surface)) {
		t.Fatalf("filler row %d below a short list should wear Surface: %q", fillerY, lines[fillerY])
	}
}

// TestFullFrameWithShortModalOpenEveryRowFullyPaintsBackground and its
// long-list sibling re-assert the whole-frame bg-coverage loop test with a
// modal open, per Addendum C: dimForeground only touches foreground SGR, so
// every background underneath the dim -- and the modal's own Surface fill,
// including its filler and thumb column -- must still resolve.
func TestFullFrameWithShortModalOpenEveryRowFullyPaintsBackground(t *testing.T) {
	m := newTestMission()
	m.Update(tea.KeyPressMsg{Code: 'r', Text: "r"})
	assertFullyBgFilled(t, "short-modal-open", m.View().Content, m.width)
}

func TestFullFrameWithLongModalOpenEveryRowFullyPaintsBackground(t *testing.T) {
	m := longBranchModalFixture(t)
	assertFullyBgFilled(t, "long-modal-open", m.View().Content, m.width)
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

// TestRenderNoticeStripClipsLongTextToOneRow sweeps the same CodeRabbit
// finding class (PR #353, 2026-09-19) into the notice strip: a driver
// refusal or view-local notice is free-form and unbounded, and the frame's
// own layout budgets exactly 1 row for it (layout's noticeH).
func TestRenderNoticeStripClipsLongTextToOneRow(t *testing.T) {
	long := strings.Repeat("a very long refusal message that keeps going ", 5)
	out := renderNoticeStrip(long, 100)
	if strings.Contains(out, "\n") {
		t.Fatalf("notice strip should render exactly 1 row even with a long message: %q", out)
	}
	if got := lipgloss.Width(ansi.Strip(out)); got != 100 {
		t.Fatalf("notice strip should stay exactly 100 wide, got %d: %q", got, out)
	}
}

// TestRenderNoticeStripClipsAtNarrowWidths pins a CodeRabbit finding on PR
// #353 (2026-09-19): the original fix clipped only text, not the leading
// space + warn glyph + gap around it, so at width 1-2 textW clamped to 0
// but the fixed chrome alone (3 cells) still exceeded width and could wrap.
// The whole composed payload must clip to width now, at every width down to
// (and including) the pathological 1-cell case.
func TestRenderNoticeStripClipsAtNarrowWidths(t *testing.T) {
	for _, width := range []int{1, 2, 3} {
		out := renderNoticeStrip("a refusal message", width)
		if strings.Contains(out, "\n") {
			t.Fatalf("width %d: notice strip should render exactly 1 row: %q", width, out)
		}
		if got := lipgloss.Width(ansi.Strip(out)); got != width {
			t.Fatalf("width %d: notice strip should stay exactly that wide, got %d: %q", width, got, out)
		}
	}
}

// TestRenderNoticeStripNonPositiveWidthReturnsEmpty pins the guard: a
// non-positive width has no cell to paint into, so the strip renders
// nothing rather than the fixed chrome (glyph + spaces) Width() would
// otherwise still emit unclamped.
func TestRenderNoticeStripNonPositiveWidthReturnsEmpty(t *testing.T) {
	if out := renderNoticeStrip("a refusal message", 0); out != "" {
		t.Fatalf("width 0 should return empty, got %q", out)
	}
	if out := renderNoticeStrip("a refusal message", -1); out != "" {
		t.Fatalf("negative width should return empty, got %q", out)
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

// TestClickCheckboxOnAnotherRowAlsoSelectsIt: RT-221. A checkbox click always
// emitted its own stage intent, but never mission:select -- so the diff pane
// kept showing the previously selected file until the next row click or
// arrow key. Clicking a DIFFERENT row's checkbox must batch the stage intent
// with a select intent, mirroring clickFileRow's own selectPathCmd.
func TestClickCheckboxOnAnotherRowAlsoSelectsIt(t *testing.T) {
	m := newTestMission()
	m.model.Changes = []ChangeRow{
		{Path: "a.txt", Include: "all"},
		{Path: "b.txt", Include: "all"},
	}
	m.selected = "a.txt"

	_, cmd := m.clickCheckbox(1)
	if cmd == nil {
		t.Fatal("clicking a checkbox must still emit its stage intent")
	}
	msg := cmd()
	batch, ok := msg.(tea.BatchMsg)
	if !ok || len(batch) != 2 {
		t.Fatalf("checkbox click on a different row should batch stage+select, got %#v", msg)
	}
	if m.selected != "b.txt" {
		t.Fatalf("checkbox click should move the cursor to the clicked row, got %q", m.selected)
	}
}

// TestClickCheckboxOnTheAlreadySelectedRowStillStages pins the other half:
// no redundant select intent when the clicked row is already the one
// showing in the diff pane (selectPathCmd's own no-op-on-unchanged rule).
func TestClickCheckboxOnTheAlreadySelectedRowStillStages(t *testing.T) {
	m := newTestMission()
	m.model.Changes = []ChangeRow{
		{Path: "a.txt", Include: "all"},
		{Path: "b.txt", Include: "all"},
	}
	m.selected = "a.txt"

	_, cmd := m.clickCheckbox(0)
	if cmd == nil {
		t.Fatal("clicking a checkbox must still emit its stage intent")
	}
}

// TestCommitRefusalRestoresDraftAfterEmit: RT-221. Emitting mission:commit
// clears the local drafts -- the only point they can ever go back to empty,
// since a non-empty draft always outranks a push. A refusal or failure must
// restore them via the next push's Commit.Summary/Description, or the typed
// message is lost with no way to recover it.
func TestCommitRefusalRestoresDraftAfterEmit(t *testing.T) {
	m := newTestMission()
	m.model.Commit.CanCommit = true
	m.focus = focusSummary
	m.summaryInput.SetValue("Amend it")
	m.descriptionInput.SetValue("body text")
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter, Mod: tea.ModCtrl}); cmd == nil {
		t.Fatal("ctrl+enter with the gate open must emit")
	}
	if m.summaryInput.Value() != "" {
		t.Fatalf("emit should have cleared the summary draft, got %q", m.summaryInput.Value())
	}

	mod := modalFixtureModel()
	mod.Notice = "main is a stack root; amend refused"
	mod.Commit.Summary = "Amend it"
	mod.Commit.Description = "body text"
	raw, err := json.Marshal(mod)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := m.Update(session.ModelUpdate{Raw: raw})
	m = next.(*Mission)

	if got := m.summaryInput.Value(); got != "Amend it" {
		t.Fatalf("a refused commit should restore the typed summary: %q", got)
	}
	if got := m.descriptionInput.Value(); got != "body text" {
		t.Fatalf("a refused commit should restore the typed description: %q", got)
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

// changesRowY returns the absolute frame row of mouseFixtureModel's Changes
// list row idx, derived from m.layout()'s own topH (not hardcoded) plus the
// sidebar's fixed pre-list structure: tabs(2) + the tabs-gap blank band
// row(1) + the filter box(3) + the master row(1).
func changesRowY(m *Mission, idx int) int {
	return m.layout().topH + 2 + 1 + 3 + 1 + idx
}

// filterRowY returns the absolute frame row of the filter box's own first
// row (any of its three rows resolves to hitFilterRow), derived from
// m.layout()'s own topH plus the fixed tabs(2) + tabs-gap(1) prefix.
func filterRowY(m *Mission) int {
	return m.layout().topH + 2 + 1
}

// TestMouseMotionOverFileRowSetsHoverNotCursor pins the mouse board's
// central invariant inside mission's own Update wiring (render_test.go
// already pins the row-paint half via renderChangeRow directly): motion
// over a non-cursor row sets the render hint, never the cursor.
func TestMouseMotionOverFileRowSetsHoverNotCursor(t *testing.T) {
	m := newMouseTestMission()
	cursorY, hoverY := changesRowY(m, 0), changesRowY(m, 1)
	next, _ := m.Update(tea.MouseMotionMsg{X: 10, Y: hoverY}) // row index 1 ("b.go")
	m = next.(*Mission)
	if m.hoverFile != 1 {
		t.Fatalf("hovering row 1 should set hoverFile=1, got %d", m.hoverFile)
	}
	if m.selected != "a.go" {
		t.Fatalf("hover must never move the cursor, got selected=%q", m.selected)
	}
	lines := strings.Split(m.View().Content, "\n")
	if !strings.Contains(lines[hoverY], bgSGR(theme.HoverBg)) {
		t.Fatalf("hovered row should paint HoverBg:\n%s", lines[hoverY])
	}
	if !strings.Contains(lines[cursorY], bgSGR(theme.SelBg)) || strings.Contains(lines[cursorY], bgSGR(theme.HoverBg)) {
		t.Fatalf("cursor row must keep SelBg, never HoverBg:\n%s", lines[cursorY])
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
	rowY := changesRowY(m, 1)
	now := time.Now()
	m.nowFn = func() time.Time { return now }
	m.Update(tea.MouseClickMsg{X: 20, Y: rowY, Button: tea.MouseLeft})
	now = now.Add(100 * time.Millisecond)
	next, _ := m.Update(tea.MouseClickMsg{X: 20, Y: rowY, Button: tea.MouseLeft})
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
	next, cmd := m.Update(tea.MouseClickMsg{X: 20, Y: changesRowY(m, 0), Button: tea.MouseLeft})
	m = next.(*Mission)
	if cmd != nil {
		t.Fatal("a click on the row already under the cursor must not emit")
	}
	next, cmd = m.Update(tea.MouseClickMsg{X: 20, Y: changesRowY(m, 2), Button: tea.MouseLeft})
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

// TestMouseClickFilterRowFocusesFilter pins the filter zone.
func TestMouseClickFilterRowFocusesFilter(t *testing.T) {
	m := newMouseTestMission()
	next, _ := m.Update(tea.MouseClickMsg{X: 5, Y: filterRowY(m), Button: tea.MouseLeft})
	m = next.(*Mission)
	if m.focus != focusFilter {
		t.Fatalf("clicking the filter row should focus the filter, got %v", m.focus)
	}
}

// commitButtonY returns the commit button's own MIDDLE row -- the solid
// label row, of its three (half-block cap, label, half-block cap; any of
// the three resolves to hitCommitButton, ratified 2026-09-20's sub-cell-
// height treatment) -- via the SAME layout() arithmetic View paints with
// (mission.go's sidebarBlocks/sidebarHit split), so a click test never
// hardcodes a y that drifts when the sidebar's bottom-dock gap resizes.
// commitButtonY(m)-1 and commitButtonY(m)+1 are the top and bottom
// half-block cap rows respectively.
func commitButtonY(m *Mission) int {
	l := m.layout()
	off := 1 // the rule above the commit box
	if m.amendLocal {
		off++
	}
	off++    // the commit box's own top-padding blank band row
	off += 3 // summary box
	off += 4 // description box
	off++    // the gap row between the description box and the button
	off++    // the button's own top half-block cap row
	return l.topH + l.sidebarTopH + l.listRegionH + off
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

// TestMouseClickCommitButtonAllThreeRowsResolveToTheButton pins the ratified
// 2026-09-20 sub-cell-height treatment's hit-testing half: the button is
// three physical rows now (top half-block cap, label, bottom half-block
// cap), and a click on ANY of them must resolve to hitCommitButton -- a
// user cannot tell from the half-block glyphs alone that a row is "just"
// padding, so it has to behave like part of the button, not dead space.
func TestMouseClickCommitButtonAllThreeRowsResolveToTheButton(t *testing.T) {
	m := newMouseTestMission()
	m.model.Commit.CanCommit = true
	m.summaryInput.SetValue("msg")
	buttonY := commitButtonY(m)

	for _, y := range []int{buttonY - 1, buttonY, buttonY + 1} {
		if got := m.hitTest(20, y); got.kind != hitCommitButton {
			t.Fatalf("row %d (offset %+d from the label row) should hit the commit button, got %+v", y, y-buttonY, got)
		}
	}
	// One row past the bottom cap must NOT still read as the button (the
	// span is exactly 3 rows, not open-ended).
	if got := m.hitTest(20, buttonY+2); got.kind == hitCommitButton {
		t.Fatalf("the row after the button's bottom cap should not still hit the commit button: %+v", got)
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
	wantY := commitButtonY(m)

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
	fillerStart := l.topH + l.sidebarTopH + len(m.model.Changes)
	fillerEnd := l.topH + l.sidebarTopH + l.listRegionH
	for y := fillerStart; y < fillerEnd; y++ {
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
	wantY := commitButtonY(m)

	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	if wantY >= len(lines) || !strings.Contains(lines[wantY], "Commit 0 files to main") {
		got := ""
		if wantY < len(lines) {
			got = lines[wantY]
		}
		t.Fatalf("commit button should dock at layout-derived row %d, got %q", wantY, got)
	}
}

// ─── tab strip (Main.png/EmptyState.png: half-width tabs, full-width
// underline) ratified 2026-09-19 ──────────────────────────────────────────

// TestRenderTabsRowUnderlineHalfPinkHalfRule pins the underline row: Pink
// under the active (Changes) half, theme.Rule under the inactive (History)
// half, spanning the full width between them.
func TestRenderTabsRowUnderlineHalfPinkHalfRule(t *testing.T) {
	const width = 46
	out := renderTabsRow(3, width)
	lines := strings.Split(out, "\n")
	if len(lines) != 2 {
		t.Fatalf("tabs row should render exactly 2 rows, got %d:\n%s", len(lines), out)
	}
	underline := lines[1]
	half := width / 2
	pinkRun := strings.Repeat("─", half)
	ruleRun := strings.Repeat("─", width-half)
	// The rest-state Bg band (Change 1) combines into the same SGR run as
	// each half's own foreground, so the color and the dash run are checked
	// separately rather than as one adjoining "fg+m+run" string.
	if !strings.Contains(underline, fgSGR(theme.Pink)) || !strings.Contains(ansi.Strip(underline), pinkRun) {
		t.Fatalf("underline should run Pink for exactly the left half (%d cells): %q", half, underline)
	}
	if !strings.Contains(underline, fgSGR(theme.Rule)) || !strings.Contains(ansi.Strip(underline), ruleRun) {
		t.Fatalf("underline should run Rule for exactly the right half (%d cells): %q", width-half, underline)
	}
	if strings.Index(underline, fgSGR(theme.Pink)) >= strings.Index(underline, fgSGR(theme.Rule)) {
		t.Fatalf("Pink run should precede the Rule run (active tab first): %q", underline)
	}
	if lipgloss.Width(ansi.Strip(underline)) != width {
		t.Fatalf("underline should span the full width %d, got %d", width, lipgloss.Width(ansi.Strip(underline)))
	}
}

// TestRenderTabsRowLabelsCenteredInHalves pins the label half of the same
// ruling: "Changes N" centers within the left half, "History" within the
// right half.
func TestRenderTabsRowLabelsCenteredInHalves(t *testing.T) {
	const width = 46
	out := renderTabsRow(3, width)
	top := ansi.Strip(strings.Split(out, "\n")[0])
	half := width / 2
	left, right := top[:half], top[half:]
	if !strings.Contains(left, "Changes 3") {
		t.Fatalf("left half should contain the Changes label: %q", left)
	}
	leadPad := len(left) - len(strings.TrimLeft(left, " "))
	trailPad := len(left) - len(strings.TrimRight(left, " "))
	if leadPad == 0 || trailPad == 0 {
		t.Fatalf("Changes label should be centered (padding on both sides) within its half: %q", left)
	}
	if !strings.Contains(right, "History") {
		t.Fatalf("right half should contain the History label: %q", right)
	}
}

// TestTabsHitZonesAreHalfWidth pins the click-zone half of the ruling: the
// left half is inert (Changes is already active), the right half resolves
// to History, with the boundary landing exactly at width/2.
func TestTabsHitZonesAreHalfWidth(t *testing.T) {
	const width = 46
	half := width / 2
	if got := tabsHit(width, half-1); got.kind != hitNone {
		t.Fatalf("x=%d (last cell of the left half) should be inert, got %+v", half-1, got)
	}
	if got := tabsHit(width, half); got.kind != hitTabHistory {
		t.Fatalf("x=%d (first cell of the right half) should hit History, got %+v", half, got)
	}
}

// ─── vertical rhythm (docs/design/mission/README.md's Terminal geometry
// table): quantization ruling ratified 2026-09-19 ────────────────────────

// TestTopBarIsThreeRowsWithBlankBreathingBand pins item 1: the top bar
// renders exactly 3 rows -- label, value, and a blank BgSubtle-banded row
// beneath them (the board's own bottom breathing) -- across the whole bar,
// not just one segment.
func TestTopBarIsThreeRowsWithBlankBreathingBand(t *testing.T) {
	out := renderTopBar(pullModel(), 140, zoneNone, zoneNone)
	lines := strings.Split(out, "\n")
	if len(lines) != 3 {
		t.Fatalf("top bar should render exactly 3 rows, got %d:\n%s", len(lines), out)
	}
	blank := lines[2]
	// The composed bar's own divider glyphs ("│" between segments) legitimately
	// still appear on this row; only the segments' own content must be blank.
	textOnly := strings.ReplaceAll(strings.TrimSpace(ansi.Strip(blank)), "│", "")
	if strings.TrimSpace(textOnly) != "" {
		t.Fatalf("the top bar's third row should carry no segment content, only dividers: %q", blank)
	}
	if !strings.Contains(blank, bgSGR(theme.BgSubtle)) {
		t.Fatalf("the top bar's blank row should still wear the BgSubtle band: %q", blank)
	}
}

// TestTopBarHoverCoversAllThreeRowsOfItsSegment pins item 1's hover half:
// a hovered segment's HoverBg fill spans its full 3-row span, including the
// blank breathing row, not just the label/value rows.
func TestTopBarHoverCoversAllThreeRowsOfItsSegment(t *testing.T) {
	out := renderTopBar(pullModel(), 140, zoneRepo, zoneNone)
	lines := strings.Split(out, "\n")
	for i, line := range lines {
		if !strings.Contains(line, bgSGR(theme.HoverBg)) {
			t.Fatalf("hovered repo segment's row %d should wear HoverBg across its full span: %q", i, line)
		}
	}
}

// TestSidebarTopHasBlankBandAfterTabsBeforeFilter pins item 2: the tabs
// row + underline row are followed by one blank Bg row (the board's own
// rule+gap) before the filter box's own top border.
func TestSidebarTopHasBlankBandAfterTabsBeforeFilter(t *testing.T) {
	m := &Mission{}
	top := m.sidebarFixedTop(sidebarWidth)
	lines := strings.Split(top, "\n")
	if len(lines) < 4 {
		t.Fatalf("sidebar top block too short to hold tabs+blank+filter: %d rows:\n%s", len(lines), top)
	}
	blank := lines[2]
	if strings.TrimSpace(ansi.Strip(blank)) != "" {
		t.Fatalf("row 2 (after the tabs underline) should be blank: %q", blank)
	}
	if !strings.Contains(blank, bgSGR(theme.Bg)) {
		t.Fatalf("the tabs-gap blank row should still wear the Bg fill: %q", blank)
	}
	if !strings.Contains(ansi.Strip(lines[3]), "╭") {
		t.Fatalf("row 3 should be the filter box's own top border: %q", lines[3])
	}
}

// TestRenderCommitButtonThreeRowsHalfBlockCaps pins the owner's ratified
// sub-cell-height treatment (2026-09-20, "mission commit button gains its
// half-cell padding"): board h=32px against the 26px row unit is 1.23
// cells, which no single terminal row can express, so the button is three
// rows -- a half-block cap above and below the solid centered-label row,
// same as it always rendered -- Pink (enabled) or Panel (disabled), full
// width throughout (every row, not just the label row: the bg-coverage
// loop tests need the caps to paint their full width too, even with no
// text of their own to clip).
func TestRenderCommitButtonThreeRowsHalfBlockCaps(t *testing.T) {
	const width = 40
	const label = "Commit 2 files to main"

	cases := []struct {
		name        string
		canCommit   bool
		buttonColor color.Color
		textColor   color.Color
	}{
		{"enabled", true, theme.Pink, theme.Bg},
		{"disabled", false, theme.Panel, theme.Dimmer},
	}
	for _, tc := range cases {
		out := renderCommitButton(width, label, tc.canCommit)
		lines := strings.Split(out, "\n")
		if len(lines) != 3 {
			t.Fatalf("%s: button should render exactly 3 rows, got %d:\n%s", tc.name, len(lines), out)
		}
		top, mid, bottom := lines[0], lines[1], lines[2]

		if plain := ansi.Strip(top); plain != strings.Repeat(theme.GlyphHalfBlockLower, width) {
			t.Fatalf("%s: top cap should be %d lower half blocks, got %q", tc.name, width, plain)
		}
		if !strings.Contains(top, fgSGR(tc.buttonColor)) {
			t.Fatalf("%s: top cap should carry the button color as its FOREGROUND: %q", tc.name, top)
		}
		if !strings.Contains(top, bgSGR(theme.Bg)) {
			t.Fatalf("%s: top cap should carry theme.Bg as its background: %q", tc.name, top)
		}

		if !strings.Contains(ansi.Strip(mid), label) {
			t.Fatalf("%s: label row should carry the label: %q", tc.name, mid)
		}
		if !strings.Contains(mid, bgSGR(tc.buttonColor)) {
			t.Fatalf("%s: label row should wear the button color as its solid fill: %q", tc.name, mid)
		}

		if plain := ansi.Strip(bottom); plain != strings.Repeat(theme.GlyphHalfBlockUpper, width) {
			t.Fatalf("%s: bottom cap should be %d upper half blocks, got %q", tc.name, width, plain)
		}
		if !strings.Contains(bottom, fgSGR(tc.buttonColor)) {
			t.Fatalf("%s: bottom cap should carry the button color as its FOREGROUND: %q", tc.name, bottom)
		}
		if !strings.Contains(bottom, bgSGR(theme.Bg)) {
			t.Fatalf("%s: bottom cap should carry theme.Bg as its background: %q", tc.name, bottom)
		}

		for i, line := range lines {
			if w := lipgloss.Width(ansi.Strip(line)); w != width {
				t.Fatalf("%s: row %d should be exactly width %d, got %d: %q", tc.name, i, width, w, line)
			}
		}
	}
}

// TestRenderCommitButtonClipsLongLabelToOneRow pins a CodeRabbit finding on
// PR #353 (2026-09-19, changes.go): Width() wraps a too-long string instead
// of truncating it (the same trap hunk headers and the empty-state card hit
// earlier), so a long current.branch in "Commit N files to <branch>" could
// spill the fixed-height LABEL row onto a second row (the two half-block
// caps carry no text, so they cannot wrap from label length at all).
func TestRenderCommitButtonClipsLongLabelToOneRow(t *testing.T) {
	const width = 40
	long := "Commit 3 files to a-very-long-feature-branch-name-that-would-otherwise-wrap"
	out := renderCommitButton(width, long, true)
	lines := strings.Split(out, "\n")
	if len(lines) != 3 {
		t.Fatalf("commit button must render exactly 3 rows even with a long label, got %d:\n%s", len(lines), out)
	}
	if got := lipgloss.Width(ansi.Strip(lines[1])); got != width {
		t.Fatalf("label row should stay exactly %d wide, got %d: %q", width, got, lines[1])
	}
}

// TestCommitButtonNeverWrapsKeepsUndoChipRowAligned is the layout-level half
// of the same CodeRabbit finding: sidebarHit maps every row below the
// button by a hardcoded fixed offset (mission.go), so a button whose LABEL
// row wrapped to 2 rows would leave a real click on the undo chip landing
// one row short of it. The button's own label row is found by content
// search, and the undo chip sits 2 rows below it now (the bottom half-block
// cap row, then undo) -- ratified 2026-09-20's three-row sub-cell-height
// treatment. Proven against the actual rendered frame + hitTest, not
// hand-derived offsets, so it fails the same way a real click would have.
func TestCommitButtonNeverWrapsKeepsUndoChipRowAligned(t *testing.T) {
	m := New(nil)
	m.width, m.height = 100, 30
	longBranch := "a-very-long-feature-branch-name-that-would-wrap-the-commit-button-row"
	raw, err := json.Marshal(Model{
		Current:      Current{Repo: "repo-tools", Branch: longBranch},
		Changes:      []ChangeRow{{Path: "a.go", Status: "modified", Include: "all"}},
		ChangedTotal: 1,
		StagedTotal:  1,
		Commit: CommitModel{
			Placeholder: "Summary (required)",
			ButtonLabel: "Commit 1 file to " + longBranch,
			CanCommit:   true,
			LastCommit:  &LastCommit{Summary: "fix parser", When: "2 minutes ago", Undoable: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(raw); err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(ansi.Strip(m.View().Content), "\n")
	buttonRow, undoRow := -1, -1
	for i, line := range lines {
		if strings.Contains(line, "Commit 1 file") {
			buttonRow = i
		}
		if strings.Contains(line, "Undo") {
			undoRow = i
		}
	}
	if buttonRow == -1 {
		t.Fatalf("commit button label not found in the rendered frame:\n%s", strings.Join(lines, "\n"))
	}
	if undoRow == -1 {
		t.Fatalf("undo chip not found in the rendered frame:\n%s", strings.Join(lines, "\n"))
	}
	if undoRow != buttonRow+2 {
		t.Fatalf("undo chip should sit exactly 2 rows below the button's label row (its own bottom half-block cap, then undo; no wrap from the long label): button row %d, undo row %d", buttonRow, undoRow)
	}
	if got := m.hitTest(0, undoRow); got.kind != hitUndoChip {
		t.Fatalf("a click on the undo chip's own frame row should resolve to hitUndoChip, got %+v", got)
	}
}

// TestRenderCommitBoxHasGapBeforeButton pins the owner's round-2 ruling: one
// blank Bg row separates the description box from the button (the board's
// 8px gap), unlike the flush summary/description seam.
func TestRenderCommitBoxHasGapBeforeButton(t *testing.T) {
	out := ansi.Strip(renderCommitBox(sidebarWidth, "", "", false, "Commit 2 files to main", false))
	lines := strings.Split(out, "\n")
	// row0 = box top pad, row1-3 = summary box, row4-7 = description box,
	// row8 = the new gap, row9-11 = the button's own 3 rows (top half-block
	// cap, label, bottom half-block cap -- ratified 2026-09-20's sub-cell-
	// height treatment).
	if strings.TrimSpace(lines[8]) != "" {
		t.Fatalf("row 8 should be the blank gap before the button: %q", lines[8])
	}
	if lines[9] != strings.Repeat(theme.GlyphHalfBlockLower, sidebarWidth) {
		t.Fatalf("row 9 should be the button's own top half-block cap: %q", lines[9])
	}
	if !strings.Contains(lines[10], "Commit 2 files to main") {
		t.Fatalf("row 10 should be the button's own label row: %q", lines[10])
	}
	if lines[11] != strings.Repeat(theme.GlyphHalfBlockUpper, sidebarWidth) {
		t.Fatalf("row 11 should be the button's own bottom half-block cap: %q", lines[11])
	}
	if len(lines) != 12 {
		t.Fatalf("commit box should be exactly 12 rows (1 pad + 3 summary + 4 description + 1 gap + 3 button), got %d:\n%s", len(lines), out)
	}
}

// TestRenderCommitBoxHasBlankBandBeforeSummaryBox pins item 4: the commit
// box's own top padding (board pad=12) is one blank Bg row immediately
// before the summary box's own top border.
func TestRenderCommitBoxHasBlankBandBeforeSummaryBox(t *testing.T) {
	out := renderCommitBox(sidebarWidth, "", "", false, "Commit 2 files to main", false)
	lines := strings.Split(out, "\n")
	if strings.TrimSpace(ansi.Strip(lines[0])) != "" {
		t.Fatalf("the commit box's own top-padding row should be blank: %q", lines[0])
	}
	if !strings.Contains(lines[0], bgSGR(theme.Bg)) {
		t.Fatalf("the commit box's top-padding row should wear the Bg fill: %q", lines[0])
	}
	if !strings.Contains(ansi.Strip(lines[1]), "╭") {
		t.Fatalf("row 1 should be the summary box's own top border: %q", lines[1])
	}
}

// TestRenderCommitBoxAmendingBannerThenBlankThenSummaryBox covers the same
// contract with the (build-only, un-boarded) amend banner present: the
// banner still leads, but the blank pad row -- and everything after it --
// keeps its own fixed position relative to the summary box.
func TestRenderCommitBoxAmendingBannerThenBlankThenSummaryBox(t *testing.T) {
	out := ansi.Strip(renderCommitBox(sidebarWidth, "", "", true, "Commit 2 files to main", false))
	lines := strings.Split(out, "\n")
	if !strings.Contains(lines[0], "Amending last commit") {
		t.Fatalf("row 0 should be the amend banner: %q", lines[0])
	}
	if strings.TrimSpace(lines[1]) != "" {
		t.Fatalf("row 1 should be the blank pad row after the banner: %q", lines[1])
	}
	if !strings.Contains(lines[2], "╭") {
		t.Fatalf("row 2 should be the summary box's own top border: %q", lines[2])
	}
}

// TestFrameCommitButtonThreeRowsFullWidthFillLabelCentered pins the ratified
// sub-cell-height ruling (2026-09-20) at the FULL FRAME level, located via
// commitButtonY's layout() arithmetic rather than a hardcoded row: the
// label row carries the enabled Pink fill and the centered label, its own
// top and bottom half-block caps carry Pink as their FOREGROUND on a
// theme.Bg background, and the row above the top cap (the gap) is blank.
func TestFrameCommitButtonThreeRowsFullWidthFillLabelCentered(t *testing.T) {
	m := newMouseTestMission()
	m.model.Commit.CanCommit = true
	m.summaryInput.SetValue("msg")

	buttonY := commitButtonY(m)
	lines := strings.Split(m.View().Content, "\n")
	row := lines[buttonY]
	if !strings.Contains(row, bgSGR(theme.Pink)) {
		t.Fatalf("label row should wear the enabled Pink fill: %q", row)
	}
	if !strings.Contains(ansi.Strip(row), "Commit 3 files to main") {
		t.Fatalf("label row should carry the label: %q", row)
	}

	topCap, bottomCap := lines[buttonY-1], lines[buttonY+1]
	for _, capRow := range []string{topCap, bottomCap} {
		if !strings.Contains(capRow, fgSGR(theme.Pink)) {
			t.Fatalf("half-block cap should carry Pink as its FOREGROUND: %q", capRow)
		}
		if !strings.Contains(capRow, bgSGR(theme.Bg)) {
			t.Fatalf("half-block cap should carry theme.Bg as its background: %q", capRow)
		}
	}
	if plain := string([]rune(ansi.Strip(topCap))[:sidebarWidth]); plain != strings.Repeat(theme.GlyphHalfBlockLower, sidebarWidth) {
		t.Fatalf("top cap's sidebar span should be all lower half blocks: %q", plain)
	}
	if plain := string([]rune(ansi.Strip(bottomCap))[:sidebarWidth]); plain != strings.Repeat(theme.GlyphHalfBlockUpper, sidebarWidth) {
		t.Fatalf("bottom cap's sidebar span should be all upper half blocks: %q", plain)
	}

	gapPlain := ansi.Strip(lines[buttonY-2])[:sidebarWidth]
	if strings.TrimSpace(gapPlain) != "" {
		t.Fatalf("row above the top cap (the gap) should be blank: %q", gapPlain)
	}
}

// TestFrameBlankBandAboveSummaryBox re-checks item 4 at the full frame
// level: the row right after the rule (and any amend banner) is blank in
// the sidebar column, and the row after THAT is the summary box's own top
// border.
func TestFrameBlankBandAboveSummaryBox(t *testing.T) {
	m := newMouseTestMission() // no stash, no amend
	l := m.layout()
	blankY := l.topH + l.sidebarTopH + l.listRegionH + 1 // +1 skips the rule line
	lines := strings.Split(m.View().Content, "\n")
	blankSidebarCol := ansi.Strip(lines[blankY])[:sidebarWidth]
	if strings.TrimSpace(blankSidebarCol) != "" {
		t.Fatalf("row above the summary box should be blank in the sidebar column: %q", blankSidebarCol)
	}
	if !strings.Contains(ansi.Strip(lines[blankY+1])[:sidebarWidth], "╭") {
		t.Fatalf("the row after the blank pad should be the summary box's own top border: %q", ansi.Strip(lines[blankY+1]))
	}
}

// TestFrameTabsGapBlankRowBeforeFilterBox re-checks item 2 at the full
// frame level: the row after the tabs underline is blank in the sidebar
// column, and the row after that is the filter box's own top border.
func TestFrameTabsGapBlankRowBeforeFilterBox(t *testing.T) {
	m := newMouseTestMission()
	blankY := m.layout().topH + 2 // topbar + the tabs row's own 2 lines
	lines := strings.Split(m.View().Content, "\n")
	blankSidebarCol := ansi.Strip(lines[blankY])[:sidebarWidth]
	if strings.TrimSpace(blankSidebarCol) != "" {
		t.Fatalf("row after the tabs underline should be blank in the sidebar column: %q", blankSidebarCol)
	}
	if !strings.Contains(ansi.Strip(lines[blankY+1])[:sidebarWidth], "╭") {
		t.Fatalf("the row after the tabs-gap blank should be the filter box's own top border: %q", ansi.Strip(lines[blankY+1]))
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

// ─── long-content scrolling (owner's reinforcement, 2026-09-19): the diff
// pane, the changes list, and every modal foldout must keep the cursor in
// view and track a thumb over content far longer than any plausible pane ──

// TestDiffPaneLongContentKeepsCursorVisibleAndThumbTracks pins the diff
// pane's own scroll contract after migrating to the shared picker.Viewport/
// ThumbSpan primitives: moving the cursor to the last of 250 lines must
// keep it inside [diffTop, diffTop+h), and the thumb must sit at the
// bottom of the rail once scrolled all the way down.
func TestDiffPaneLongContentKeepsCursorVisibleAndThumbTracks(t *testing.T) {
	const total = 250
	lines := make([]DiffLine, total)
	for i := range lines {
		lines[i] = DiffLine{Kind: "context", Text: fmt.Sprintf("line %d", i), SelIdx: -1}
	}
	m := &Mission{}
	m.model.Diff = DiffModel{Path: "big.go", Kind: "text", Lines: lines}
	m.moveDiffCursor(total) // clamps to the last line

	const width, height = 60, 20
	out := ansi.Strip(m.renderDiffLines(width, height))
	if m.diffCursor < m.diffTop || m.diffCursor >= m.diffTop+height {
		t.Fatalf("cursor %d should stay inside the viewport [%d,%d)", m.diffCursor, m.diffTop, m.diffTop+height)
	}
	if !strings.Contains(out, fmt.Sprintf("line %d", total-1)) {
		t.Fatalf("the last line should be visible after scrolling to it:\n%s", out)
	}
	// Scrolled all the way to the bottom: the thumb's own bottom edge should
	// sit at the rail's last row.
	thumbTop, thumbH := picker.ThumbSpan(m.diffTop, height, total)
	if thumbTop+thumbH != height {
		t.Fatalf("thumb should reach the rail's bottom once scrolled to the end: top=%d h=%d paneH=%d", thumbTop, thumbH, height)
	}
}

// TestChangesListLongContentKeepsCursorVisibleAndThumbTracks is the same
// contract for the sidebar's own Changes list: with 150 files (far more
// than any plausible pane's list region), moving the cursor to the last
// one must keep it inside the rendered window, and the thumb must reach
// the rail's bottom.
func TestChangesListLongContentKeepsCursorVisibleAndThumbTracks(t *testing.T) {
	const total = 150
	changes := make([]ChangeRow, total)
	for i := range changes {
		changes[i] = ChangeRow{Path: fmt.Sprintf("file%03d.go", i), Status: "modified", Include: "none"}
	}
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = Model{
		Current:      Current{Repo: "repo-tools", Branch: "main"},
		Changes:      changes,
		ChangedTotal: total,
		Commit:       CommitModel{ButtonLabel: fmt.Sprintf("Commit %d files to main", total)},
	}
	m.selected = changes[total-1].Path

	l := m.layout()
	if l.listRegionH >= total {
		t.Fatalf("setup: expected the list region to be shorter than %d rows, got %d", total, l.listRegionH)
	}
	out := ansi.Strip(m.View().Content)
	if !strings.Contains(out, changes[total-1].Path) {
		t.Fatalf("the last file should be visible after scrolling to it:\n%s", out)
	}
	if m.changesTop < total-l.listRegionH {
		t.Fatalf("scroll should have reached the bottom: changesTop=%d, listRegionH=%d, total=%d", m.changesTop, l.listRegionH, total)
	}
	thumbTop, thumbH := picker.ThumbSpan(m.changesTop, l.listRegionH, total)
	if thumbTop+thumbH != l.listRegionH {
		t.Fatalf("thumb should reach the list's own bottom once scrolled to the end: top=%d h=%d regionH=%d", thumbTop, thumbH, l.listRegionH)
	}
}

// TestMouseClickFileRowWhileScrolledMapsToAbsoluteIndex pins sidebarHit's
// own scroll-aware row mapping: once the list has scrolled, a click at a
// given screen row must resolve through m.changesTop to the ABSOLUTE
// Changes index under it, not the row's position within the window.
func TestMouseClickFileRowWhileScrolledMapsToAbsoluteIndex(t *testing.T) {
	const total = 150
	changes := make([]ChangeRow, total)
	for i := range changes {
		changes[i] = ChangeRow{Path: fmt.Sprintf("file%03d.go", i), Status: "modified", Include: "none"}
	}
	m := New(nil)
	m.width, m.height = 100, 30
	m.model = Model{
		Current:      Current{Repo: "repo-tools", Branch: "main"},
		Changes:      changes,
		ChangedTotal: total,
		Commit:       CommitModel{ButtonLabel: fmt.Sprintf("Commit %d files to main", total)},
	}
	m.selected = changes[total-1].Path
	m.View() // force a render so changesTop reflects the scrolled-to-bottom state

	l := m.layout()
	listStartY := l.topH + l.sidebarTopH
	// Click the first visible row of the (scrolled) list region.
	h := m.hitTest(20, listStartY)
	if h.kind != hitFileRow && h.kind != hitFileCheckbox {
		t.Fatalf("expected a file-row hit at the top of the scrolled window, got %+v", h)
	}
	if h.idx != m.changesTop {
		t.Fatalf("hit index should be the absolute Changes index %d, got %d", m.changesTop, h.idx)
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
	if len(lines) != 3 {
		t.Fatalf("segment should render exactly 3 rows (label, value, blank breathing band), got %d:\n%s", len(lines), out)
	}
	labelRow, valueRow, blankRow := lines[0], lines[1], lines[2]
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
	if !strings.Contains(blankRow, bgSGR(theme.BgSubtle)) {
		t.Fatalf("the third, blank breathing row should still wear the BgSubtle band: %q", blankRow)
	}
	if strings.TrimSpace(ansi.Strip(blankRow)) != "" {
		t.Fatalf("the third row should be blank: %q", blankRow)
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

// TestHalfBlockGlyphsMeasureAsOneCell pins the same width footgun for the
// commit button's sub-cell caps: ▄/▀ sit in Unicode's East Asian Ambiguous
// range in some width tables, which some terminfo/locale combinations widen
// to 2 cells -- renderCommitButton's strings.Repeat(glyph, width) padding
// would silently drift if go-runewidth measured them as anything but 1.
func TestHalfBlockGlyphsMeasureAsOneCell(t *testing.T) {
	for _, g := range []string{theme.GlyphHalfBlockLower, theme.GlyphHalfBlockUpper} {
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
