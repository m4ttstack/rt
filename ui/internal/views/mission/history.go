// History tab: the commit list sidebar, the selected commit's header and
// file column, and their key/mouse routing. Parity reference: GitHub
// Desktop's app/src/ui/history (commit-list-item, expandable-commit-summary,
// selected-commits, committed-file-item). The read-only diff is diff.go's.
package mission

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

const (
	// tabs(3, pad+label+underline) + the tabs-gap blank band row(1).
	historyFixedTopRows = 4
	// summary, byline, then the separator rule (GHD's row border).
	historyRowHeight = 3
	// Rows from the end at which the next page is requested.
	historyPageThreshold = 10
	historyFilesMin      = 24
	historyFilesMax      = 40
	historyFilesNarrow   = 12
	historyDiffMin       = 30
)

type historyDebounceKind int

const (
	historyDebounceCommit historyDebounceKind = iota
	historyDebounceFile
)

type historyDebounceMsg struct {
	generation int
	kind       historyDebounceKind
}

type tabPayload struct {
	Tab string `json:"tab"`
}

type historySelectPayload struct {
	Shas []string `json:"shas"`
}

type historyFilePayload struct {
	Path          string `json:"path"`
	ShowOversized bool   `json:"showOversized,omitempty"`
}

func (m *Mission) historyTab() bool { return m.model.Tab == "history" }

func (m *Mission) emitTab(tab string) tea.Cmd {
	if m.model.Tab == tab || (tab == "changes" && m.model.Tab == "") {
		return nil
	}
	m.focus = focusList
	return m.em.Emit(protocol.Intent{Name: "mission:tab", Payload: mustPayload(tabPayload{Tab: tab})})
}

func (m *Mission) historyIndex(sha string) int {
	for i, c := range m.model.History.Commits {
		if c.Sha == sha {
			return i
		}
	}
	return -1
}

// clampHistory runs on every SetModel: the view's cursor survives a push
// while its sha is still listed; once it falls off (a reload, a worktree
// switch) the cursor adopts the driver's own selection and drops any move
// still pending against the old list.
//
// The driver's selection and file are adopted only when they change from one
// push to the next: a push sent before the driver handled the view's last
// select still carries the old values and must not undo it. A new commit
// selection replaces the file list, so it also resets the file cursor to the
// driver's file; the driver's own file change leaves a pending file move
// alone.
func (m *Mission) clampHistory() {
	commits := m.model.History.Commits
	if len(commits) == 0 {
		m.historyCursor, m.historyAnchor = "", ""
	} else if m.historyIndex(m.historyCursor) < 0 {
		m.historyCursor = commits[0].Sha
		for _, c := range commits {
			if c.Selected {
				m.historyCursor = c.Sha
				break
			}
		}
		m.historyAnchor = ""
		m.historyGen++
	}
	if m.historyAnchor != "" && m.historyIndex(m.historyAnchor) < 0 {
		m.historyAnchor = ""
	}

	driverKey := m.driverSelectionKey()
	selectionChanged := driverKey != m.historyDriverKey
	if selectionChanged {
		m.historyDriverKey, m.historyShown = driverKey, driverKey
	}
	file := m.model.History.SelectedFile
	fileChanged := file != m.historyDriverFile
	m.historyDriverFile = file
	switch {
	case selectionChanged || m.historyFileIndex() < 0:
		m.historyFile, m.historyFileShown = file, file
		if m.historyFilePending {
			m.historyFilePending = false
			m.historyFileGen++
		}
	case fileChanged:
		m.historyFileShown = file
		if !m.historyFilePending {
			m.historyFile = file
		}
	}
}

// driverSelectionKey is the selection the driver reports through the rows'
// Selected flags, in list order.
func (m *Mission) driverSelectionKey() string {
	var shas []string
	for _, c := range m.model.History.Commits {
		if c.Selected {
			shas = append(shas, c.Sha)
		}
	}
	return strings.Join(shas, ",")
}

// historySelectionShas is the anchor..cursor span in list order (newest
// first), the payload mission:history-select carries.
func (m *Mission) historySelectionShas() []string {
	c := m.historyIndex(m.historyCursor)
	if c < 0 {
		return nil
	}
	a := m.historyIndex(m.historyAnchor)
	if a < 0 {
		a = c
	}
	lo, hi := min(a, c), max(a, c)
	shas := make([]string, 0, hi-lo+1)
	for i := lo; i <= hi; i++ {
		shas = append(shas, m.model.History.Commits[i].Sha)
	}
	return shas
}

func (m *Mission) historySelectionKey() string {
	return strings.Join(m.historySelectionShas(), ",")
}

func (m *Mission) historyInSelection(idx int) bool {
	c := m.historyIndex(m.historyCursor)
	if c < 0 {
		return false
	}
	a := m.historyIndex(m.historyAnchor)
	if a < 0 {
		a = c
	}
	return idx >= min(a, c) && idx <= max(a, c)
}

// emitHistorySelect settles both debounces: the driver answers a commit
// select with a new file list, so a pending file move belongs to the old one.
func (m *Mission) emitHistorySelect() tea.Cmd {
	m.historyGen++
	m.historyShown = m.historySelectionKey()
	m.historyFileGen++
	m.historyFilePending = false
	return m.em.Emit(protocol.Intent{Name: "mission:history-select", Payload: mustPayload(historySelectPayload{Shas: m.historySelectionShas()})})
}

// settleHistory answers a debounce tick. The driver's select resets its file
// cursor, so a tick emits only when the selection differs from the one the
// driver shows; a move away and back emits nothing.
func (m *Mission) settleHistory(v historyDebounceMsg) tea.Cmd {
	switch v.kind {
	case historyDebounceCommit:
		if v.generation != m.historyGen {
			return nil
		}
		if key := m.historySelectionKey(); key == "" || key == m.historyShown {
			return nil
		}
		return m.emitHistorySelect()
	case historyDebounceFile:
		if v.generation != m.historyFileGen {
			return nil
		}
		m.historyFilePending = false
		if m.historyFile == "" || m.historyFile == m.historyFileShown {
			return nil
		}
		return m.emitHistoryFile()
	}
	return nil
}

// maybeRequestMore asks for the next page once per page: historyMoreFor
// records the list length a request went out for, so every further move
// inside the threshold is silent until the page lands and grows the list.
func (m *Mission) maybeRequestMore() tea.Cmd {
	h := m.model.History
	n := len(h.Commits)
	if !h.HasMore || h.Loading || n == 0 || m.historyMoreFor == n {
		return nil
	}
	if m.historyIndex(m.historyCursor) < n-historyPageThreshold {
		return nil
	}
	m.historyMoreFor = n
	return m.em.Emit(protocol.Intent{Name: "mission:history-more"})
}

// historyReloaded reports whether a push replaced the commit list instead of
// appending a page to it. A page only grows the list under the same tip; a
// shorter list or a new first commit is a reload, and the driver drops any
// page that was in flight against the old list, so historyMoreFor must stop
// blocking a request at that length.
func historyReloaded(prev, next []HistoryCommitRow) bool {
	if len(next) < len(prev) {
		return true
	}
	return len(prev) > 0 && len(next) > 0 && prev[0].Sha != next[0].Sha
}

func (m *Mission) historyMove(delta int, extend bool) tea.Cmd {
	commits := m.model.History.Commits
	n := len(commits)
	if n == 0 {
		return nil
	}
	before := m.historySelectionKey()
	if extend {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	i := max(0, min(n-1, m.historyIndex(m.historyCursor)+delta))
	m.historyCursor = commits[i].Sha
	// A move clamped at either end changes nothing, so it leaves any pending
	// tick to settle as it was.
	if m.historySelectionKey() == before {
		return m.maybeRequestMore()
	}
	m.historyGen++
	gen := m.historyGen
	tick := selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return historyDebounceMsg{generation: gen, kind: historyDebounceCommit}
	})
	return tea.Batch(tick, m.maybeRequestMore())
}

func (m *Mission) historyListKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.historyMove(-1, false)
	case "down":
		return m, m.historyMove(1, false)
	case "shift+up":
		return m, m.historyMove(-1, true)
	case "shift+down":
		return m, m.historyMove(1, true)
	case "enter":
		if len(m.model.History.Files) > 0 {
			m.focus = focusHistoryFiles
		}
		return m, nil
	}
	return m.historyTabKey(v)
}

// historyTabKey is the History keybar's tab-wide keys, the same from the
// commit list and the file column.
func (m *Mission) historyTabKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "e":
		m.historyExpanded = !m.historyExpanded
	case "1":
		return m, m.emitTab("changes")
	case "f":
		return m, m.em.Emit(protocol.Intent{Name: "mission:action"})
	case "b":
		return m.openBranchModal()
	case "w":
		return m.openWorktreeModal()
	case "r":
		return m.openRepoModal()
	case "q":
		return m.quit()
	}
	return m, nil
}

// renderHistorySidebar is the History tab's sidebar (History.png): the tab
// strip, the tabs-gap band, then the commit list to the bottom. No filter,
// commit box, or undo strip: GHD's History sidebar has none of them.
func (m *Mission) renderHistorySidebar(width, height int) string {
	listH := max(height-historyFixedTopRows, 0)
	return lipgloss.JoinVertical(lipgloss.Left,
		renderTabsRow(m.model.ChangedTotal, "history", m.hoverTab, width),
		blankRows(width, 1),
		m.renderCommitList(width, listH),
	)
}

func (m *Mission) renderCommitList(width, height int) string {
	commits := m.model.History.Commits
	n := len(commits)
	rowWidth := max(width-1, 0)
	blank := lipgloss.NewStyle().Width(rowWidth).Background(theme.Bg).Render("")
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	restOn := lipgloss.NewStyle().Background(theme.Bg)
	if n == 0 {
		lines := make([]string, height)
		for i := range lines {
			lines[i] = blank + restOn.Render(" ")
		}
		if height > 0 && m.model.History.Loading {
			lines[0] = lipgloss.NewStyle().Width(rowWidth).Background(theme.Bg).Foreground(theme.Faint).Render(clip("  Loading history…", rowWidth)) + restOn.Render(" ")
		}
		return strings.Join(lines, "\n")
	}
	capRows := height / historyRowHeight
	cursorIdx := max(m.historyIndex(m.historyCursor), 0)
	top, vis := picker.Viewport(cursorIdx, m.historyTop, n, capRows, capRows, 0)
	m.historyTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, n)

	lines := make([]string, 0, height)
	for i := 0; i < capRows; i++ {
		idx := top + i
		a, b, c := blank, blank, blank
		if i < vis && idx < n {
			a, b, c = renderCommitRow(commits[idx], rowWidth, commits[idx].Sha == m.historyCursor, m.historyInSelection(idx), idx == m.hoverCommit)
		}
		cell := picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
		lines = append(lines, a+cell, b+cell, c+cell)
	}
	for len(lines) < height {
		lines = append(lines, blank+restOn.Render(" "))
	}
	return strings.Join(lines, "\n")
}

// renderCommitRow is GHD's commit-list-item as three terminal rows: the
// bold summary with its tag/unpushed indicators flush right, the byline ·
// time, and the separator rule. Every row is exactly width cells: anything
// wider would wrap and desync historySidebarHit's rows-per-commit
// arithmetic. The rule stays on Bg so a selection band never merges two
// commits into one block.
func renderCommitRow(c HistoryCommitRow, width int, cursor, selected, hover bool) (string, string, string) {
	on := lipgloss.NewStyle().Background(theme.Bg)
	switch {
	case selected || cursor:
		on = on.Background(theme.SelBg)
	case hover:
		on = on.Background(theme.HoverBg)
	}
	prefix := on.Render("  ")
	if cursor {
		prefix = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
	}
	prefixW := lipgloss.Width(prefix)

	var right string
	if len(c.Tags) > 0 {
		// The pill's own padding is 2 cells; the whole pill stays within a
		// third of the row so a long tag cannot starve the summary.
		right = pill(middleTruncate(c.Tags[0], max(width/3-2, 1)), theme.Lav)
		if len(c.Tags) > 1 {
			right += on.Render(" ") + on.Foreground(theme.Faint).Render("+")
		}
	}
	if c.Unpushed {
		if right != "" {
			right += on.Render(" ")
		}
		right += on.Foreground(theme.Cyan).Render("↑")
	}
	rightW := lipgloss.Width(right)
	gap := 0
	if rightW > 0 {
		gap = 1
	}
	summaryW := width - prefixW - gap - rightW - 1
	if summaryW < 1 {
		right, rightW, gap = "", 0, 0
		summaryW = max(width-prefixW-1, 0)
	}
	summaryStyle := on.Foreground(theme.Text).Bold(true)
	summary := c.Summary
	if summary == "" {
		summary = "Empty commit message"
		summaryStyle = on.Foreground(theme.Faint)
	}
	line1 := prefix + summaryStyle.Width(summaryW).Render(clip(summary, summaryW))
	if gap > 0 {
		line1 += on.Render(" ")
	}
	line1 += right + on.Render(" ")

	// The relative time is what a reader scans for, so a long byline (several
	// co-authors) gives up its own tail before the time loses a cell.
	metaW := max(width-2, 0)
	meta := clip(c.Byline, metaW)
	if c.When != "" {
		when := " · " + c.When
		if bylineW := metaW - lipgloss.Width(when); bylineW >= 4 {
			meta = clip(c.Byline, bylineW) + when
		} else {
			meta = clip(c.Byline+when, metaW)
		}
	}
	line2 := on.Render("  ") + on.Foreground(theme.Dimmer).Width(metaW).Render(meta)
	rule := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render(strings.Repeat("─", width))
	return line1, line2, rule
}

// historySidebarHit walks renderHistorySidebar's row sequence in lockstep.
func (m *Mission) historySidebarHit(x, y, listRegionH int) hit {
	if y < 3 {
		if x < sidebarWidth/2 {
			return hit{kind: hitTab, idx: 0}
		}
		return hit{}
	}
	if y < historyFixedTopRows {
		return hit{}
	}
	row := y - historyFixedTopRows
	if row >= listRegionH {
		return hit{}
	}
	idx := m.historyTop + row/historyRowHeight
	if row/historyRowHeight >= listRegionH/historyRowHeight || idx >= len(m.model.History.Commits) {
		return hit{}
	}
	if row%historyRowHeight == historyRowHeight-1 {
		return hit{} // the separator rule: never hovers, never clicks
	}
	return hit{kind: hitCommitRow, idx: idx}
}

func (m *Mission) clickCommitRow(idx int, shift bool) (tea.Model, tea.Cmd) {
	commits := m.model.History.Commits
	if idx < 0 || idx >= len(commits) {
		return m, nil
	}
	if shift {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	m.historyCursor = commits[idx].Sha
	m.focus = focusList
	// A pending tick left in flight settles against the same shown selection
	// and finds nothing to emit either.
	if m.historySelectionKey() == m.historyShown {
		return m, m.maybeRequestMore()
	}
	return m, tea.Batch(m.emitHistorySelect(), m.maybeRequestMore())
}

// historyFilesWidth is a third of the pane clamped to [24, 40]. Where that
// would leave the diff under historyDiffMin cells the column gives way down
// to historyFilesNarrow, and it never pushes the divider off the pane.
func historyFilesWidth(paneW int) int {
	w := max(historyFilesMin, min(historyFilesMax, paneW/3))
	if paneW-w-1 < historyDiffMin {
		w = max(paneW/3, historyFilesNarrow)
	}
	return min(w, max(paneW-1, 0))
}

// headerRow keeps one cell of right margin and is exactly width cells.
func headerRow(on lipgloss.Style, content string, width int) string {
	return on.Width(width).Render(clipOn(content, max(width-1, 0), on))
}

func headerTextRow(col color.Color, text string, width int) string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	return headerRow(on, on.Render(" ")+on.Foreground(col).Render(clip(text, max(width-2, 0))), width)
}

// historyHeaderLines is GHD's expandable-commit-summary as terminal rows,
// each exactly width cells. The title row is the expander, so hover fills
// it like any other click target.
func historyHeaderLines(h HistoryHeader, expanded, hover bool, width int) []string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	row := func(on lipgloss.Style, content string) string {
		return headerRow(on, content, width)
	}
	plain := func(col color.Color, text string) string {
		return headerTextRow(col, text, width)
	}

	if h.RangeCount > 1 {
		return []string{row(on, on.Render(" ")+on.Foreground(theme.Text).Bold(true).Render(clip(fmt.Sprintf("Showing changes from %d commits", h.RangeCount), max(width-2, 0))))}
	}

	title := on
	if hover {
		title = on.Background(theme.HoverBg)
	}
	glyph := "⌄"
	if expanded {
		glyph = "⌃"
	}
	summary, summaryCol := h.Summary, theme.Text
	if summary == "" {
		summary, summaryCol = "Empty commit message", theme.Faint
	}
	summaryW := max(width-4, 0)
	lines := []string{row(title, title.Render(" ")+title.Foreground(summaryCol).Bold(true).Width(summaryW).Render(clip(summary, summaryW))+title.Foreground(theme.Dimmer).Render(" "+glyph))}

	if h.Body != "" {
		body := strings.Split(h.Body, "\n")
		if !expanded && len(body) > 2 {
			body = body[:2]
		}
		for _, b := range body {
			lines = append(lines, plain(theme.TextSoft, b))
		}
	}

	sep := on.Foreground(theme.Faint).Render(" · ")
	var meta string
	if expanded {
		for _, a := range h.Authors {
			lines = append(lines, plain(theme.Dim, a))
		}
		meta = on.Foreground(theme.Dim).Render(h.Sha)
		if h.LinesAdded != 0 || h.LinesDeleted != 0 {
			meta += sep + on.Foreground(theme.Mint).Render(fmt.Sprintf("%d added lines", h.LinesAdded)) +
				sep + on.Foreground(theme.Coral).Render(fmt.Sprintf("%d removed lines", h.LinesDeleted))
		}
	} else {
		meta = on.Foreground(theme.Dim).Render(h.Byline) + sep + on.Foreground(theme.Dim).Render(h.ShortSha)
		if h.LinesAdded != 0 || h.LinesDeleted != 0 {
			meta += sep + on.Foreground(theme.Mint).Render(fmt.Sprintf("+%d", h.LinesAdded)) + on.Render(" ") + on.Foreground(theme.Coral).Render(fmt.Sprintf("−%d", h.LinesDeleted))
		}
	}
	if len(h.Tags) > 0 {
		meta += sep + on.Foreground(theme.Lav).Render(strings.Join(h.Tags, ", "))
	}
	return append(lines, row(on, on.Render(" ")+meta))
}

// historyHeader is the header as the pane paints it: an expanded
// description taller than half the pane keeps its title and meta line, and
// a marker counting the dropped rows stands in for the rows between, so the
// file column and diff stay on screen. historyPaneHit measures this same
// slice.
func (m *Mission) historyHeader(width, height int) []string {
	lines := historyHeaderLines(*m.model.History.Header, m.historyExpanded, m.hoverExpander, width)
	limit := max(height/2, 1)
	switch {
	case len(lines) <= limit:
		return lines
	case limit == 1:
		return lines[:1]
	case limit == 2:
		return []string{lines[0], moreLinesRow(len(lines)-1, width)}
	}
	kept := append(lines[:limit-2:limit-2], moreLinesRow(len(lines)-limit+1, width))
	return append(kept, lines[len(lines)-1])
}

func moreLinesRow(n, width int) string {
	noun := "lines"
	if n == 1 {
		noun = "line"
	}
	return headerTextRow(theme.Faint, fmt.Sprintf("… %d more %s", n, noun), width)
}

// historySlate is the single message the pane shows when there is nothing
// to split into header, files, and diff; "" means render the full pane.
func (m *Mission) historySlate() string {
	h := m.model.History
	switch {
	case len(h.Commits) == 0 && h.Loading:
		return "Loading history…"
	case len(h.Commits) == 0:
		return "No history"
	case h.Header == nil:
		return "No commit selected"
	case h.Header.RangeCount > 1 && !h.Header.Contiguous:
		return "Unable to display diff when multiple non-consecutive commits are selected."
	}
	return ""
}

// renderHistoryPane is History.png's right pane: the header, a rule, then
// the file column beside the read-only diff.
func (m *Mission) renderHistoryPane(width, height int) string {
	if slate := m.historySlate(); slate != "" {
		return centeredMessage(width, height, theme.Faint, slate)
	}
	header := m.historyHeader(width, height)
	filesW := historyFilesWidth(width)
	diffW := max(width-filesW-1, 0)
	bodyH := max(height-len(header)-1, 0)
	ruleOn := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule)
	rows := append(header, ruleOn.Render(strings.Repeat("─", filesW)+"┬"+strings.Repeat("─", diffW)))
	if bodyH > 0 {
		divider := strings.TrimSuffix(strings.Repeat(ruleOn.Render("│")+"\n", bodyH), "\n")
		rows = append(rows, lipgloss.JoinHorizontal(lipgloss.Top, m.renderHistoryFiles(filesW, bodyH), divider, m.renderDiffPane(diffW, bodyH)))
	}
	return strings.Join(rows, "\n")
}

// renderHistoryFiles is GHD's file-list-header ("N changed files") over the
// committed-file-item rows, status letter trailing like the Changes rows.
func (m *Mission) renderHistoryFiles(width, height int) string {
	files := m.model.History.Files
	on := lipgloss.NewStyle().Background(theme.Bg)
	noun := "files"
	if len(files) == 1 {
		noun = "file"
	}
	lines := []string{on.Width(width).Foreground(theme.Dim).Render(clip(fmt.Sprintf(" %d changed %s", len(files), noun), width))}

	listH := height - 1
	rowW := max(width-1, 0)
	top, vis := picker.Viewport(max(m.historyFileIndex(), 0), m.historyFilesTop, len(files), listH, listH, 0)
	m.historyFilesTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, len(files))
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	for i := 0; i < listH; i++ {
		idx := top + i
		line := on.Width(rowW).Render("")
		if i < vis && idx < len(files) {
			line = renderHistoryFileRow(files[idx], rowW, files[idx].Path == m.historyFile, idx == m.hoverHistoryFile, m.focus == focusHistoryFiles)
		}
		lines = append(lines, line+picker.ThumbCell(i, thumbTop, thumbH, thumbOn, on))
	}
	return strings.Join(lines, "\n")
}

// renderHistoryFileRow is one committed-file-item row, exactly width cells:
// the path clips in the middle so the filename survives.
func renderHistoryFileRow(f HistoryFileRow, width int, cursor, hover, focused bool) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	switch {
	case cursor:
		on = on.Background(theme.SelBg)
	case hover:
		on = on.Background(theme.HoverBg)
	}
	prefix := on.Render("  ")
	if cursor && focused {
		prefix = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
	}
	letter, col := statusGlyph(f.Status)
	pathW := max(width-2-1-lipgloss.Width(letter), 1)
	line := prefix + on.Foreground(theme.Text).Width(pathW).Render(middleTruncate(f.Path, pathW)) + on.Render(" ") + on.Foreground(col).Render(letter)
	return on.Width(width).Render(clipOn(line, width, on))
}

// historyPaneLayout is renderHistoryPane's geometry at the frame's pane
// size, shared by the hit test and the wheel.
func (m *Mission) historyPaneLayout() (headerH, filesW, paneW int) {
	paneW = m.diffWidth()
	return len(m.historyHeader(paneW, m.layout().bodyH)), historyFilesWidth(paneW), paneW
}

// historyPaneHit walks renderHistoryPane's rows in lockstep: the header
// (its title row is the expander), the rule, then the file column, the
// divider, and the diff pane.
func (m *Mission) historyPaneHit(x, y int) hit {
	if m.historySlate() != "" {
		return hit{}
	}
	headerH, filesW, paneW := m.historyPaneLayout()
	if y < headerH {
		if y == 0 && m.model.History.Header.RangeCount <= 1 {
			return hit{kind: hitHistoryExpander}
		}
		return hit{}
	}
	if y == headerH {
		return hit{}
	}
	bodyY := y - headerH - 1
	switch {
	case x < filesW:
		if bodyY == 0 {
			return hit{}
		}
		if idx := m.historyFilesTop + bodyY - 1; idx < len(m.model.History.Files) {
			return hit{kind: hitHistoryFile, idx: idx}
		}
		return hit{}
	case x == filesW:
		return hit{}
	default:
		return m.diffHit(x-filesW-1, bodyY, max(paneW-filesW-1, 0))
	}
}

// historyWheel scrolls the file column or the diff under the pointer; the
// header, the rule, and the divider scroll nothing.
func (m *Mission) historyWheel(x, y, delta int) tea.Cmd {
	if x < 0 || m.historySlate() != "" {
		return nil
	}
	headerH, filesW, _ := m.historyPaneLayout()
	switch {
	case y <= headerH || x == filesW:
		return nil
	case x < filesW:
		return m.historyFileMove(delta)
	}
	m.moveDiffCursor(delta)
	return nil
}

func (m *Mission) historyFileIndex() int {
	for i, f := range m.model.History.Files {
		if f.Path == m.historyFile {
			return i
		}
	}
	return -1
}

func (m *Mission) emitHistoryFile() tea.Cmd {
	m.historyFileGen++
	m.historyFilePending = false
	m.historyFileShown = m.historyFile
	return m.em.Emit(protocol.Intent{Name: "mission:history-file", Payload: mustPayload(historyFilePayload{Path: m.historyFile})})
}

func (m *Mission) historyFileMove(delta int) tea.Cmd {
	files := m.model.History.Files
	if len(files) == 0 {
		return nil
	}
	before := m.historyFile
	i := max(0, min(len(files)-1, m.historyFileIndex()+delta))
	m.historyFile = files[i].Path
	if m.historyFile == before {
		return nil
	}
	m.historyFilePending = true
	m.historyFileGen++
	gen := m.historyFileGen
	return selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return historyDebounceMsg{generation: gen, kind: historyDebounceFile}
	})
}

func (m *Mission) historyFilesKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.historyFileMove(-1)
	case "down":
		return m, m.historyFileMove(1)
	case "enter":
		m.focus = focusDiff
		return m, nil
	case "esc":
		m.focus = focusList
		return m, nil
	}
	return m.historyTabKey(v)
}

func (m *Mission) clickHistoryFile(idx int) (tea.Model, tea.Cmd) {
	files := m.model.History.Files
	if idx < 0 || idx >= len(files) {
		return m, nil
	}
	m.historyFile = files[idx].Path
	m.focus = focusHistoryFiles
	if m.historyFile == m.historyFileShown {
		return m, nil
	}
	return m, m.emitHistoryFile()
}
