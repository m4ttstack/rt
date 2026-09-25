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
	if m.stashShowing() {
		if cmd, ok := m.stashEntryKey(key); ok {
			return m, cmd
		}
	}
	switch key {
	case "esc":
		switch {
		case m.historyTab():
			m.focus = focusHistoryFiles
		case m.stashShowing():
			m.focus = focusStashFiles
		default:
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
		switch {
		case m.historyTab():
			return m, m.em.Emit(protocol.Intent{Name: "mission:history-file", Payload: mustPayload(historyFilePayload{Path: m.model.Diff.Path, ShowOversized: true})})
		case m.stashShowing():
			return m, m.em.Emit(protocol.Intent{Name: "mission:stash-select", Payload: mustPayload(stashSelectPayload{Path: m.model.Diff.Path, ShowOversized: true})})
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
		// A commit or stash with no files shows only the file column's empty
		// state, as GHD suppresses the second one.
		if m.historyTab() || m.stashShowing() {
			files := m.model.History.Files
			if !m.historyTab() {
				files = m.model.Stash.Files
			}
			msg := ""
			if len(files) > 0 {
				msg = "No file selected"
			}
			return centeredMessage(width, height, theme.Faint, clip(msg, width))
		}
		// ChangedTotal, not len(Changes): Changes is the FILTERED list
		// (lib/mission/model.ts computes changedTotal from allChanges before
		// the filter narrows it), so a filter matching nothing on a dirty
		// worktree must not read as a clean one.
		if m.model.ChangedTotal == 0 {
			return renderEmptyStateCard(width, height, m.model.Stash != nil)
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
// subline, and the four keys that get a repo out of that state, plus GHD's
// view-stash action (no-changes.tsx renderViewStashAction) when there is a
// stash.
func renderEmptyStateCard(width, height int, hasStash bool) string {
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
	if hasStash {
		lines = append(lines, hint("h", "view your stashed changes"))
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

// renderDiffLines paints the visible screen-row window of the wrapped diff
// (diffRows) -- a stage-bar/number gutter and chroma-highlighted (or flat)
// text per line -- plus a 1-cell Panel scroll thumb along the right edge.
// diffTop is a screen-row offset, so the window can open partway into a
// wrapped line.
func (m *Mission) renderDiffLines(width, height int) string {
	lines := m.model.Diff.Lines
	contentW := max(width-1, 0) // 1 cell reserved for the scroll thumb
	ix := m.diffRows(max(contentW-diffGutterWidth-diffMarkWidth, 0))
	total := ix.total()
	cursorRow, extra := 0, 0
	if len(lines) > 0 {
		c := min(max(m.diffCursor, 0), len(lines)-1)
		cursorRow = ix.start[c]
		extra = ix.start[c+1] - cursorRow - 1
	}
	// The viewport sees the cursor line's extra rows collapsed into its
	// first, over a pane shrunk by the same amount: the whole line then
	// stays in view with scrolloff around it, and a line taller than the
	// pane (a one-row virtual pane) keeps its first row on top. Rows above
	// the cursor line are the same in both spaces, which is all top can be.
	virtualH := max(height-extra, 1)
	top, _ := picker.Viewport(cursorRow, m.diffTop, total-extra, virtualH, virtualH, 0)
	m.diffTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, min(height, total), total)
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	restOn := lipgloss.NewStyle().Background(theme.Bg)
	hl := m.diffHL.forDiff(m.model.Diff)

	rows := make([]string, 0, height)
	first := ix.lineAt(top)
	for li := first; li < len(lines) && len(rows) < height; li++ {
		spans := diffLineSpans(m.model.Diff.Lang, hl, li, lines[li])
		hover := li == m.hoverDiffLine
		painted := renderDiffRows(m.model.Diff, lines[li], spans, contentW, hover, hover && m.hoverGutter)
		if li == first {
			painted = painted[min(top-ix.start[li], len(painted)):]
		}
		rows = append(rows, painted[:min(len(painted), height-len(rows))]...)
	}
	blank := lipgloss.NewStyle().Width(contentW).Background(theme.Bg).Render("")
	for len(rows) < height {
		rows = append(rows, blank)
	}
	for i := range rows {
		rows[i] += picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
	}
	return strings.Join(rows, "\n")
}

// diffMarkWidth is the mark column's fixed cell width: a gap, the +/- mark
// itself, and a trailing gap before the text.
const diffMarkWidth = 3

// diffRowBgs picks the gutter and row fills for a line's Kind: a hovered row
// wins over its own add/del tint for both halves (GHD keeps hover legible
// rather than layering the two), an add/del line gets its own tint pair, and
// everything else (context) stays on plain Bg.
func diffRowBgs(kind string, hover bool) (gutter, row color.Color) {
	switch {
	case hover:
		return theme.HoverBg, theme.HoverBg
	case kind == "add":
		return theme.DiffAddGutterBg, theme.DiffAddBg
	case kind == "del":
		return theme.DiffDelGutterBg, theme.DiffDelBg
	}
	return theme.Bg, theme.Bg
}

func lineMark(kind string) (string, color.Color, color.Color) {
	switch kind {
	case "add":
		return "+", theme.Mint, theme.Text
	case "del":
		return "-", theme.Coral, theme.Text
	}
	return " ", theme.TextSoft, theme.TextSoft
}

// lineSpans tokenizes one diff line's text; a lexer that swallows it
// entirely (an empty first line back) falls back to one flat span rather
// than losing the text.
func lineSpans(lang string, line DiffLine) []span {
	var spans []span
	if lines := tokenizeLines(lang, line.Text+"\n"); len(lines) > 0 {
		spans = lines[0]
	}
	return spansOrFlat(spans, line)
}

// diffLineSpans is the one place the renderer picks a line's spans: the
// whole-file highlight when there is one, else the line tokenized alone.
func diffLineSpans(lang string, hl [][]span, i int, line DiffLine) []span {
	if hl != nil && hl[i] != nil {
		return spansOrFlat(hl[i], line)
	}
	return lineSpans(lang, line)
}

// spansOrFlat keeps highlighted spans only when they carry exactly the
// line's text (a CRLF ending aside). chroma turns a lone \r into a line
// break, so a line holding one tokenizes to less than its text, and
// diffRows, which counts rows from that text, would disagree with the
// rows painted.
func spansOrFlat(spans []span, line DiffLine) []span {
	text := strings.TrimSuffix(line.Text, "\r")
	if spansText(spans) != text {
		return []span{{text: text}}
	}
	return spans
}

// renderDiffLine paints one line's gutter, mark and text and joins its rows
// back into a single string; renderDiffLines calls renderDiffRows directly
// so it can start partway into a wrapped line.
func renderDiffLine(d DiffModel, line DiffLine, width int, hover, gutterHover bool) string {
	return strings.Join(renderDiffRows(d, line, lineSpans(d.Lang, line), width, hover, gutterHover), "\n")
}

// renderDiffRows paints one line's gutter (stage bar + right-aligned
// old/new numbers) and its mark/text, or the full-width hunk bar when Kind
// is "hunk" -- the "@@ ... @@" text IS the hunk toggle, so it gets no
// gutter columns of its own. hover paints both gutter and row on HoverBg
// while keeping spans' own syntax colours (each span ends in an SGR reset,
// so paintSpans must set the background on every span). gutterHover
// additionally previews the stage bar in GutterHoverBar on an unselected
// add/del line -- a selected line keeps its
// solid Pink bar regardless, since there is nothing left to preview. A
// read-only line has nothing to stage, so it paints no bar at all. A long
// line wraps onto continuation rows (wrapSpans) whose count must match
// diffRows' index for the same line, or diffHit maps clicks off by rows.
func renderDiffRows(d DiffModel, line DiffLine, spans []span, width int, hover, gutterHover bool) []string {
	if width < 1 {
		return []string{""}
	}
	if line.Kind == "hunk" {
		bg := theme.Surface
		if hover {
			bg = theme.HoverBg
		}
		// Clipped to one row: a wrapped header would desync diffHit.
		return []string{lipgloss.NewStyle().Width(width).Background(bg).Foreground(theme.Lav).Render(clip(" "+line.Text, width))}
	}
	gutterBg, rowBg := diffRowBgs(line.Kind, hover)
	gOn := lipgloss.NewStyle().Background(gutterBg)
	on := lipgloss.NewStyle().Background(rowBg)

	bar, barStyle := " ", gOn
	switch {
	case d.ReadOnly:
	case line.Selected:
		bar, barStyle = theme.GlyphBar, barStyle.Foreground(theme.Pink)
	case gutterHover:
		bar, barStyle = theme.GlyphBar, barStyle.Foreground(theme.GutterHoverBar)
	}
	gutter := barStyle.Render(bar) + numCell(gOn, line.OldNo) + numCell(gOn, line.NewNo)

	mark, markCol, base := lineMark(line.Kind)
	markCell := on.Render(" ") + on.Foreground(markCol).Render(mark) + on.Render(" ")
	textW := max(width-diffGutterWidth-diffMarkWidth, 0)
	wrapped := wrapSpans(spans, textW)
	// The stage bar (selected or previewed) carries down every row so the
	// whole wrapped line reads as one click target.
	blankGutter := barStyle.Render(bar) + gOn.Render(strings.Repeat(" ", diffNumWidth*2))
	blankMark := on.Render(strings.Repeat(" ", diffMarkWidth))
	out := make([]string, len(wrapped))
	for r, row := range wrapped {
		g, mk := gutter, markCell
		if r > 0 {
			g, mk = blankGutter, blankMark
		}
		text := clipOn(paintSpans(row, base, rowBg), textW, on)
		out[r] = on.Width(width).Render(clipOn(g+mk+text, width, on))
	}
	return out
}

func numCell(bg lipgloss.Style, n int) string {
	s := ""
	if n > 0 {
		s = fmt.Sprintf("%d", n)
	}
	return bg.Foreground(theme.Faint).Width(diffNumWidth).Align(lipgloss.Right).Render(s)
}
