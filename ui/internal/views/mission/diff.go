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
)

// diffNumWidth is the fixed cell width of the old/new line-number gutter
// columns (right-aligned 4 cells each).
const diffNumWidth = 4

func (m *Mission) diffKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "esc":
		m.focus = focusList
	case "q":
		return m.quit()
	case "up":
		m.moveDiffCursor(-1)
	case "down":
		m.moveDiffCursor(1)
	case "space":
		return m, m.diffIntent("mission:stage", "line")
	case "s":
		return m, m.diffIntent("mission:stage", "hunk")
	case "d":
		return m, m.diffIntent("mission:discard", "line")
	case "enter":
		if m.model.Diff.Kind == "oversized" {
			return m, m.em.Emit(protocol.Intent{Name: "mission:select", Payload: mustPayload(diffSelectPayload{ShowOversized: true})})
		}
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

func (m *Mission) currentDiffLine() (DiffLine, bool) {
	if m.diffCursor < 0 || m.diffCursor >= len(m.model.Diff.Lines) {
		return DiffLine{}, false
	}
	return m.model.Diff.Lines[m.diffCursor], true
}

type diffStagePayload struct {
	Path   string `json:"path"`
	Mode   string `json:"mode"`
	SelIdx int    `json:"selIdx"`
}

type diffSelectPayload struct {
	ShowOversized bool `json:"showOversized"`
}

func (m *Mission) diffIntent(name, mode string) tea.Cmd {
	line, ok := m.currentDiffLine()
	if !ok {
		return nil
	}
	payload := diffStagePayload{Path: m.model.Diff.Path, Mode: mode, SelIdx: line.SelIdx}
	return m.em.Emit(protocol.Intent{Name: name, Payload: mustPayload(payload)})
}

// renderDiffPane paints the diff header and body for whatever Kind the
// current Diff model carries, at the given content width and pane height.
func (m *Mission) renderDiffPane(width, height int) string {
	d := m.model.Diff
	if width < 1 || height < 1 {
		return ""
	}
	if d.Kind == "" || d.Kind == "none" {
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
// a Dimmer staging hint flush right, over a BgSubtle fill.
func renderDiffHeader(d DiffModel, width int) string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	left := on.Foreground(theme.TextSoft).Bold(true).Render(d.Path)
	if d.Stats != "" {
		left += on.Render("  ") + on.Foreground(theme.Dimmer).Render(d.Stats)
	}
	right := on.Foreground(theme.Dimmer).Render("space stages line · s stages hunk")
	return justify(on, width, left, right)
}

func centeredMessage(width, height int, col color.Color, text string) string {
	return lipgloss.NewStyle().Width(width).Height(height).Align(lipgloss.Center, lipgloss.Center).Foreground(col).Render(text)
}

func renderOversizedBody(width, height int) string {
	msg := fg(theme.Faint).Render("Diff too large to display by default")
	hint := fg(theme.Dimmer).Render("enter shows it anyway")
	block := lipgloss.JoinVertical(lipgloss.Center, msg, hint)
	return lipgloss.NewStyle().Width(width).Height(height).Align(lipgloss.Center, lipgloss.Center).Render(block)
}

// renderDiffLines paints the visible line window -- a stage-bar/number
// gutter and chroma-highlighted (or flat) text per line -- plus a 1-cell
// Panel scroll thumb along the right edge.
func (m *Mission) renderDiffLines(width, height int) string {
	lines := m.model.Diff.Lines
	top, h := diffViewport(m.diffCursor, m.diffTop, len(lines), height)
	m.diffTop = top

	contentW := width - 1 // 1 cell reserved for the scroll thumb
	if contentW < 0 {
		contentW = 0
	}
	thumbTop, thumbH := diffThumbSpan(top, h, len(lines))

	rows := make([]string, height)
	for i := 0; i < height; i++ {
		idx := top + i
		line := lipgloss.NewStyle().Width(contentW).Render("")
		if idx < len(lines) {
			line = renderDiffLine(m.model.Diff, lines[idx], contentW)
		}
		rows[i] = line + diffThumbCell(i, thumbTop, thumbH)
	}
	return strings.Join(rows, "\n")
}

// diffViewport keeps the cursor inside [top, top+h), sliding the window the
// minimum amount needed rather than recentering -- the board tail pane's
// precedent for a scroll window driven off a moving point of interest.
func diffViewport(cursor, top, n, paneRows int) (newTop, h int) {
	h = paneRows
	if h > n {
		h = n
	}
	if h < 0 {
		h = 0
	}
	if h == 0 {
		return 0, 0
	}
	maxTop := n - h
	if maxTop < 0 {
		maxTop = 0
	}
	if top > maxTop {
		top = maxTop
	}
	if top < 0 {
		top = 0
	}
	if cursor < top {
		top = cursor
	}
	if cursor >= top+h {
		top = cursor - h + 1
	}
	return top, h
}

// diffThumbSpan mirrors the picker rail's sizing (h*h/n, floored, minimum
// one row, in lockstep with the scroll offset) so the two scrollbars in the
// same TUI read the same way.
func diffThumbSpan(top, h, n int) (thumbTop, thumbH int) {
	if n <= 0 || h <= 0 {
		return 0, 0
	}
	thumbH = h * h / n
	if thumbH < 1 {
		thumbH = 1
	}
	if thumbH > h {
		thumbH = h
	}
	maxTop := n - h
	if maxTop <= 0 {
		return 0, thumbH
	}
	avail := h - thumbH
	if avail < 0 {
		avail = 0
	}
	thumbTop = top * avail / maxTop
	return thumbTop, thumbH
}

func diffThumbCell(row, thumbTop, thumbH int) string {
	if row >= thumbTop && row < thumbTop+thumbH {
		return lipgloss.NewStyle().Background(theme.Panel).Render(" ")
	}
	return " "
}

// renderDiffLine paints one line's gutter (stage bar + right-aligned
// old/new numbers) and its mark/text, or the full-width hunk bar when Kind
// is "hunk" -- the "@@ ... @@" text IS the hunk toggle, so it gets no
// gutter columns of its own.
func renderDiffLine(d DiffModel, line DiffLine, width int) string {
	if width < 1 {
		return ""
	}
	if line.Kind == "hunk" {
		return lipgloss.NewStyle().Width(width).Background(theme.Surface).Foreground(theme.Lav).Render(" " + line.Text)
	}

	bar := " "
	barStyle := lipgloss.NewStyle()
	if line.Selected {
		bar = theme.GlyphBar
		barStyle = barStyle.Foreground(theme.Pink)
	}
	gutter := barStyle.Render(bar) + numCell(line.OldNo) + numCell(line.NewNo)

	mark, base := lineMarkAndColor(line.Kind)
	textW := width - lipgloss.Width(gutter) - lipgloss.Width(mark)
	if textW < 0 {
		textW = 0
	}
	text := clip(line.Text, textW)

	rendered := fg(base).Render(text)
	if line.Kind != "del" && d.Lang != "" {
		rendered = highlightLine(d.Lang, text, base)
	}
	return lipgloss.NewStyle().Width(width).Render(gutter + fg(base).Render(mark) + rendered)
}

func numCell(n int) string {
	s := ""
	if n > 0 {
		s = fmt.Sprintf("%d", n)
	}
	return fg(theme.Faint).Width(diffNumWidth).Align(lipgloss.Right).Render(s)
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
