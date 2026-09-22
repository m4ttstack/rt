// Changes sidebar, commit box, and keybar rendering. Every function here is
// pure (values in, a string out); mission.go owns all state and focus
// routing and only hands this file what a given frame needs to paint.
package mission

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

// commitBoxInner is the summary/description/filter input width once the
// rounded border and its (0,1) padding (4 cells total) are subtracted from
// sidebarWidth. A constant, not derived from the live terminal width: the
// sidebar itself is locked to sidebarWidth regardless of how wide the
// terminal is (topbar.go's own comment on the repo segment).
const commitBoxInner = sidebarWidth - 4

// renderTabsRow paints the two-tab header per Main.png/EmptyState.png: Changes
// and History each occupy HALF the sidebar width with centered labels, and
// the underline runs the full width -- Pink under the active tab's half,
// Rule under the inactive half (the board's own bottom border). Changes is
// always the active tab; History has no wire state to select it yet
// (renderKeybar's own "History lands in v2" notice covers a click on it).
// hoverHistory paints HoverBg behind the History label's own half only --
// the underline's active/inactive split is untouched by hover.
func renderTabsRow(changedTotal int, hoverHistory bool, width int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	half := width / 2
	otherHalf := width - half

	historyOn := on
	if hoverHistory {
		historyOn = on.Background(theme.HoverBg)
	}

	changesLabel := on.Foreground(theme.Text).Bold(true).Render("Changes") +
		on.Foreground(theme.PinkSoft).Render(fmt.Sprintf(" %d", changedTotal))
	historyLabel := historyOn.Foreground(theme.Dimmer).Render("History") + historyOn.Foreground(theme.Faint).Render(" v2")

	top := on.Width(half).Align(lipgloss.Center).Render(changesLabel) +
		historyOn.Width(otherHalf).Align(lipgloss.Center).Render(historyLabel)
	underline := on.Foreground(theme.Pink).Render(strings.Repeat("─", half)) +
		on.Foreground(theme.Rule).Render(strings.Repeat("─", otherHalf))
	return top + "\n" + underline
}

// renderFilterRow paints the "❯ filter" box: the typed filter text, or the
// Faint placeholder while empty. The border brightens to Pink while the
// filter itself holds focus, mirroring the summary/description boxes below;
// hover gets the exact same Pink treatment (unlike the summary/description
// boxes, the filter box has no separate dimmer hover tone to stay distinct
// from -- hovering it while it also holds focus is simply a no-op repaint).
func renderFilterRow(text string, focused, hovered bool, width int) string {
	inner := width - 4
	if inner < 1 {
		inner = 1
	}
	promptW := lipgloss.Width(theme.GlyphChevron) + 1
	textW := inner - promptW
	if textW < 0 {
		textW = 0
	}
	on := lipgloss.NewStyle().Background(theme.Bg)
	body := text
	bodyStyle := on.Foreground(theme.Text)
	if body == "" {
		body = "Filter changes"
		bodyStyle = on.Foreground(theme.Faint)
	}
	line := on.Foreground(theme.Dimmer).Render(theme.GlyphChevron+" ") + bodyStyle.Render(clip(body, textW))
	border := theme.Panel
	if focused || hovered {
		border = theme.Pink
	}
	return lipgloss.NewStyle().Background(theme.Bg).Border(lipgloss.RoundedBorder()).BorderForeground(border).BorderBackground(theme.Bg).Padding(0, 1).
		Render(on.Width(inner).Render(line))
}

// renderMasterRow is the "N changed files · M staged" line, its glyph the
// same tri-state read as a row's own checkbox: all staged reads ◉, none ○,
// otherwise the mixed ◪. changedTotal/stagedTotal are driver-supplied ints
// with no practical upper bound, so the text is clipped before it reaches
// Width() -- CodeRabbit's PR #353 finding on the neighboring commit button
// was this same class of bug (Width() wraps instead of truncating).
func renderMasterRow(changedTotal, stagedTotal, width int) string {
	glyph := theme.GlyphStopped
	switch {
	case changedTotal > 0 && stagedTotal == changedTotal:
		glyph = theme.GlyphOn
	case stagedTotal > 0:
		glyph = theme.GlyphMixed
	}
	text := fmt.Sprintf("%d changed files · %d staged", changedTotal, stagedTotal)
	on := lipgloss.NewStyle().Background(theme.Bg)
	prefix := glyph + "  "
	textW := width - lipgloss.Width(prefix)
	if textW < 0 {
		textW = 0
	}
	// clip, not clipOn: text carries no color of its own yet, and clipOn's
	// non-truncating path renders its input through a colorless style
	// (safe only when the input already carries its own embedded fg+bg per
	// fragment, e.g. justify's left) -- passing plain text through it left
	// a real background hole here (caught by the bg-coverage frame tests).
	return on.Width(width).Render(on.Foreground(theme.Dim).Render(prefix + clip(text, textW)))
}

// changeRowCheckboxSpan is the column range renderChangeRow's checkbox glyph
// occupies, in lockstep with its own prefix+glyph layout: mission.go's click
// routing hit-tests against this instead of re-deriving the row's own
// column math a second time.
func changeRowCheckboxSpan(c ChangeRow) (start, end int) {
	glyph, _ := changeGlyph(c.Include)
	start = lipgloss.Width("  ")
	return start, start + lipgloss.Width(glyph)
}

// changeGlyph maps a row's Include to its checkbox glyph and color: all and
// partial both read as "something is staged here" (PinkSoft), none fades to
// Faint so an untouched row recedes behind the ones that matter.
func changeGlyph(include string) (string, color.Color) {
	switch include {
	case "all":
		return theme.GlyphOn, theme.PinkSoft
	case "partial":
		return theme.GlyphMixed, theme.PinkSoft
	default:
		return theme.GlyphStopped, theme.Faint
	}
}

// statusGlyph maps a ChangeRow.Status word to the single letter (or "!" for
// a conflict) the boards paint beside a row, and that letter's accent.
func statusGlyph(status string) (string, color.Color) {
	switch status {
	case "modified":
		return "M", theme.Peach
	case "new":
		return "A", theme.Mint
	case "deleted":
		return "D", theme.Coral
	case "renamed":
		return "R", theme.Blue
	case "copied":
		return "C", theme.Mint
	case "conflicted":
		return "!", theme.Coral
	default:
		return "?", theme.Faint
	}
}

// renderChangeRow paints one Changes row: the cursor bar, the tri-state
// checkbox, the middle-truncated path (a path's filename -- the tail -- is
// what a user actually needs to see, which an end-truncated path would
// hide), the partial meta, and the status letter. hover paints HoverBg but
// only when cursor is false: the keyboard cursor's SelBg always wins, so
// moving the mouse across the list can never displace it.
func renderChangeRow(c ChangeRow, width int, cursor, hover bool) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	prefix := "  "
	switch {
	case cursor:
		on = on.Background(theme.SelBg)
		prefix = "▌ "
	case hover:
		on = on.Background(theme.HoverBg)
	}
	glyph, glyphColor := changeGlyph(c.Include)
	checkbox := on.Foreground(glyphColor).Render(glyph)

	statusLetter, statusColor := statusGlyph(c.Status)
	meta := ""
	if c.Include == "partial" {
		meta = "partial "
	}
	trailing := on.Foreground(theme.Faint).Render(meta) + on.Foreground(statusColor).Render(statusLetter)
	trailingW := lipgloss.Width(meta) + lipgloss.Width(statusLetter)

	fixed := lipgloss.Width(prefix) + lipgloss.Width(glyph) + 2 // gap after checkbox + gap before trailing
	pathW := width - fixed - trailingW
	if pathW < 1 {
		pathW = 1
	}
	path := middleTruncate(c.Path, pathW)

	line := on.Render(prefix) + checkbox + on.Render(" ") +
		on.Foreground(theme.Text).Width(pathW).Render(path) + on.Render(" ") + trailing
	return on.Width(width).Render(line)
}

// renderStashStrip is the "Stashed changes · N ❯" row: a notice strip, not
// yet a foldout (a later interaction pass wires the click). hovered swaps
// its whole-strip BgSubtle rest fill for HoverBg.
func renderStashStrip(count int, hovered bool, width int) string {
	bg := theme.BgSubtle
	if hovered {
		bg = theme.HoverBg
	}
	on := lipgloss.NewStyle().Background(bg)
	left := on.Foreground(theme.Dim).Render(fmt.Sprintf("Stashed changes · %d", count))
	right := on.Foreground(theme.Dimmer).Render(theme.GlyphChevron)
	return justify(on, width, left, right)
}

// renderCommitBox paints the amending banner (when locally toggled on), the
// summary box, the description box, and the commit button, top to bottom.
// Amending overrides the button's own label to "Amend last commit" -- a
// display-only substitution; enabled (the caller's commitEnabled result)
// still gates the button's treatment, amending or not. hoverButton/
// hoverSummary/hoverDescription are each region's own independent hover
// flag (mission.go's mouseMotion never sets more than one at a time, but
// nothing here assumes that).
func renderCommitBox(width int, summaryView, descriptionView string, amending bool, buttonLabel string, enabled, hoverButton, hoverSummary, hoverDescription bool) string {
	var lines []string
	if amending {
		on := lipgloss.NewStyle().Background(theme.Bg)
		lines = append(lines, on.Width(width).Render(on.Foreground(theme.Peach).Render("Amending last commit · a stops")))
		buttonLabel = "Amend last commit"
	}
	// The board's own CommitBox top padding (12px) reads as one blank band
	// row in the terminal (docs/design/mission/README.md's Terminal
	// geometry table).
	lines = append(lines, blankRows(width, 1))
	lines = append(lines, boxLine(width, summaryView, hoverSummary))
	lines = append(lines, boxBlock(width, []string{descriptionView, ""}, hoverDescription))
	// The board's own gap between the description box and the button (8px)
	// reads as one blank band row -- unlike the summary/description seam,
	// which stays flush (docs/design/mission/README.md's Terminal geometry
	// table).
	lines = append(lines, blankRows(width, 1))
	lines = append(lines, renderCommitButton(width, buttonLabel, enabled, hoverButton))
	return lipgloss.JoinVertical(lipgloss.Left, lines...)
}

func boxLine(width int, content string, hovered bool) string {
	return boxBlock(width, []string{content}, hovered)
}

// boxBlock's border brightens to GutterHoverBar (Pink blended half-way
// toward Bg -- the same dimmer-than-full-Pink tone the diff gutter's own
// hover preview already established) while hovered: dimmer than the filter
// box's Pink focus treatment on purpose, so a hovered summary/description
// box never reads as already focused.
func boxBlock(width int, contentLines []string, hovered bool) string {
	inner := width - 4
	if inner < 1 {
		inner = 1
	}
	on := lipgloss.NewStyle().Background(theme.Bg)
	padded := make([]string, len(contentLines))
	for i, l := range contentLines {
		padded[i] = on.Width(inner).Render(l)
	}
	var border color.Color = theme.Panel
	if hovered {
		border = theme.GutterHoverBar
	}
	return lipgloss.NewStyle().Background(theme.Bg).Border(lipgloss.RoundedBorder()).BorderForeground(border).BorderBackground(theme.Bg).Padding(0, 1).
		Render(strings.Join(padded, "\n"))
}

// renderCommitButton is the full-width commit button: Pink with Bg-dark
// (i.e. theme.Bg foreground) text at rest, Panel background with Dimmer
// text once !canCommit -- the same rest/disabled pair InteractionStates.png
// pins for it. renderCommitBox supplies the blank gap row above it that
// separates it from the description box.
//
// Board scale is 32px against a 26px row unit, i.e. 1.23 cells -- no single
// terminal row can express that, so three physical rows carry it (ratified
// 2026-09-20, "mission commit button gains its half-cell padding",
// superseding the single solid row an earlier pass drew): a half-block
// "cap" row above and below the full solid label row. GlyphHalfBlockLower
// (▄) as that row's own FOREGROUND on a theme.Bg background paints only the
// row's bottom half in the button color, leaving the top half as canvas;
// GlyphHalfBlockUpper (▀) mirrors that for the bottom cap's top half. The
// middle row is the button exactly as it always rendered -- full solid fill,
// centered label, clipped before Width() (lipgloss wraps a too-long string
// there instead of truncating it, and a long current.branch in "Commit N
// files to <branch>" would otherwise spill it onto a second row -- CodeRabbit
// finding on PR #353). The block is a fixed THREE-row unit in the sidebar's
// own layout now; sidebarHit maps all three rows to the same hit target.
// hovered brightens the fill to PinkSoft, but only when canCommit: a
// disabled button must never hover, since hover always means "this will do
// something".
func renderCommitButton(width int, label string, canCommit, hovered bool) string {
	buttonColor, textColor := theme.Pink, theme.Bg
	switch {
	case !canCommit:
		buttonColor, textColor = theme.Panel, theme.Dimmer
	case hovered:
		buttonColor = theme.PinkSoft
	}
	capStyle := lipgloss.NewStyle().Width(width).Background(theme.Bg).Foreground(buttonColor)
	labelStyle := lipgloss.NewStyle().Width(width).Align(lipgloss.Center).Bold(true).Background(buttonColor).Foreground(textColor)
	top := capStyle.Render(strings.Repeat(theme.GlyphHalfBlockLower, width))
	bottom := capStyle.Render(strings.Repeat(theme.GlyphHalfBlockUpper, width))
	return lipgloss.JoinVertical(lipgloss.Left, top, labelStyle.Render(clip(label, width)), bottom)
}

// renderUndoStrip is the WarnBg strip a successful, still-undoable commit
// leaves behind: what got committed, when, and the Undo chip. hovered
// brightens the chip's own Panel fill to HoverBg -- the strip's WarnBg line
// around it is untouched, so hover reads as the chip, not the whole row.
func renderUndoStrip(lc LastCommit, hovered bool, width int) string {
	on := lipgloss.NewStyle().Background(theme.WarnBg)
	left := on.Foreground(theme.Dimmer).Render("Committed "+lc.When+" · ") + on.Foreground(theme.TextSoft).Render(lc.Summary)
	chipBg := theme.Panel
	if hovered {
		chipBg = theme.HoverBg
	}
	right := on.Foreground(theme.Text).Background(chipBg).Padding(0, 1).Render("Undo")
	return justify(on, width, left, right)
}

// renderKeybar is the bottom full-width legend, key glyphs in KeybarKey
// (bold) and their labels in KeybarLabel, separated by a Dim middle dot --
// the same grammar the picker and board keybars use.
func renderKeybar(width int) string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	dot := on.Foreground(theme.Dim).Render(" · ")
	key := func(k, label string) string {
		return on.Foreground(theme.KeybarKey).Bold(true).Render(k) + on.Foreground(theme.KeybarLabel).Render(" "+label)
	}
	pairs := [][2]string{
		{"space", "stage"}, {"enter", "diff"}, {"c", "commit"}, {"f", "action"},
		{"b", "branch"}, {"w", "worktree"}, {"r", "repo"}, {"/", "filter"}, {"u", "undo"},
	}
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = key(p[0], p[1])
	}
	left := strings.Join(parts, dot)
	return justify(on, width, left, key("q", "quit"))
}

// justify lays left flush and right flush across width on style on,
// matching board.go's justify but parameterized on the caller's background
// style so a strip painted on WarnBg/BgSubtle fills correctly rather than
// leaving a transparent gap around the right-hand text. A left string wider
// than width-3 (an oversized last-commit summary) would otherwise push the
// composed line past width, dragging the whole sidebar block wider with it,
// so left is clipped to leave room for right before the two are joined --
// right (a short chip like "Undo" or the keybar's "q quit") always survives
// intact rather than being cut off the end of an already-overflowing line.
func justify(on lipgloss.Style, width int, left, right string) string {
	maxLeft := width - 3 - lipgloss.Width(right)
	if maxLeft < 0 {
		maxLeft = 0
	}
	if lipgloss.Width(left) > maxLeft {
		// left already carries its own fg+bg per fragment (justify's
		// callers), so its ellipsis must too -- clipOn, not clip.
		left = clipOn(left, maxLeft, on)
	}
	avail := width - 3 - lipgloss.Width(left)
	if avail < 0 {
		avail = 0
	}
	return on.Render("  ") + left + lipgloss.PlaceHorizontal(avail, lipgloss.Right, right, lipgloss.WithWhitespaceStyle(on)) + on.Render(" ")
}

// middleTruncate keeps a path's head and tail and drops its middle behind
// an ellipsis once it doesn't fit w cells: the tail (the filename) is what a
// user needs to still read, which clip's end-truncation would hide instead.
func middleTruncate(s string, w int) string {
	if w < 1 {
		return ""
	}
	if lipgloss.Width(s) <= w {
		return s
	}
	if w == 1 {
		return "…"
	}
	r := []rune(s)
	keep := w - 1
	head := keep / 2
	tail := keep - head
	// The guard above is rune-counted but w is a cell budget: a run of
	// double-width (e.g. CJK) runes can pass it while still overflowing w
	// cells, so the composed result is re-checked by display width and
	// clipped rather than trusted on rune count alone.
	if head+tail >= len(r) {
		return clip(s, w)
	}
	out := string(r[:head]) + "…" + string(r[len(r)-tail:])
	if lipgloss.Width(out) > w {
		return clip(out, w)
	}
	return out
}
