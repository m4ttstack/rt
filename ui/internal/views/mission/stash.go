// Stash view: the Changes tab's right pane while the current branch's stash
// entry is shown, painted through History's committed pane under the stash
// header, and the stash questions. Parity reference: GitHub Desktop's
// app/src/ui/stashing (stash-diff-viewer, stash-diff-header,
// confirm-discard-stash) and app/src/ui/stash-changes
// (stash-and-switch-branch-dialog, overwrite-stashed-changes-dialog).
package mission

import (
	"slices"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

const (
	stashRestoreLabel = " Restore "
	stashDiscardLabel = " Discard "
	stashRestoreHint  = "Restore will move your stashed files to the Changes list."
	stashButtonRow    = 1

	overwriteStashTitle = "Overwrite Stash?"
	discardStashTitle   = "Discard Stash?"
	switchBranchTitle   = "Switch Branch"
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
// lands, and where a checkbox click leaves focus: the stash files while the
// stash view shows, so its keybar stays true.
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

func (m *Mission) emitStashDiscard(sha string) tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:stash-discard", Payload: mustPayload(stashEntryPayload{Sha: sha})})
}

func (m *Mission) emitStash() tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:stash"})
}

func (m *Mission) emitSwitch(branch, strategy string) tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:checkout", Payload: mustPayload(checkoutPayload{Branch: branch, Strategy: strategy})})
}

// stashAllLabel ends in an ellipsis exactly when the row asks first.
func (m *Mission) stashAllLabel() string {
	if m.model.Stash != nil {
		return "Stash All Changes…"
	}
	return "Stash All Changes"
}

// stashAllChanges is Desktop's Stash All Changes: a branch that already has
// an entry asks before a new stash overwrites it.
func (m *Mission) stashAllChanges() tea.Cmd {
	switch {
	case !m.model.CanStash:
		return nil
	case m.model.Stash != nil:
		m.openQuestion(overwriteStashTitle, overwriteStashItems(), menuTarget{kind: targetStash})
		return nil
	}
	return m.emitStash()
}

func (m *Mission) askDiscardStash() {
	if m.model.Stash == nil {
		return
	}
	m.openQuestion(discardStashTitle, discardStashItems(m.model.Stash.Sha), menuTarget{kind: targetStash})
}

func (m *Mission) openSwitchPrompt(p SwitchPrompt) {
	m.openQuestion(switchBranchTitle, switchItems(p), menuTarget{kind: targetSwitch, prompt: p})
}

// overwriteStashItems wraps Desktop's one-sentence body onto two rows, as
// StashStates.png does: one row would widen the box past most panes.
func overwriteStashItems() []picker.MenuItem {
	return []picker.MenuItem{
		questionBody("Are you sure you want to proceed? This will overwrite"),
		questionBody("your existing stash with your current changes."),
		questionChoice("overwrite", "Overwrite"),
		cancelChoice(),
	}
}

// discardStashItems carries the entry's sha on the confirm row, so a push
// that replaces the stash while the question is open cannot retarget it.
func discardStashItems(sha string) []picker.MenuItem {
	confirm := questionChoice("stash-discard", "Discard")
	confirm.Value = sha
	return []picker.MenuItem{
		questionBody("Are you sure you want to discard these stashed changes?"),
		confirm,
		cancelChoice(),
	}
}

// switchItems is Desktop's radio dialog as menu rows. picker.Menu has no
// per-row color or footer, so each description is a Faint row under its
// option and the warning glyph paints Faint with its text.
func switchItems(p SwitchPrompt) []picker.MenuItem {
	items := []picker.MenuItem{
		questionBody("You have changes on this branch. What would you like to do with them?"),
		questionChoice("switch-leave", "Leave my changes on "+p.Current),
		questionNote("Your in-progress work will be stashed on this branch for you to return to later"),
	}
	if p.HasStash {
		items = append(items, questionNote(theme.GlyphWarn+" Your current stash will be overwritten by creating a new stash"))
	}
	return append(items,
		questionChoice("switch-bring", "Bring my changes to "+p.Branch),
		questionNote("Your in-progress work will follow you to the new branch"),
	)
}

func stashViewItems() []picker.MenuItem {
	return []picker.MenuItem{
		{ID: "stash-restore", Label: "Restore"},
		{ID: "stash-discard-ask", Label: "Discard…"},
	}
}

// stashEntryKey runs the keys that act on the entry itself, bound alike in
// the stash files and the stash diff.
func (m *Mission) stashEntryKey(key string) (tea.Cmd, bool) {
	switch key {
	case "R":
		return m.restoreStash(), true
	case "D":
		m.askDiscardStash()
		return nil, true
	case "h":
		return m.toggleStash(), true
	}
	return nil, false
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
	if cmd, ok := m.stashEntryKey(v.String()); ok {
		return m, cmd
	}
	switch v.String() {
	case "up":
		return m, m.stashFileMove(-1)
	case "down":
		return m, m.stashFileMove(1)
	case "enter":
		m.focusDiffPane()
		return m, nil
	case "esc":
		return m, m.toggleStash()
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
		button.Background(restoreBg).Foreground(theme.Bg).Render(clip(stashRestoreLabel, re-rs)) +
		gap(ds-re) +
		button.Background(discardBg).Foreground(theme.Text).Render(clip(stashDiscardLabel, de-ds))
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
