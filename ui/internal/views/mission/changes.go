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

// renderTabsRow paints the two-tab header: Changes (bold, an underline bar
// the width of "Changes N", and its count in PinkSoft) beside History
// (Dimmer, with the "v2" meta the design boards use to mark it deferred).
func renderTabsRow(changedTotal, width int) string {
	changes := fg(theme.Text).Bold(true).Render("Changes")
	count := fg(theme.PinkSoft).Render(fmt.Sprintf(" %d", changedTotal))
	gap := "    "
	history := fg(theme.Dimmer).Render("History") + fg(theme.Faint).Render(" v2")
	top := changes + count + gap + history
	underline := fg(theme.Pink).Render(strings.Repeat("─", lipgloss.Width(changes+count)))
	return lipgloss.NewStyle().Width(width).Render(top) + "\n" + lipgloss.NewStyle().Width(width).Render(underline)
}

// renderFilterRow paints the "❯ filter" box: the typed filter text, or the
// Faint placeholder while empty. The border brightens to Pink while the
// filter itself holds focus, mirroring the summary/description boxes below.
func renderFilterRow(text string, focused bool, width int) string {
	inner := width - 4
	if inner < 1 {
		inner = 1
	}
	promptW := lipgloss.Width(theme.GlyphChevron) + 1
	textW := inner - promptW
	if textW < 0 {
		textW = 0
	}
	body := text
	bodyStyle := fg(theme.Text)
	if body == "" {
		body = "Filter changes"
		bodyStyle = fg(theme.Faint)
	}
	line := fg(theme.Dimmer).Render(theme.GlyphChevron+" ") + bodyStyle.Render(clip(body, textW))
	border := theme.Panel
	if focused {
		border = theme.Pink
	}
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(border).Padding(0, 1).
		Render(lipgloss.NewStyle().Width(inner).Render(line))
}

// renderMasterRow is the "N changed files · M staged" line, its glyph the
// same tri-state read as a row's own checkbox: all staged reads ◉, none ○,
// otherwise the mixed ◪.
func renderMasterRow(changedTotal, stagedTotal, width int) string {
	glyph := theme.GlyphStopped
	switch {
	case changedTotal > 0 && stagedTotal == changedTotal:
		glyph = theme.GlyphOn
	case stagedTotal > 0:
		glyph = theme.GlyphMixed
	}
	text := fmt.Sprintf("%d changed files · %d staged", changedTotal, stagedTotal)
	return lipgloss.NewStyle().Width(width).Render(fg(theme.Dim).Render(glyph + "  " + text))
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
	on := lipgloss.NewStyle()
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
// yet a foldout (a later interaction pass wires the click).
func renderStashStrip(count, width int) string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	left := on.Foreground(theme.Dim).Render(fmt.Sprintf("Stashed changes · %d", count))
	right := on.Foreground(theme.Dimmer).Render(theme.GlyphChevron)
	return justify(on, width, left, right)
}

// renderCommitBox paints the amending banner (when locally toggled on), the
// summary box, the description box, and the commit button, top to bottom.
func renderCommitBox(width int, summaryView, descView string, amending bool, buttonLabel string, canCommit bool) string {
	var lines []string
	if amending {
		lines = append(lines, fg(theme.Peach).Render("Amending last commit · a stops"))
	}
	lines = append(lines, boxLine(width, summaryView))
	lines = append(lines, boxBlock(width, []string{descView, ""}))
	lines = append(lines, renderCommitButton(width, buttonLabel, canCommit))
	return lipgloss.JoinVertical(lipgloss.Left, lines...)
}

func boxLine(width int, content string) string {
	return boxBlock(width, []string{content})
}

func boxBlock(width int, contentLines []string) string {
	inner := width - 4
	if inner < 1 {
		inner = 1
	}
	padded := make([]string, len(contentLines))
	for i, l := range contentLines {
		padded[i] = lipgloss.NewStyle().Width(inner).Render(l)
	}
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(theme.Panel).Padding(0, 1).
		Render(strings.Join(padded, "\n"))
}

// renderCommitButton is the full-width commit button: Pink with Bg-dark
// (i.e. theme.Bg foreground) text at rest, Panel background with Dimmer
// text once !canCommit -- the same rest/disabled pair InteractionStates.png
// pins for it.
func renderCommitButton(width int, label string, canCommit bool) string {
	style := lipgloss.NewStyle().Width(width).Align(lipgloss.Center).Bold(true)
	if canCommit {
		style = style.Background(theme.Pink).Foreground(theme.Bg)
	} else {
		style = style.Background(theme.Panel).Foreground(theme.Dimmer)
	}
	return style.Render(label)
}

// renderUndoStrip is the WarnBg strip a successful, still-undoable commit
// leaves behind: what got committed, when, and the Undo chip.
func renderUndoStrip(lc LastCommit, width int) string {
	on := lipgloss.NewStyle().Background(theme.WarnBg)
	left := on.Foreground(theme.Dimmer).Render("Committed "+lc.When+" · ") + on.Foreground(theme.TextSoft).Render(lc.Summary)
	right := on.Foreground(theme.Text).Background(theme.Panel).Padding(0, 1).Render("Undo")
	return justify(on, width, left, right)
}

// renderKeybar is the bottom full-width legend, key glyphs in KeybarKey
// (bold) and their labels in KeybarLabel, separated by a Dim middle dot --
// the same grammar the picker and board keybars use.
func renderKeybar(width int) string {
	on := lipgloss.NewStyle()
	dot := fg(theme.Dim).Render(" · ")
	key := func(k, label string) string {
		return fg(theme.KeybarKey).Bold(true).Render(k) + fg(theme.KeybarLabel).Render(" "+label)
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
		left = clip(left, maxLeft)
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
	if head+tail >= len(r) {
		return s
	}
	return string(r[:head]) + "…" + string(r[len(r)-tail:])
}
