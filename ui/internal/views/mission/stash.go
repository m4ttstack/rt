// Stash view: the Changes tab's right pane while the current branch's stash
// entry is shown, painted through History's committed pane under the stash
// header. Parity reference: GitHub Desktop's app/src/ui/stashing
// (stash-diff-viewer, stash-diff-header).
package mission

import (
	"slices"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

const (
	stashRestoreLabel = " Restore "
	stashDiscardLabel = " Discard "
	stashRestoreHint  = "Restore will move your stashed files to the Changes list."
	stashButtonRow    = 1
)

type stashSelectPayload struct {
	Path          string `json:"path,omitempty"`
	ShowOversized bool   `json:"showOversized,omitempty"`
}

type stashEntryPayload struct {
	Sha string `json:"sha"`
}

func (m *Mission) stashShowing() bool {
	return !m.historyTab() && m.model.Stash != nil && m.model.Stash.Showing
}

// settleStash runs on every push: focus follows the view as the driver opens
// and closes it, including focus held behind an open menu.
func (m *Mission) settleStash(wasShowing bool) {
	focus := &m.focus
	if m.menu != nil {
		focus = &m.menuPrevFocus
	}
	showing := m.stashShowing()
	switch {
	case !showing && (*focus == focusStashFiles || *focus == focusDiff && m.diffFromStash):
		*focus = focusList
	case showing && !wasShowing && *focus == focusList:
		*focus = focusStashFiles
	}
	if !showing {
		m.diffFromStash = false
	} else if m.stashFileIndex() < 0 {
		m.stashFile = m.model.Stash.SelectedFile
	}
}

// homeFocus is where leaving a filter, a commit field, a foldout, or a menu
// lands: the stash files while the stash view shows, so its keybar stays
// true.
func (m *Mission) homeFocus() focusKind {
	if m.stashShowing() {
		return focusStashFiles
	}
	return focusList
}

// focusDiffPane focuses whichever diff the pane shows.
func (m *Mission) focusDiffPane() {
	m.focus = focusDiff
	m.diffFromStash = m.stashShowing()
}

func (m *Mission) stashFileIndex() int {
	if m.model.Stash == nil {
		return -1
	}
	return slices.IndexFunc(m.model.Stash.Files, func(f HistoryFileRow) bool { return f.Path == m.stashFile })
}

// toggleStash is Desktop's Show/Hide Stashed Changes. Opening leaves the
// file to the driver, which selects the first one.
func (m *Mission) toggleStash() tea.Cmd {
	if m.model.Stash == nil {
		return nil
	}
	if m.stashShowing() {
		m.focus = focusList
		return m.em.Emit(protocol.Intent{Name: "mission:stash-hide"})
	}
	m.focus = focusStashFiles
	m.stashFile = ""
	return m.em.Emit(protocol.Intent{Name: "mission:stash-select", Payload: mustPayload(stashSelectPayload{})})
}

func (m *Mission) restoreStash() tea.Cmd {
	if m.model.Stash == nil {
		return nil
	}
	return m.em.Emit(protocol.Intent{Name: "mission:stash-restore", Payload: mustPayload(stashEntryPayload{Sha: m.model.Stash.Sha})})
}

func (m *Mission) emitStashFile() tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:stash-select", Payload: mustPayload(stashSelectPayload{Path: m.stashFile})})
}

func (m *Mission) stashFileMove(delta int) tea.Cmd {
	if m.model.Stash == nil || len(m.model.Stash.Files) == 0 {
		return nil
	}
	files := m.model.Stash.Files
	before := m.stashFile
	m.stashFile = files[max(0, min(len(files)-1, m.stashFileIndex()+delta))].Path
	if m.stashFile == before {
		return nil
	}
	return m.emitStashFile()
}

func (m *Mission) clickStashFile(idx int) (tea.Model, tea.Cmd) {
	if m.model.Stash == nil || idx < 0 || idx >= len(m.model.Stash.Files) {
		return m, nil
	}
	m.focus = focusStashFiles
	path := m.model.Stash.Files[idx].Path
	if path == m.stashFile {
		return m, nil
	}
	m.stashFile = path
	return m, m.emitStashFile()
}

func (m *Mission) stashFilesKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.stashFileMove(-1)
	case "down":
		return m, m.stashFileMove(1)
	case "enter":
		m.focusDiffPane()
		return m, nil
	case "h", "esc":
		return m, m.toggleStash()
	case "R":
		return m, m.restoreStash()
	case "ctrl+k":
		m.openMenu(menuTarget{}, nil)
		return m, nil
	case "space":
		return m, nil
	}
	return m.listKey(v)
}

// stashHeaderButtons is where stashHeaderLines paints the Restore and
// Discard buttons on stashButtonRow, pane-relative and clipped to the
// header's right margin. The hit test reads the same spans.
func stashHeaderButtons(width int) (restoreStart, restoreEnd, discardStart, discardEnd int) {
	limit := max(width-1, 0)
	restoreStart = 1
	restoreEnd = restoreStart + lipgloss.Width(stashRestoreLabel)
	discardStart = restoreEnd + 1
	discardEnd = discardStart + lipgloss.Width(stashDiscardLabel)
	return min(restoreStart, limit), min(restoreEnd, limit), min(discardStart, limit), min(discardEnd, limit)
}

// stashHeaderLines is Desktop's stash-diff-header as terminal rows, each
// exactly width cells: the title, then the buttons and the explanatory line.
// A clipped button loses its tail without an ellipsis, so its painted cells
// stay exactly its span.
func stashHeaderLines(width int, hoverRestore, hoverDiscard bool) []string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	title := headerRow(on, on.Render(" ")+on.Foreground(theme.Text).Bold(true).Render(clip("Stashed changes", max(width-2, 0))), width)

	restoreBg, discardBg := theme.Pink, theme.Panel
	if hoverRestore {
		restoreBg = theme.PinkSoft
	}
	if hoverDiscard {
		discardBg = theme.HoverBg
	}
	rs, re, ds, de := stashHeaderButtons(width)
	gap := func(n int) string { return on.Render(strings.Repeat(" ", n)) }
	button := lipgloss.NewStyle().Bold(true)
	row := gap(rs) +
		button.Background(restoreBg).Foreground(theme.Bg).Render(ansi.Truncate(stashRestoreLabel, re-rs, "")) +
		gap(ds-re) +
		button.Background(discardBg).Foreground(theme.Text).Render(ansi.Truncate(stashDiscardLabel, de-ds, ""))
	if rest := width - 1 - de - 1; rest > 0 {
		row += on.Render(" ") + on.Foreground(theme.Dim).Render(clip(stashRestoreHint, rest))
	}
	return []string{title, headerRow(on, row, width)}
}

func (m *Mission) stashPane(width int) committedPane {
	return committedPane{
		header: stashHeaderLines(width, m.hoverStashRestore, m.hoverStashDiscard),
		files:  m.model.Stash.Files, cursor: m.stashFile, top: &m.stashFilesTop,
		hover: m.hoverStashFile, focused: m.focus == focusStashFiles,
	}
}

func (m *Mission) renderStashPane(width, height int) string {
	if m.model.Stash.Files == nil {
		return centeredMessage(width, height, theme.Faint, "Loading stashed changes…")
	}
	return m.renderCommittedPane(m.stashPane(width), width, height)
}

func (m *Mission) stashPaneHit(x, y int) hit {
	if m.model.Stash.Files == nil {
		return hit{}
	}
	paneW := m.diffWidth()
	switch h := m.committedPaneHit(m.stashPane(paneW), x, y, paneW); h.region {
	case paneHeader:
		rs, re, ds, de := stashHeaderButtons(paneW)
		switch {
		case h.row != stashButtonRow:
		case x >= rs && x < re:
			return hit{kind: hitStashRestore}
		case x >= ds && x < de:
			return hit{kind: hitStashDiscard}
		}
	case paneFile:
		return hit{kind: hitStashFile, idx: h.idx}
	case paneDiff:
		return h.diff
	}
	return hit{}
}

func (m *Mission) stashWheel(x, y, delta int) tea.Cmd {
	if m.model.Stash.Files == nil {
		return nil
	}
	paneW := m.diffWidth()
	return m.committedPaneWheel(m.stashPane(paneW), x, y, paneW, delta, m.stashFileMove)
}
