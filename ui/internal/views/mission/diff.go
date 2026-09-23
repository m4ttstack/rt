// Diff pane: header, chroma-highlighted lines, the stage/discard gutter,
// scrolling, and diff-focused key handling. Render functions here take
// their inputs explicitly; only the cursor/scroll fields on Mission
// (diffCursor, diffTop, diffPath) carry state across frames.
package mission

import (
	"fmt"
	"image/color"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

// diffNumWidth is the fixed cell width of the old/new line-number gutter
// columns (right-aligned 4 cells each).
const diffNumWidth = 4

// diffGutterWidth is a normal (non-hunk) line's clickable gutter span: the
// 1-cell stage bar plus the two number columns. mission.go's hit-testing
// uses this to tell a gutter click (stages) from a click on the line's own
// text (just moves the cursor).
const diffGutterWidth = 1 + diffNumWidth*2

func (m *Mission) diffKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := v.String()
	if m.model.Diff.ReadOnly && (key == "space" || key == "s" || key == "d") {
		return m, nil
	}
	switch key {
	case "esc":
		if m.historyTab() {
			m.focus = focusHistoryFiles
		} else {
			m.focus = focusList
		}
	case "q":
		return m.quit()
	case "ctrl+k":
		m.openMenu(m.focusedTarget(), nil)
	case "e":
		if m.historyTab() {
			m.historyExpanded = !m.historyExpanded
		}
	case "up":
		m.moveDiffCursor(-1)
	case "down":
		m.moveDiffCursor(1)
	case "space":
		return m, m.diffStageOrDiscardIntent("mission:stage")
	case "s":
		return m, m.diffHunkIntent()
	case "d":
		return m, m.diffStageOrDiscardIntent("mission:discard")
	case "enter":
		if m.model.Diff.Kind != "oversized" {
			break
		}
		if m.historyTab() {
			return m, m.em.Emit(protocol.Intent{Name: "mission:history-file", Payload: mustPayload(historyFilePayload{Path: m.model.Diff.Path, ShowOversized: true})})
		}
		return m, m.em.Emit(protocol.Intent{Name: "mission:select", Payload: mustPayload(diffSelectPayload{ShowOversized: true})})
	}
	return m, nil
}

// clampDiffCursor resets the line cursor and scroll top when the diff pane
// starts showing a different file (a carried-over cursor would otherwise
// point at an unrelated line) and otherwise clamps the cursor to the new
// line count, preserving position across a same-file refresh such as a
// stage shifting the hunk.
func (m *Mission) clampDiffCursor() {
	if m.model.Diff.Path != m.diffPath {
		m.diffPath = m.model.Diff.Path
		m.diffCursor = 0
		m.diffTop = 0
		return
	}
	if n := len(m.model.Diff.Lines); m.diffCursor >= n {
		m.diffCursor = n - 1
	}
	if m.diffCursor < 0 {
		m.diffCursor = 0
	}
}

func (m *Mission) moveDiffCursor(delta int) {
	n := len(m.model.Diff.Lines)
	if n == 0 {
		return
	}
	m.diffCursor += delta
	if m.diffCursor < 0 {
		m.diffCursor = 0
	}
	if m.diffCursor >= n {
		m.diffCursor = n - 1
	}
}

type diffStagePayload struct {
	Path   string `json:"path"`
	Mode   string `json:"mode"`
	SelIdx int    `json:"selIdx"`
}

type diffSelectPayload struct {
	ShowOversized bool `json:"showOversized"`
}

// hunkBounds returns the line-index span of the hunk containing idx: start
// is the hunk-header index at or before idx (0 when idx sits before any
// header), end is the next hunk-header index after idx, or len(lines) when
// idx's hunk is the last one. Both space/d's header resolution and s's
// same-hunk scan need this same span, so it is not specific to either.
func hunkBounds(lines []DiffLine, idx int) (start, end int) {
	start = 0
	for i := idx; i >= 0; i-- {
		if lines[i].Kind == "hunk" {
			start = i
			break
		}
	}
	end = len(lines)
	for i := idx + 1; i < len(lines); i++ {
		if lines[i].Kind == "hunk" {
			end = i
			break
		}
	}
	return start, end
}

// firstSelectable scans [from, end) forward for the first line carrying a
// real SelIdx (context and hunk lines are -1 and never match).
func firstSelectable(lines []DiffLine, from, end int) (int, bool) {
	for i := from; i < end && i < len(lines); i++ {
		if lines[i].SelIdx >= 0 {
			return lines[i].SelIdx, true
		}
	}
	return 0, false
}

// resolveStageTarget picks the mode+selIdx a space/d press at cursor should
// carry. An add/del line stages or discards itself in line mode. The hunk
// header IS the toggle for its whole hunk, so it resolves to hunk mode and
// the first selectable line after it. A context line has nothing to select
// (SelIdx -1, and it is not a toggle either), so ok is false and the
// caller must no-op rather than emit a negative selIdx -- the bug this
// resolver exists to close.
func resolveStageTarget(lines []DiffLine, cursor int) (mode string, selIdx int, ok bool) {
	if cursor < 0 || cursor >= len(lines) {
		return "", 0, false
	}
	line := lines[cursor]
	if line.SelIdx >= 0 {
		return "line", line.SelIdx, true
	}
	if line.Kind != "hunk" {
		return "", 0, false
	}
	_, end := hunkBounds(lines, cursor)
	if sel, ok := firstSelectable(lines, cursor+1, end); ok {
		return "hunk", sel, true
	}
	return "", 0, false
}

// resolveHunkTarget picks the selIdx an s press at cursor should carry: the
// cursor's own line when it is already selectable, else the nearest
// selectable line in the same hunk -- forward first, then backward, per the
// ruling -- else no target at all (ok false), an empty hunk with no add/del
// lines.
func resolveHunkTarget(lines []DiffLine, cursor int) (selIdx int, ok bool) {
	if cursor < 0 || cursor >= len(lines) {
		return 0, false
	}
	if lines[cursor].SelIdx >= 0 {
		return lines[cursor].SelIdx, true
	}
	start, end := hunkBounds(lines, cursor)
	if sel, ok := firstSelectable(lines, cursor+1, end); ok {
		return sel, true
	}
	for i := cursor - 1; i >= start; i-- {
		if lines[i].SelIdx >= 0 {
			return lines[i].SelIdx, true
		}
	}
	return 0, false
}

func (m *Mission) diffStageOrDiscardIntent(name string) tea.Cmd {
	mode, selIdx, ok := resolveStageTarget(m.model.Diff.Lines, m.diffCursor)
	if !ok {
		return nil
	}
	payload := diffStagePayload{Path: m.model.Diff.Path, Mode: mode, SelIdx: selIdx}
	return m.em.Emit(protocol.Intent{Name: name, Payload: mustPayload(payload)})
}

func (m *Mission) diffHunkIntent() tea.Cmd {
	selIdx, ok := resolveHunkTarget(m.model.Diff.Lines, m.diffCursor)
	if !ok {
		return nil
	}
	payload := diffStagePayload{Path: m.model.Diff.Path, Mode: "hunk", SelIdx: selIdx}
	return m.em.Emit(protocol.Intent{Name: "mission:stage", Payload: mustPayload(payload)})
}

// renderDiffPane paints the diff header and body for whatever Kind the
// current Diff model carries, at the given content width and pane height.
func (m *Mission) renderDiffPane(width, height int) string {
	d := m.model.Diff
	if width < 1 || height < 1 {
		return ""
	}
	if d.Kind == "" || d.Kind == "none" {
		// A commit with no files shows only the file column's empty state,
		// as GHD suppresses the second one.
		if m.historyTab() {
			msg := ""
			if len(m.model.History.Files) > 0 {
				msg = "No file selected"
			}
			return centeredMessage(width, height, theme.Faint, clip(msg, width))
		}
		// ChangedTotal, not len(Changes): Changes is the FILTERED list
		// (lib/mission/model.ts computes changedTotal from allChanges before
		// the filter narrows it), so a filter matching nothing on a dirty
		// worktree must not read as a clean one.
		if m.model.ChangedTotal == 0 {
			return renderEmptyStateCard(width, height)
		}
		return centeredMessage(width, height, theme.Faint, "select a file")
	}
	header := renderDiffHeader(d, width)
	bodyH := height - lipgloss.Height(header)
	if bodyH < 0 {
		bodyH = 0
	}
	var body string
	switch d.Kind {
	case "binary":
		body = centeredMessage(width, bodyH, theme.Faint, "This binary file has changed.")
	case "oversized":
		body = renderOversizedBody(width, bodyH)
	default:
		body = m.renderDiffLines(width, bodyH)
	}
	return lipgloss.JoinVertical(lipgloss.Left, header, body)
}

// renderDiffHeader is the path/stats bar: bold TextSoft path, Dimmer stats,
// a Dimmer staging hint flush right (none on a read-only diff), over a
// BgSubtle fill.
func renderDiffHeader(d DiffModel, width int) string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	left := on.Foreground(theme.TextSoft).Bold(true).Render(d.Path)
	if d.Stats != "" {
		left += on.Render("  ") + on.Foreground(theme.Dimmer).Render(d.Stats)
	}
	right := ""
	if !d.ReadOnly {
		right = on.Foreground(theme.Dimmer).Render("space stages line · s stages hunk")
	}
	return justify(on, width, left, right)
}

// centeredMessage wraps text to width and centers it in a width x height
// box. Height pads but never truncates, so wrapped rows past the box are
// dropped here rather than growing the frame.
func centeredMessage(width, height int, col color.Color, text string) string {
	style := lipgloss.NewStyle().Width(width).Background(theme.Bg)
	rows := strings.Split(style.Align(lipgloss.Center).Foreground(col).Render(text), "\n")
	if len(rows) > height {
		rows = rows[:max(height, 0)]
	}
	return style.Height(height).AlignVertical(lipgloss.Center).Render(strings.Join(rows, "\n"))
}

// renderEmptyStateCard is the clean-worktree diff pane (docs/design/mission/
// EmptyState.png): no GitHub Desktop card clone, just a centered title,
// subline, and the four keys that get a repo out of that state.
func renderEmptyStateCard(width, height int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	title := on.Foreground(theme.Text).Bold(true).Render("No local changes")
	subline := on.Foreground(theme.Dim).Render("the working tree is clean")
	hint := func(key, label string) string {
		return on.Foreground(theme.Pink).Bold(true).Render(key) + on.Foreground(theme.Dimmer).Render("  "+label)
	}
	lines := []string{
		title,
		subline,
		"",
		hint("f", "run the fetch/pull/push action"),
		hint("b", "switch branch"),
		hint("w", "switch worktree"),
		hint("r", "switch repository"),
	}
	// JoinVertical centers shorter lines by padding them with bare,
	// unstyled spaces (it has no whitespace-style option, unlike
	// PlaceHorizontal), so each line is pre-padded to the widest one
	// through on itself first -- JoinVertical then has no padding left to
	// add of its own.
	maxW := 0
	for _, l := range lines {
		if w := lipgloss.Width(l); w > maxW {
			maxW = w
		}
	}
	// diffWidth has no positive minimum, so a narrow but reachable pane can
	// be narrower than the longest hint line; clip every line to the pane's
	// own width before padding, or lipgloss wraps the overflowing one
	// instead of truncating it, growing the block past height.
	if maxW > width {
		maxW = width
	}
	padded := make([]string, len(lines))
	for i, l := range lines {
		padded[i] = on.Width(maxW).Align(lipgloss.Center).Render(clipOn(l, maxW, on))
	}
	block := lipgloss.JoinVertical(lipgloss.Left, padded...)
	return on.Width(width).Height(height).Align(lipgloss.Center, lipgloss.Center).Render(block)
}

func renderOversizedBody(width, height int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	msg := on.Foreground(theme.Faint).Render("Diff too large to display by default")
	hint := on.Foreground(theme.Dimmer).Render("enter shows it anyway")
	block := lipgloss.JoinVertical(lipgloss.Center, msg, hint)
	return on.Width(width).Height(height).Align(lipgloss.Center, lipgloss.Center).Render(block)
}

// renderDiffLines paints the visible line window -- a stage-bar/number
// gutter and chroma-highlighted (or flat) text per line -- plus a 1-cell
// Panel scroll thumb along the right edge.
func (m *Mission) renderDiffLines(width, height int) string {
	lines := m.model.Diff.Lines
	// picker.Viewport is the one scroll-offset primitive shared by every
	// scrolling region in the TUI (the picker's own list, this pane, the
	// mission foldouts): cap_=height and chromeRows=0 reproduce the diff
	// pane's own "no cap, fill the pane" contract while gaining picker's
	// vim-style scrolloff margin for free.
	top, h := picker.Viewport(m.diffCursor, m.diffTop, len(lines), height, height, 0)
	m.diffTop = top

	contentW := width - 1 // 1 cell reserved for the scroll thumb
	if contentW < 0 {
		contentW = 0
	}
	thumbTop, thumbH := picker.ThumbSpan(top, h, len(lines))
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	restOn := lipgloss.NewStyle().Background(theme.Bg)

	rows := make([]string, height)
	for i := 0; i < height; i++ {
		idx := top + i
		line := lipgloss.NewStyle().Width(contentW).Background(theme.Bg).Render("")
		if idx < len(lines) {
			hover := idx == m.hoverDiffLine
			line = renderDiffLine(m.model.Diff, lines[idx], contentW, hover, hover && m.hoverGutter)
		}
		rows[i] = line + picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
	}
	return strings.Join(rows, "\n")
}

// renderDiffLine paints one line's gutter (stage bar + right-aligned
// old/new numbers) and its mark/text, or the full-width hunk bar when Kind
// is "hunk" -- the "@@ ... @@" text IS the hunk toggle, so it gets no
// gutter columns of its own. hover paints the row's own HoverBg; gutterHover
// additionally previews the stage bar in GutterHoverBar on an unselected
// add/del line -- a selected line keeps its solid Pink bar regardless, since
// there is nothing left to preview. A read-only line has nothing to stage,
// so it paints no bar at all. Chroma highlighting is skipped while
// hovered: highlightLine's per-token spans each carry their own SGR reset,
// which would cut the wrapping HoverBg out from under every other token.
func renderDiffLine(d DiffModel, line DiffLine, width int, hover, gutterHover bool) string {
	if width < 1 {
		return ""
	}
	rowBg := lipgloss.NewStyle().Background(theme.Bg)
	if hover {
		rowBg = rowBg.Background(theme.HoverBg)
	}
	if line.Kind == "hunk" {
		bg := theme.Surface
		if hover {
			bg = theme.HoverBg
		}
		// Width() pads but never truncates, and lipgloss wraps rather than
		// clipping non-inline content, so an unclipped header (a long
		// function-context suffix) can wrap onto a second row and desync
		// diffHit's row-to-Diff.Lines mapping. Clipped to one row first.
		return lipgloss.NewStyle().Width(width).Background(bg).Foreground(theme.Lav).Render(clip(" "+line.Text, width))
	}

	bar := " "
	barStyle := rowBg
	switch {
	case d.ReadOnly:
	case line.Selected:
		bar = theme.GlyphBar
		barStyle = barStyle.Foreground(theme.Pink)
	case gutterHover:
		bar = theme.GlyphBar
		barStyle = barStyle.Foreground(theme.GutterHoverBar)
	}
	gutter := barStyle.Render(bar) + numCell(rowBg, line.OldNo) + numCell(rowBg, line.NewNo)

	mark, base := lineMarkAndColor(line.Kind)
	textW := width - lipgloss.Width(gutter) - lipgloss.Width(mark)
	if textW < 0 {
		textW = 0
	}
	text := clip(line.Text, textW)

	rendered := rowBg.Foreground(base).Render(text)
	if line.Kind != "del" && d.Lang != "" && !hover {
		rendered = highlightLine(d.Lang, text, base, theme.Bg)
	}
	// A pane narrower than the gutter would otherwise wrap the row.
	return rowBg.Width(width).Render(clipOn(gutter+rowBg.Foreground(base).Render(mark)+rendered, width, rowBg))
}

func numCell(bg lipgloss.Style, n int) string {
	s := ""
	if n > 0 {
		s = fmt.Sprintf("%d", n)
	}
	return bg.Foreground(theme.Faint).Width(diffNumWidth).Align(lipgloss.Right).Render(s)
}

func lineMarkAndColor(kind string) (string, color.Color) {
	switch kind {
	case "add":
		return "+", theme.Mint
	case "del":
		return "-", theme.Coral
	default:
		return " ", theme.TextSoft
	}
}
