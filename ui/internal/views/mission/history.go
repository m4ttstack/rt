// History tab: the commit list sidebar, the selected commit's header and
// file column, and their key/mouse routing. Parity reference: GitHub
// Desktop's app/src/ui/history (commit-list-item, expandable-commit-summary,
// selected-commits, committed-file-item). The read-only diff is diff.go's.
package mission

import (
	"fmt"
	"image/color"
	"slices"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

// emptyCommitSummary stands in for a commit with no message wherever one is
// named: its list row, its header, and its menu's title.
const emptyCommitSummary = "Empty commit message"

const (
	// tabs(3, pad+label+underline) + the tabs-gap blank band row(1), then the
	// filter box(3) from historyFilterTopRow.
	historyFilterTopRow = 4
	historyFixedTopRows = 7
	historyFilesMin     = 24
	historyFilesMax     = 40
	historyFilesNarrow  = 12
	historyDiffMin      = 30
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

// historyMoreInFlight: historyMoreFor records the list length a request went
// out for, so the action row stays inert until the page lands and grows the
// list (or SetModel re-arms it). It is inert during the first load too.
func (m *Mission) historyMoreInFlight() bool {
	h := m.model.History
	return h.Loading || m.historyMoreFor == len(h.Commits)
}

// requestMore is the action row's one intent, and the only path that emits
// mission:history-more.
func (m *Mission) requestMore() tea.Cmd {
	h := m.model.History
	if !h.HasMore || len(h.Commits) == 0 || m.historyMoreInFlight() {
		return nil
	}
	m.historyMoreFor = len(h.Commits)
	return m.em.Emit(protocol.Intent{Name: "mission:history-more"})
}

// historyOnMoreRow is whether the action row holds the cursor: after a move
// onto it, or whenever a filter leaves no commit to hold it.
func (m *Mission) historyOnMoreRow() bool {
	return m.model.History.HasMore && (m.historyOnMore || len(m.historyVisible()) == 0)
}

func (m *Mission) historyMoreLabel() string {
	switch {
	case m.historyMoreInFlight():
		return "Loading…"
	case m.historyFilter != "":
		return "Search 100 more commits"
	}
	return "Load 100 more commits"
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

// historyMove steps the cursor through the visible commits and, below the
// last one, onto the action row. Landing on the action row selects nothing;
// a shift move never extends onto it, and shift+down on it goes nowhere.
func (m *Mission) historyMove(delta int, extend bool) tea.Cmd {
	commits := m.model.History.Commits
	visible := m.historyVisible()
	if len(visible) == 0 {
		return nil
	}
	m.historyFreeScroll = false
	if extend && delta > 0 && m.historyOnMoreRow() {
		return nil
	}
	pos := len(visible)
	if !m.historyOnMoreRow() {
		pos = slices.Index(visible, m.historyIndex(m.historyCursor))
	}
	last := len(visible) - 1
	if m.model.History.HasMore && !extend {
		last++
	}
	target := max(0, min(last, pos+delta))
	if target == len(visible) {
		m.historyOnMore = true
		return nil
	}
	m.historyOnMore = false
	before := m.historySelectionKey()
	if extend {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	m.historyCursor = commits[visible[target]].Sha
	// A move clamped at either end changes nothing, so it leaves any pending
	// tick to settle as it was.
	if m.historySelectionKey() == before {
		return nil
	}
	return m.historySelectTick()
}

// historySelectTick schedules the debounced mission:history-select; a later
// tick supersedes it.
func (m *Mission) historySelectTick() tea.Cmd {
	m.historyGen++
	gen := m.historyGen
	return selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return historyDebounceMsg{generation: gen, kind: historyDebounceCommit}
	})
}

// historyFilterKey edits the History filter live: every keystroke refilters
// the loaded commits. Enter keeps the filter, esc clears it; both return
// focus to the list.
func (m *Mission) historyFilterKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "enter":
		m.focus = focusList
		return m, nil
	case "esc":
		m.focus = focusList
		if m.historyFilter == "" {
			return m, nil
		}
		m.historyFilter = ""
	case "backspace":
		r := []rune(m.historyFilter)
		if len(r) == 0 {
			return m, nil
		}
		m.historyFilter = string(r[:len(r)-1])
	default:
		if v.Text == "" {
			return m, nil
		}
		m.historyFilter += v.Text
	}
	return m, m.historyFilterEdited()
}

// historyFilterEdited returns the view to following the cursor and re-homes
// a cursor the edit hid.
func (m *Mission) historyFilterEdited() tea.Cmd {
	m.historyFreeScroll = false
	return m.historyReHome()
}

// historyReHome moves a cursor the filter hides to the first match through
// the ordinary debounce, so fast typing settles into one select. A push can
// hide it too: a Search page landing matches, or a reload adopting a
// selection the filter excludes.
func (m *Mission) historyReHome() tea.Cmd {
	visible := m.historyVisible()
	if len(visible) == 0 || slices.Contains(visible, m.historyIndex(m.historyCursor)) {
		return nil
	}
	before := m.historySelectionKey()
	m.historyCursor, m.historyAnchor, m.historyOnMore = m.model.History.Commits[visible[0]].Sha, "", false
	if m.historySelectionKey() == before {
		return nil
	}
	return m.historySelectTick()
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
	case "ctrl+k":
		m.openMenu(m.focusedTarget(), nil)
		return m, nil
	case "enter":
		if m.historyOnMoreRow() {
			return m, m.requestMore()
		}
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
	case "/":
		m.focus = focusFilter
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
// strip, the tabs-gap band, the filter box, then the commit list to the
// bottom. No commit box or undo strip: GHD's History sidebar has neither.
func (m *Mission) renderHistorySidebar(width, height int) string {
	listH := max(height-historyFixedTopRows, 0)
	return lipgloss.JoinVertical(lipgloss.Left,
		renderTabsRow(m.model.ChangedTotal, "history", m.hoverTab, width),
		blankRows(width, 1),
		renderFilterRow(m.historyFilter, "Filter history", m.focus == focusFilter, m.hoverFilterRow, width),
		m.renderCommitList(width, listH),
	)
}

type historyLineKind int

const (
	historyLineHeader historyLineKind = iota
	historyLineSummary
	historyLineByline
	historyLineRule
	historyLineMore
	historyLineNotice
	historyLineBlank
)

// historyLine is one painted row of the commit list: a date header (label),
// one of a commit's three rows (idx is its model index), the action row, or
// the "No matching commits" notice and the blank rows around it.
type historyLine struct {
	kind  historyLineKind
	idx   int
	label string
}

// historyMatchCache holds historyVisible for one filter over one pushed
// commit slice. Every push decodes a fresh slice, so a slice with the same
// first-element address and length is the same list.
type historyMatchCache struct {
	filter  string
	commits []HistoryCommitRow
	idx     []int
}

func (c historyMatchCache) holds(filter string, commits []HistoryCommitRow) bool {
	return c.filter == filter && len(c.commits) == len(commits) && (len(commits) == 0 || &c.commits[0] == &commits[0])
}

// historyVisible is the model indices the list shows, in list order: every
// commit, or the History filter's fzf matches over summary, byline, and
// both shas, kept in history order rather than score order.
func (m *Mission) historyVisible() []int {
	commits := m.model.History.Commits
	if m.historyMatches.holds(m.historyFilter, commits) {
		return m.historyMatches.idx
	}
	targets := make([]string, len(commits))
	for i, c := range commits {
		targets[i] = c.Summary + " " + c.Byline + " " + c.ShortSha + " " + c.Sha
	}
	matches := picker.Rank(m.historyFilter, targets, false)
	idx := make([]int, len(matches))
	for i, mt := range matches {
		idx[i] = mt.Index
	}
	slices.Sort(idx)
	m.historyMatches = historyMatchCache{filter: m.historyFilter, commits: commits, idx: idx}
	return idx
}

// historyLines is the commit list top to bottom for a height-row list, one
// entry per painted row: a header opens each run of equal Group, then every
// commit's summary, byline, and rule, then the action row while there is
// more to load. A filter that matches nothing centers its notice (and the
// action row) in the list instead.
func (m *Mission) historyLines(height int) []historyLine {
	commits := m.model.History.Commits
	visible := m.historyVisible()
	var lines []historyLine
	if len(visible) == 0 && len(commits) > 0 {
		block := []historyLine{{kind: historyLineNotice}}
		if m.model.History.HasMore {
			block = append(block, historyLine{kind: historyLineBlank}, historyLine{kind: historyLineMore})
		}
		for range max((height-len(block))/2, 0) {
			lines = append(lines, historyLine{kind: historyLineBlank})
		}
		return append(lines, block...)
	}
	for i, idx := range visible {
		c := commits[idx]
		if c.Group != "" && (i == 0 || commits[visible[i-1]].Group != c.Group) {
			lines = append(lines, historyLine{kind: historyLineHeader, label: c.Group})
		}
		lines = append(lines,
			historyLine{kind: historyLineSummary, idx: idx},
			historyLine{kind: historyLineByline, idx: idx},
			historyLine{kind: historyLineRule, idx: idx})
	}
	if m.model.History.HasMore {
		lines = append(lines, historyLine{kind: historyLineMore})
	}
	return lines
}

// historyCursorLine is the line the viewport keeps in view: the action row
// when it holds the cursor, else the cursor commit's summary; scrolloff then
// keeps its byline and rule on screen too.
func (m *Mission) historyCursorLine(lines []historyLine) int {
	cursor := m.historyIndex(m.historyCursor)
	onMore := m.historyOnMoreRow()
	for i, l := range lines {
		if onMore && l.kind == historyLineMore || !onMore && l.kind == historyLineSummary && l.idx == cursor {
			return i
		}
	}
	return 0
}

// historyCursorMargins is the lines the viewport keeps above and below the
// cursor line so two whole commits of context show on each side: up to the
// summary of the second visible commit above, and down to the rule of the
// second visible commit below the cursor's own block, headers between
// included. Where fewer commits remain, the margin runs to the list's edge.
func historyCursorMargins(lines []historyLine, cursor int) (before, after int) {
	before, after = cursor, len(lines)-1-cursor
	for i, summaries := cursor-1, 0; i >= 0; i-- {
		if lines[i].kind == historyLineSummary {
			if summaries++; summaries == 2 {
				before = cursor - i
				break
			}
		}
	}
	for i, rules := cursor+1, 0; i < len(lines); i++ {
		if lines[i].kind == historyLineRule {
			if rules++; rules == 3 {
				after = i - cursor
				break
			}
		}
	}
	return before, after
}

// historyWindow is the part of historyLines a height-row list paints, from
// line top for vis rows. renderCommitList and historySidebarHit both take
// their rows from here, so a hit always names the row the frame painted.
func (m *Mission) historyWindow(height int) (lines []historyLine, top, vis int) {
	lines = m.historyLines(height)
	if m.historyFreeScroll {
		vis = max(min(len(lines), height), 0)
		top = max(0, min(m.historyTop, len(lines)-vis))
	} else {
		cursor := m.historyCursorLine(lines)
		before, after := historyCursorMargins(lines, cursor)
		top, vis = picker.ViewportAround(cursor, m.historyTop, len(lines), height, height, 0, before, after)
	}
	m.historyTop = top
	return lines, top, vis
}

// historyScroll is the wheel over the commit list: it moves the view by
// delta lines from where it is painted and leaves the cursor alone.
func (m *Mission) historyScroll(delta int) {
	lines, top, vis := m.historyWindow(m.layout().listRegionH)
	m.historyFreeScroll = true
	m.historyTop = max(0, min(top+delta, len(lines)-vis))
}

func (m *Mission) renderCommitList(width, height int) string {
	commits := m.model.History.Commits
	rowWidth := max(width-1, 0)
	on := lipgloss.NewStyle().Background(theme.Bg)
	blank := on.Width(rowWidth).Render("")
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	out := make([]string, height)
	if len(commits) == 0 {
		for i := range out {
			out[i] = blank + on.Render(" ")
		}
		if height > 0 && m.model.History.Loading {
			out[0] = on.Width(rowWidth).Foreground(theme.Faint).Render(clip("  Loading history…", rowWidth)) + on.Render(" ")
		}
		return strings.Join(out, "\n")
	}
	lines, top, vis := m.historyWindow(height)
	thumbTop, thumbH := picker.ThumbSpan(top, vis, len(lines))
	if len(m.historyVisible()) == 0 {
		thumbTop, thumbH = 0, 0
	}
	onMore := m.historyOnMoreRow()
	rowIdx := -1
	var rows [3]string
	for i := range out {
		row := blank
		if i < vis {
			switch l := lines[top+i]; l.kind {
			case historyLineHeader:
				row = renderHistoryGroupHeader(l.label, rowWidth)
			case historyLineMore:
				row = renderHistoryMoreRow(m.historyMoreLabel(), rowWidth, onMore, m.hoverHistoryMore, m.historyMoreInFlight())
			case historyLineNotice:
				row = on.Width(rowWidth).Align(lipgloss.Center).Foreground(theme.Faint).Render(clip("No matching commits", rowWidth))
			case historyLineSummary, historyLineByline, historyLineRule:
				if l.idx != rowIdx {
					c := commits[l.idx]
					cursor := c.Sha == m.historyCursor && !onMore
					rows[0], rows[1], rows[2] = renderCommitRow(c, rowWidth, cursor, m.historyInSelection(l.idx), l.idx == m.hoverCommit)
					rowIdx = l.idx
				}
				row = rows[l.kind-historyLineSummary]
			}
		}
		out[i] = row + picker.ThumbCell(i, thumbTop, thumbH, thumbOn, on)
	}
	return strings.Join(out, "\n")
}

// renderHistoryGroupHeader is a date header row, exactly width cells.
func renderHistoryGroupHeader(label string, width int) string {
	return lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Dim).Bold(true).Width(width).Render(clip("  "+label, width))
}

// renderHistoryMoreRow is the action row closing a list with more to load,
// exactly width cells: Lav like the foldouts' action rows, with a commit
// row's cursor and hover treatments; Faint, and never hovered, while its
// page is in flight.
func renderHistoryMoreRow(label string, width int, cursor, hover, inert bool) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	switch {
	case cursor:
		on = on.Background(theme.SelBg)
	case hover && !inert:
		on = on.Background(theme.HoverBg)
	}
	prefix := on.Render("  ")
	if cursor {
		prefix = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
	}
	col := theme.Lav
	if inert {
		col = theme.Faint
	}
	textW := max(width-2, 0)
	return on.Width(width).Render(clipOn(prefix+on.Foreground(col).Width(textW).Render(clip(label, textW)), width, on))
}

// renderCommitRow is GHD's commit-list-item as three terminal rows: the
// bold summary with its tag/unpushed indicators flush right, the byline ·
// time, and the separator rule. Every row is exactly width cells: anything
// wider would wrap into a second terminal row and break the one painted row
// per historyLine that historySidebarHit maps. The rule stays on Bg so a
// selection band never merges two commits into one block.
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
		summary = emptyCommitSummary
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

// historySidebarHit walks renderHistorySidebar's row sequence in lockstep;
// the list's rows come from historyWindow, the same lines the render took.
// Headers and separator rules never hover or click.
func (m *Mission) historySidebarHit(x, y, listRegionH int) hit {
	switch {
	case y < 3:
		if x < sidebarWidth/2 {
			return hit{kind: hitTab, idx: 0}
		}
		return hit{}
	case y < historyFilterTopRow:
		return hit{}
	case y < historyFixedTopRows:
		return hit{kind: hitFilterRow}
	}
	row := y - historyFixedTopRows
	if row >= listRegionH || len(m.model.History.Commits) == 0 {
		return hit{}
	}
	lines, top, vis := m.historyWindow(listRegionH)
	if row >= vis {
		return hit{}
	}
	switch l := lines[top+row]; l.kind {
	case historyLineSummary, historyLineByline:
		return hit{kind: hitCommitRow, idx: l.idx}
	case historyLineMore:
		if !m.historyMoreInFlight() {
			return hit{kind: hitHistoryMore}
		}
	}
	return hit{}
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
	m.historyFreeScroll, m.historyOnMore = false, false
	// A pending tick left in flight settles against the same shown selection
	// and finds nothing to emit either.
	if m.historySelectionKey() == m.historyShown {
		return m, nil
	}
	return m, m.emitHistorySelect()
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
		summary, summaryCol = emptyCommitSummary, theme.Faint
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

// committedPane is History.png's right pane: a header, a rule, then a file
// column beside the read-only diff. History and the stash view both paint
// through it, and committedPaneHit reads the same geometry.
type committedPane struct {
	header  []string
	files   []HistoryFileRow
	cursor  string
	top     *int
	hover   int
	focused bool
}

type paneRegion int

const (
	paneNone paneRegion = iota
	paneHeader
	paneFile
	paneDiff
)

type paneHit struct {
	region paneRegion
	row    int
	idx    int
	diff   hit
}

func (m *Mission) renderCommittedPane(p committedPane, width, height int) string {
	filesW := historyFilesWidth(width)
	diffW := max(width-filesW-1, 0)
	bodyH := max(height-len(p.header)-1, 0)
	ruleOn := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule)
	rows := append(append([]string{}, p.header...), ruleOn.Render(strings.Repeat("─", filesW)+"┬"+strings.Repeat("─", diffW)))
	if bodyH > 0 {
		divider := strings.TrimSuffix(strings.Repeat(ruleOn.Render("│")+"\n", bodyH), "\n")
		rows = append(rows, lipgloss.JoinHorizontal(lipgloss.Top, m.renderCommittedFiles(p, filesW, bodyH), divider, m.renderDiffPane(diffW, bodyH)))
	}
	return strings.Join(rows, "\n")
}

// renderCommittedFiles is GHD's file-list-header ("N changed files") over the
// committed-file-item rows, status letter trailing like the Changes rows.
func (m *Mission) renderCommittedFiles(p committedPane, width, height int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	noun := "files"
	if len(p.files) == 1 {
		noun = "file"
	}
	lines := []string{on.Width(width).Foreground(theme.Dim).Render(clip(fmt.Sprintf(" %d changed %s", len(p.files), noun), width))}
	cursorIdx := slices.IndexFunc(p.files, func(f HistoryFileRow) bool { return f.Path == p.cursor })
	listH := height - 1
	rowW := max(width-1, 0)
	top, vis := picker.Viewport(max(cursorIdx, 0), *p.top, len(p.files), listH, listH, 0)
	*p.top = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, len(p.files))
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	for i := 0; i < listH; i++ {
		idx := top + i
		line := on.Width(rowW).Render("")
		if i < vis && idx < len(p.files) {
			line = renderHistoryFileRow(p.files[idx], rowW, idx == cursorIdx, idx == p.hover, p.focused)
		}
		lines = append(lines, line+picker.ThumbCell(i, thumbTop, thumbH, thumbOn, on))
	}
	return strings.Join(lines, "\n")
}

// committedPaneHit walks renderCommittedPane's rows in lockstep: the header,
// the rule, then the file column (its count row first), the divider, and
// the diff pane.
func (m *Mission) committedPaneHit(p committedPane, x, y, paneW int) paneHit {
	headerH := len(p.header)
	filesW := historyFilesWidth(paneW)
	switch {
	case y < headerH:
		return paneHit{region: paneHeader, row: y}
	case y == headerH:
		return paneHit{}
	}
	bodyY := y - headerH - 1
	switch {
	case x < filesW:
		if bodyY == 0 {
			return paneHit{}
		}
		if idx := *p.top + bodyY - 1; idx < len(p.files) {
			return paneHit{region: paneFile, idx: idx}
		}
		return paneHit{}
	case x == filesW:
		return paneHit{}
	}
	return paneHit{region: paneDiff, diff: m.diffHit(x-filesW-1, bodyY, max(paneW-filesW-1, 0))}
}

// committedPaneWheel scrolls the file column or the diff under the pointer;
// the header, the rule, and the divider scroll nothing.
func (m *Mission) committedPaneWheel(p committedPane, x, y, paneW, delta int, moveFile func(int) tea.Cmd) tea.Cmd {
	filesW := historyFilesWidth(paneW)
	switch {
	case x < 0 || y <= len(p.header) || x == filesW:
		return nil
	case x < filesW:
		return moveFile(delta)
	}
	m.moveDiffCursor(delta)
	return nil
}

func (m *Mission) historyPane(width, height int) committedPane {
	return committedPane{
		header: m.historyHeader(width, height), files: m.model.History.Files, cursor: m.historyFile,
		top: &m.historyFilesTop, hover: m.hoverHistoryFile, focused: m.focus == focusHistoryFiles,
	}
}

func (m *Mission) renderHistoryPane(width, height int) string {
	if slate := m.historySlate(); slate != "" {
		return centeredMessage(width, height, theme.Faint, slate)
	}
	return m.renderCommittedPane(m.historyPane(width, height), width, height)
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

// historyPaneHit reads the committed pane at the frame's pane size; the
// header's title row is the expander.
func (m *Mission) historyPaneHit(x, y int) hit {
	if m.historySlate() != "" {
		return hit{}
	}
	paneW := m.diffWidth()
	switch h := m.committedPaneHit(m.historyPane(paneW, m.layout().bodyH), x, y, paneW); h.region {
	case paneHeader:
		if h.row == 0 && m.model.History.Header.RangeCount <= 1 {
			return hit{kind: hitHistoryExpander}
		}
	case paneFile:
		return hit{kind: hitHistoryFile, idx: h.idx}
	case paneDiff:
		return h.diff
	}
	return hit{}
}

func (m *Mission) historyWheel(x, y, delta int) tea.Cmd {
	if m.historySlate() != "" {
		return nil
	}
	paneW := m.diffWidth()
	return m.committedPaneWheel(m.historyPane(paneW, m.layout().bodyH), x, y, paneW, delta, m.historyFileMove)
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
	case "ctrl+k":
		m.openMenu(m.focusedTarget(), nil)
		return m, nil
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
