// History tab: the commit list sidebar, the selected commit's header and
// file column, and their key/mouse routing. Parity reference: GitHub
// Desktop's app/src/ui/history (commit-list-item, expandable-commit-summary,
// selected-commits, committed-file-item). The read-only diff is diff.go's.
package mission

import (
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
	historyRowHeight    = 2
	// Rows from the end at which the next page is requested.
	historyPageThreshold = 10
	historyFilesMin      = 24
	historyFilesMax      = 40
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
// switch) the cursor adopts the driver's own selection.
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
	}
	if m.historyAnchor != "" && m.historyIndex(m.historyAnchor) < 0 {
		m.historyAnchor = ""
	}
	files := m.model.History.Files
	found := false
	for _, f := range files {
		if f.Path == m.historyFile {
			found = true
			break
		}
	}
	if !found {
		m.historyFile = m.model.History.SelectedFile
	}
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

func (m *Mission) emitHistorySelect() tea.Cmd {
	m.historyGen++
	return m.em.Emit(protocol.Intent{Name: "mission:history-select", Payload: mustPayload(historySelectPayload{Shas: m.historySelectionShas()})})
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
	if extend {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	i := max(0, min(n-1, m.historyIndex(m.historyCursor)+delta))
	m.historyCursor = commits[i].Sha
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
		a, b := blank, blank
		if i < vis && idx < n {
			a, b = renderCommitRow(commits[idx], rowWidth, commits[idx].Sha == m.historyCursor, m.historyInSelection(idx), idx == m.hoverCommit)
		}
		cell := picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
		lines = append(lines, a+cell, b+cell)
	}
	for len(lines) < height {
		lines = append(lines, blank+restOn.Render(" "))
	}
	return strings.Join(lines, "\n")
}

// renderCommitRow is GHD's commit-list-item as two terminal rows: the
// summary with its tag/unpushed indicators flush right, then byline · time.
// Both rows are exactly width cells: anything wider would wrap and desync
// historySidebarHit's two-rows-per-commit arithmetic.
func renderCommitRow(c HistoryCommitRow, width int, cursor, selected, hover bool) (string, string) {
	on := lipgloss.NewStyle().Background(theme.Bg)
	switch {
	case selected || cursor:
		on = on.Background(theme.SelBg)
	case hover:
		on = on.Background(theme.HoverBg)
	}
	prefix := "  "
	if cursor {
		prefix = theme.GlyphBar + " "
	}
	prefixStyled := on.Render("  ")
	if cursor {
		prefixStyled = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
	}

	var right string
	if len(c.Tags) > 0 {
		right = pill(c.Tags[0], theme.Lav)
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
	summaryW := width - lipgloss.Width(prefix) - gap - rightW - 1
	if summaryW < 1 {
		right, rightW, gap = "", 0, 0
		summaryW = max(width-lipgloss.Width(prefix)-1, 0)
	}
	summaryStyle := on.Foreground(theme.Text)
	summary := c.Summary
	if summary == "" {
		summary = "Empty commit message"
		summaryStyle = on.Foreground(theme.Faint)
	}
	line1 := prefixStyled + summaryStyle.Width(summaryW).Render(clip(summary, summaryW))
	if gap > 0 {
		line1 += on.Render(" ")
	}
	line1 += right + on.Render(" ")

	meta := c.Byline
	if c.When != "" {
		meta += " · " + c.When
	}
	metaW := max(width-2, 0)
	line2 := on.Render("  ") + on.Foreground(theme.Dim).Width(metaW).Render(clip(meta, metaW))
	return line1, line2
}

// historySidebarHit walks renderHistorySidebar's row sequence in lockstep.
func (m *Mission) historySidebarHit(x, y, listRegionH int) hit {
	if y < 2 {
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
	return m, tea.Batch(m.emitHistorySelect(), m.maybeRequestMore())
}
