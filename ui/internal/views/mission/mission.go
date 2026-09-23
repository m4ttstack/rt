// Package mission is the mission-control view: the top bar, the Changes
// sidebar, the commit box, the keybar, and the diff pane, driven off the
// Current checkout wire model.
package mission

import (
	"encoding/json"
	"strings"
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/session"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

// focusKind is which part of the view keys route to. focusList is the zero
// value so a bare Mission (and a Mission fresh out of New) both start there.
type focusKind int

const (
	focusList focusKind = iota
	focusFilter
	focusDiff
	focusSummary
	focusDescription
	focusModal
	focusHistoryFiles
	focusMenu
)

// diffScroll is one tab's diff pane position, stashed while the other tab
// owns the pane.
type diffScroll struct {
	cursor, top int
	path        string
}

type Mission struct {
	em     *session.Emitter
	model  Model
	width  int
	height int
	reason session.Reason

	// selected is the Changes row cursor, held by path across model swaps
	// (board.go's selected-by-id precedent) since the wholesale Model
	// replacement in SetModel carries no index that would survive a
	// reordered or filtered list. changesTop is the Changes list's own
	// scroll window top (picker.Viewport), the same role diffTop plays for
	// the diff pane.
	selected   string
	changesTop int

	focus            focusKind
	filterText       string
	amendLocal       bool
	summaryInput     textinput.Model
	descriptionInput textinput.Model

	// diffCursor is the line cursor into model.Diff.Lines; diffTop is the
	// scroll window's top line. diffPath is the Diff.Path last seen, so a
	// model swap that keeps the same file (a stage refreshing the hunk)
	// preserves the cursor while one that shows a different file resets it
	// (diff.go's clampDiffCursor).
	diffCursor int
	diffTop    int
	diffPath   string

	// modal is the open repo/branch/worktree foldout, nil when none is open.
	modal *modalState
	// menu is the open context menu, nil when none is open. menuTarget is the
	// row it opened for, held fixed while it is open: a push never retargets
	// it. menuPrevFocus is where closing it returns.
	menu          *picker.Menu
	menuTarget    menuTarget
	menuPrevFocus focusKind
	// localNotice is a client-only refusal cue (the detached-HEAD branch
	// guard), kept separate from the wire model's own Notice field: that one
	// carries the driver's own guard refusals, this one covers a refusal the
	// view decides on its own before any intent reaches the driver. It is
	// cleared at the top of every KeyPressMsg and re-armed only by the key
	// that triggers a fresh refusal, so it shows for exactly one render.
	// Both share the one notice strip; noticeText picks the winner.
	localNotice string

	// hoverZone is the top-bar segment under the pointer, zoneNone when it
	// is over neither segment nor anything else.
	hoverZone zoneID
	// hoverFile/hoverDiffLine are the Changes/Diff.Lines index under the
	// pointer, -1 when neither is hovered; hoverGutter narrows a diff-line
	// hover to specifically its gutter cell, for the stage-bar preview.
	// Hover is a render hint only -- it never moves diffCursor/selected, the
	// same row/cursor split the picker board established.
	hoverFile     int
	hoverDiffLine int
	hoverGutter   bool

	// The sidebar's other hoverable regions, each a plain bool (no index to
	// carry): mouseMotion clears every one of these at the top of its switch
	// alongside hoverFile/hoverDiffLine, so a pointer that leaves a region
	// can never leave its highlight stuck.
	hoverCommitButton      bool
	hoverTab               bool
	hoverFilterRow         bool
	hoverCommitSummary     bool
	hoverCommitDescription bool
	hoverStash             bool
	hoverUndoChip          bool

	// History tab view state. historyCursor/historyAnchor are held by sha
	// (the list reorders and grows across pushes); the anchor is "" unless a
	// shift gesture opened a range. historyMoreFor is the list length the
	// last mission:history-more went out for, -1 before any. historyTop is
	// the list's first painted line; while historyFreeScroll is set (the
	// wheel moved the view) it holds as the wheel left it instead of
	// following the cursor. historyOnMore puts the cursor on the "Load 100
	// more commits" row; historyCursor keeps the commit selection meanwhile.
	// historyFilter is the History "/" filter: view-local, never sent to the
	// driver, sharing focusFilter with the Changes filter by tab.
	//
	// The commit and file debounces are selectGen's counterparts:
	// historyShown/historyFileShown are what the driver shows or was last
	// sent (taken from a push only when the driver's own value changed, and
	// from every emit), and a tick emits only if its generation is still
	// current and the cursor differs from the shown value. They keep
	// separate generations so a file click cannot supersede a pending
	// commit select. historyDriverKey/historyDriverFile are the driver's
	// values at the previous push.
	historyCursor      string
	historyAnchor      string
	historyTop         int
	historyFreeScroll  bool
	historyOnMore      bool
	hoverHistoryMore   bool
	historyFilter      string
	historyMatches     historyMatchCache
	historyGen         int
	historyShown       string
	historyDriverKey   string
	historyMoreFor     int
	hoverCommit        int
	historyFile        string
	historyFileGen     int
	historyFilePending bool
	historyFileShown   string
	historyDriverFile  string
	historyFilesTop    int
	hoverHistoryFile   int
	historyExpanded    bool
	hoverExpander      bool

	// lastTab is the tab the previous push showed; tabDiff holds each tab's
	// diff position while the other tab owns the pane.
	lastTab string
	tabDiff map[string]diffScroll

	// lastClickPath/lastClickAt pair a file row's two clicks into a double
	// click (focuses the diff) the same way the picker's own clickRow does
	// for its list; nowFn overrides the clock in tests, nil meaning
	// time.Now.
	lastClickPath string
	lastClickAt   time.Time
	nowFn         func() time.Time

	// selectGen/selectPending/selectPendingBase debounce cursorSelectCmd's
	// mission:select: the first movement of an otherwise-settled cursor
	// freezes selectPendingBase at the path already showing and every
	// movement after it (settled or not) bumps selectGen. A tick only
	// settles selectPathCmd(selectPendingBase) if its own captured
	// generation still matches, so a movement that arrives before the tick
	// fires supersedes it into a no-op instead of a trailing emission.
	selectGen         int
	selectPending     bool
	selectPendingBase string
}

func New(em *session.Emitter) *Mission {
	return &Mission{
		em:               em,
		reason:           session.ReasonClosed,
		summaryInput:     newTextInput("", commitBoxInner),
		descriptionInput: newTextInput("Description", commitBoxInner),
		hoverFile:        -1,
		hoverDiffLine:    -1,
		hoverCommit:      -1,
		hoverHistoryFile: -1,
		historyMoreFor:   -1,
		tabDiff:          map[string]diffScroll{},
	}
}

// now returns the clock a click is timestamped against -- m.nowFn when a
// test set one, the real clock otherwise (mirrors the picker's own now()).
func (m *Mission) now() time.Time {
	if m.nowFn != nil {
		return m.nowFn()
	}
	return time.Now()
}

// Pink cursor, Faint placeholder, no prompt glyph (the caller's own box or
// line is the only chrome).
func newTextInput(placeholder string, width int) textinput.Model {
	ti := textinput.New()
	ti.Prompt = ""
	ti.CharLimit = 0
	ti.Placeholder = placeholder
	ti.SetWidth(width)
	styles := ti.Styles()
	styles.Focused.Text = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Text)
	styles.Focused.Placeholder = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Faint)
	styles.Blurred.Text = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Text)
	styles.Blurred.Placeholder = lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Faint)
	styles.Cursor.Color = theme.Pink
	ti.SetStyles(styles)
	return ti
}

// noticeText is what the single notice strip shows: the wire model's own
// Notice (a driver refusal) outranks a view-local one when both are pending.
func (m *Mission) noticeText() string {
	if m.model.Notice != "" {
		return m.model.Notice
	}
	return m.localNotice
}

// commitEnabled is the view-side commit gate: the wire CanCommit (something
// is staged) or a local amend toggle (amending re-uses the last commit's own
// changes) opens the path, but only once a summary has actually been typed.
// The driver re-checks the summary on mission:commit as well.
func (m *Mission) commitEnabled() bool {
	return (m.model.Commit.CanCommit || m.amendLocal) && strings.TrimSpace(m.summaryInput.Value()) != ""
}

// SetModel treats the local summary/description drafts and the amend toggle
// as authoritative: a push never overwrites a non-empty draft (whatever the
// focus) and never touches amendLocal; wire values only seed empty fields.
func (m *Mission) SetModel(raw json.RawMessage) error {
	decoded, err := decode(raw)
	if err != nil {
		return err
	}
	// historyReloaded only catches a shorter list or a new first sha. Two
	// other paths leave the list at exactly historyMoreFor's length with
	// hasMore still true: a history-more that threw (a notice, list
	// unchanged) and a worktree switch to a tree at the same tip (pool
	// worktrees commonly share one), so each needs its own re-arm check.
	reloaded := historyReloaded(m.model.History.Commits, decoded.History.Commits) ||
		decoded.Current.Worktree != m.model.Current.Worktree
	if reloaded || (decoded.Notice != "" && len(decoded.History.Commits) == m.historyMoreFor) {
		m.historyMoreFor = -1
	}
	if reloaded || len(m.model.History.Commits) == 0 && len(decoded.History.Commits) > 0 {
		m.historyFreeScroll = false
	}
	// A landed page puts the cursor back on the last commit it followed, so
	// it never chases the action row to the new end of the list, and the
	// row's hover stays with the pointer it moved away from.
	if reloaded || len(decoded.History.Commits) != len(m.model.History.Commits) || !decoded.History.HasMore {
		m.historyOnMore, m.hoverHistoryMore = false, false
	}
	m.model = decoded
	m.clampSelection()
	m.clampHistory()
	if tab := tabKey(m.model.Tab); tab != tabKey(m.lastTab) {
		if m.tabDiff == nil {
			m.tabDiff = map[string]diffScroll{}
		}
		m.tabDiff[tabKey(m.lastTab)] = diffScroll{cursor: m.diffCursor, top: m.diffTop, path: m.diffPath}
		restored := m.tabDiff[tab]
		m.diffCursor, m.diffTop, m.diffPath = restored.cursor, restored.top, restored.path
		// The pointer that hovered the old inactive half now rests on the
		// active one, and no motion arrives to clear it.
		m.hoverTab = false
		switch {
		case m.menu != nil:
			m.menuPrevFocus = focusList
		case m.modal == nil:
			m.focus = focusList
		}
	}
	m.lastTab = m.model.Tab
	m.clampDiffCursor()
	if m.summaryInput.Value() == "" {
		m.summaryInput.SetValue(m.model.Commit.Summary)
	}
	m.summaryInput.Placeholder = m.model.Commit.Placeholder
	if m.descriptionInput.Value() == "" {
		m.descriptionInput.SetValue(m.model.Commit.Description)
	}
	// A background refresh must not stomp filter text the user is still
	// typing; the wire value only lands once they commit it via enter.
	if m.focus != focusFilter {
		m.filterText = m.model.Filter
	}
	return nil
}

// tabKey folds an older producer's "" into "changes", the tab it means.
func tabKey(tab string) string {
	if tab == "history" {
		return "history"
	}
	return "changes"
}

// clampSelection keeps the cursor on the same path across a model swap when
// it still exists, falls back to the first row when it does not, and clears
// it when the list is empty.
func (m *Mission) clampSelection() {
	if len(m.model.Changes) == 0 {
		m.selected = ""
		return
	}
	for _, c := range m.model.Changes {
		if c.Path == m.selected {
			return
		}
	}
	m.selected = m.model.Changes[0].Path
}

func (m *Mission) index() int {
	for i, c := range m.model.Changes {
		if c.Path == m.selected {
			return i
		}
	}
	return -1
}

func (m *Mission) moveCursor(delta int) {
	n := len(m.model.Changes)
	if n == 0 {
		return
	}
	i := m.index() + delta
	if i < 0 {
		i = 0
	}
	if i >= n {
		i = n - 1
	}
	m.selected = m.model.Changes[i].Path
}

func (m *Mission) Reason() session.Reason { return m.reason }

func (m *Mission) Init() tea.Cmd { return nil }

func (m *Mission) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = v.Width, v.Height
	case session.ModelUpdate:
		if err := m.SetModel(v.Raw); err != nil {
			return m, nil
		}
		if m.historyTab() && m.historyFilter != "" {
			return m, m.historyReHome()
		}
	case session.CloseRequest:
		m.reason = session.ReasonClosed
		return m, tea.Quit
	case selectDebounceMsg:
		if v.generation != m.selectGen {
			return m, nil
		}
		m.selectPending = false
		return m, m.selectPathCmd(m.selectPendingBase)
	case historyDebounceMsg:
		return m, m.settleHistory(v)
	case tea.MouseClickMsg:
		return m.mouseClick(v)
	case tea.MouseMotionMsg:
		return m.mouseMotion(v)
	case tea.MouseWheelMsg:
		return m.mouseWheel(v)
	case tea.KeyPressMsg:
		m.localNotice = ""
		if v.String() == "ctrl+c" {
			return m.quit()
		}
		if m.focus == focusMenu {
			return m.runMenuOutcome(m.menu.Key(v))
		}
		switch m.focus {
		case focusModal:
			return m.modalKey(v)
		case focusFilter:
			if m.historyTab() {
				return m.historyFilterKey(v)
			}
			return m.filterKey(v)
		case focusSummary, focusDescription:
			return m.commitKey(v)
		case focusDiff:
			return m.diffKey(v)
		case focusHistoryFiles:
			return m.historyFilesKey(v)
		default:
			if m.historyTab() {
				return m.historyListKey(v)
			}
			return m.listKey(v)
		}
	}
	return m, nil
}

func (m *Mission) listKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.cursorSelectCmd(-1)
	case "down":
		return m, m.cursorSelectCmd(1)
	case "space":
		if m.selected == "" {
			return m, nil
		}
		return m, m.stageIntent(m.selected, "toggle-file")
	case "enter":
		m.focus = focusDiff
	case "c":
		m.focus = focusSummary
		return m, m.summaryInput.Focus()
	case "u":
		return m, m.em.Emit(protocol.Intent{Name: "mission:undo"})
	case "f":
		return m, m.em.Emit(protocol.Intent{Name: "mission:action"})
	case "a":
		m.amendLocal = !m.amendLocal
	case "/":
		m.focus = focusFilter
		m.filterText = m.model.Filter
	case "b":
		return m.openBranchModal()
	case "w":
		return m.openWorktreeModal()
	case "r":
		return m.openRepoModal()
	case "2":
		return m, m.emitTab("history")
	case "ctrl+k":
		m.openMenu(m.focusedTarget(), nil)
	case "q":
		return m.quit()
	}
	return m, nil
}

func (m *Mission) filterKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "esc":
		m.filterText = m.model.Filter
		m.focus = focusList
	case "enter":
		ft := m.filterText
		m.focus = focusList
		return m, m.em.Emit(protocol.Intent{Name: "mission:select", Payload: mustPayload(selectPayload{Filter: ft})})
	case "backspace":
		if r := []rune(m.filterText); len(r) > 0 {
			m.filterText = string(r[:len(r)-1])
		}
	default:
		if v.Text != "" {
			m.filterText += v.Text
		}
	}
	return m, nil
}

func (m *Mission) commitKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "esc":
		m.blurCommitInputs()
		m.focus = focusList
		return m, nil
	case "tab":
		m.blurCommitInputs()
		if m.focus == focusSummary {
			m.focus = focusDescription
			return m, m.descriptionInput.Focus()
		}
		m.focus = focusSummary
		return m, m.summaryInput.Focus()
	case "ctrl+enter":
		return m.emitCommit()
	case "ctrl+a":
		m.amendLocal = !m.amendLocal
		return m, nil
	default:
		var cmd tea.Cmd
		if m.focus == focusSummary {
			m.summaryInput, cmd = m.summaryInput.Update(v)
		} else {
			m.descriptionInput, cmd = m.descriptionInput.Update(v)
		}
		return m, cmd
	}
}

func (m *Mission) blurCommitInputs() {
	m.summaryInput.Blur()
	m.descriptionInput.Blur()
}

// emitCommit sends mission:commit when commitEnabled and clears the local
// drafts in the same step: drafts outrank pushes (SetModel), so the emit is
// the only moment the box can empty itself after a commit.
func (m *Mission) emitCommit() (tea.Model, tea.Cmd) {
	if !m.commitEnabled() {
		return m, nil
	}
	payload := commitPayload{
		Summary:     m.summaryInput.Value(),
		Description: m.descriptionInput.Value(),
		Amend:       m.amendLocal,
	}
	m.summaryInput.SetValue("")
	m.descriptionInput.SetValue("")
	m.amendLocal = false
	return m, m.em.Emit(protocol.Intent{Name: "mission:commit", Payload: mustPayload(payload)})
}

// selectDebounceInterval is how long the Changes cursor must sit still
// before its row's mission:select actually fires: passing through several
// rows on a scroll must load none of their diffs, only the one it lands on.
const selectDebounceInterval = 150 * time.Millisecond

// selectTick indirects tea.Tick so tests can settle cursorSelectCmd's
// debounce without a real sleep; production always schedules a real timer.
var selectTick = tea.Tick

// selectDebounceMsg is a settled-cursor tick from cursorSelectCmd. Its
// generation is checked against Mission.selectGen before it is allowed to
// select anything -- see the Mission struct's own comment on selectGen.
type selectDebounceMsg struct {
	generation int
}

// cursorSelectCmd moves the Changes cursor by delta instantly, then
// schedules a debounced mission:select rather than emitting one directly --
// a fast scroll must not fire one per row passed over.
func (m *Mission) cursorSelectCmd(delta int) tea.Cmd {
	if !m.selectPending {
		m.selectPendingBase = m.selected
		m.selectPending = true
	}
	m.moveCursor(delta)
	m.selectGen++
	gen := m.selectGen
	return selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return selectDebounceMsg{generation: gen}
	})
}

func (m *Mission) selectPathCmd(prev string) tea.Cmd {
	if m.selected == prev || m.selected == "" {
		return nil
	}
	// An emission -- whether an immediate click or a settled debounce --
	// means the pane now shows m.selected, so any older pending tick must
	// not fire a second, redundant select behind this one's back.
	m.selectGen++
	m.selectPending = false
	return m.em.Emit(protocol.Intent{Name: "mission:select", Payload: mustPayload(pathSelectPayload{Path: m.selected})})
}

func (m *Mission) stageIntent(path, mode string) tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:stage", Payload: mustPayload(stagePayload{Path: path, Mode: mode})})
}

func (m *Mission) quit() (tea.Model, tea.Cmd) {
	m.reason = session.ReasonQuit
	return m, tea.Sequence(m.em.Emit(protocol.Intent{Name: "quit"}), tea.Quit)
}

type stagePayload struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
}

type commitPayload struct {
	Summary     string `json:"summary"`
	Description string `json:"description"`
	Amend       bool   `json:"amend"`
}

type selectPayload struct {
	Filter string `json:"filter"`
}

// pathSelectPayload deliberately omits the filter key: the driver treats any
// present "filter" string as a filter update, so a row-selection emit must
// not carry one or it would clear a filter mid-flight.
type pathSelectPayload struct {
	Path string `json:"path"`
}

// mustPayload marshals a payload struct built entirely from strings/bools,
// which json.Marshal cannot fail on.
func mustPayload(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func (m *Mission) filterDisplayText() string {
	if m.focus == focusFilter {
		return m.filterText
	}
	return m.model.Filter
}

// sidebarFixedTopRows is the constant row count above the (scrollable)
// Changes list: tabs(3, pad+label+underline) + the tabs-gap blank band
// row(1) + the filter box(3) + the master row(1) (docs/design/mission/
// README.md's Terminal geometry table). Unlike the old content-driven top
// block, this never varies with the Changes count -- the list itself is now
// a fixed-height scrolling region, not a block that grows the whole sidebar.
const sidebarFixedTopRows = 8

func (m *Mission) sidebarFixedTop(width int) string {
	return lipgloss.JoinVertical(lipgloss.Left,
		renderTabsRow(m.model.ChangedTotal, "changes", m.hoverTab, width),
		blankRows(width, 1),
		renderFilterRow(m.filterDisplayText(), "Filter changes", m.focus == focusFilter, m.hoverFilterRow, width),
		renderMasterRow(m.model.ChangedTotal, m.model.StagedTotal, width),
	)
}

// sidebarDocked is the bottom-pinned block: stash strip, rule, commit box,
// undo strip.
func (m *Mission) sidebarDocked(width int) string {
	var docked []string
	if m.model.StashCount > 0 {
		docked = append(docked, renderStashStrip(m.model.StashCount, m.hoverStash, width))
	}
	docked = append(docked, lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render(strings.Repeat("─", width)))
	docked = append(docked, renderCommitBox(width, m.summaryInput.View(), m.descriptionInput.View(), m.amendLocal, m.model.Commit.ButtonLabel, m.commitEnabled(), m.hoverCommitButton, m.hoverCommitSummary, m.hoverCommitDescription))
	if lc := m.model.Commit.LastCommit; lc != nil && lc.Undoable {
		docked = append(docked, renderUndoStrip(*lc, m.hoverUndoChip, width))
	}
	return lipgloss.JoinVertical(lipgloss.Left, docked...)
}

// listRegionHeight is the fixed height the Changes list renders into, given
// the sidebar's overall height: whatever height isn't claimed by the fixed
// top rows or the docked block. Shared by layout() (for hit-testing) and
// renderSidebar/renderChangesList (for painting) so both agree on exactly
// how tall the scrolling region is.
func (m *Mission) listRegionHeight(width, height int) int {
	h := height - sidebarFixedTopRows - lipgloss.Height(m.sidebarDocked(width))
	if h < 0 {
		h = 0
	}
	return h
}

// renderChangesList windows the Changes rows into exactly listRegionH rows:
// a short list top-aligns with Bg filler below it, a long list scrolls with
// the cursor via picker.Viewport -- the same primitive the diff pane uses,
// so both scrolling regions in the TUI share one offset/scrolloff formula.
// One column is always reserved for a Panel scroll thumb, whether or not
// the list is actually scrolling, mirroring the diff pane's own
// always-reserved thumb column.
func (m *Mission) renderChangesList(width, listRegionH int) string {
	changes := m.model.Changes
	n := len(changes)
	rowWidth := width - 1
	if rowWidth < 0 {
		rowWidth = 0
	}
	cursorIdx := m.index()
	if cursorIdx < 0 {
		cursorIdx = 0
	}
	top, h := picker.Viewport(cursorIdx, m.changesTop, n, listRegionH, listRegionH, 0)
	m.changesTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, h, n)
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	restOn := lipgloss.NewStyle().Background(theme.Bg)

	rows := make([]string, listRegionH)
	for i := 0; i < listRegionH; i++ {
		idx := top + i
		row := lipgloss.NewStyle().Width(rowWidth).Background(theme.Bg).Render("")
		if i < h && idx < n {
			c := changes[idx]
			row = renderChangeRow(c, rowWidth, c.Path == m.selected, idx == m.hoverFile)
		}
		rows[i] = row + picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
	}
	return strings.Join(rows, "\n")
}

// renderSidebar composes the fixed top rows, the (now fixed-height,
// scrollable) Changes list, and the bottom-docked stash/commit/undo block
// (docs/design/mission/Main.png, EmptyState.png): the list's own height is
// whatever the top rows and docked block don't claim, so the docked block
// never gets pushed off screen by a long list -- the list scrolls within
// what remains instead.
func (m *Mission) renderSidebar(width, height int) string {
	if m.historyTab() {
		return m.renderHistorySidebar(width, height)
	}
	listRegionH := m.listRegionHeight(width, height)
	return lipgloss.JoinVertical(lipgloss.Left,
		m.sidebarFixedTop(width),
		m.renderChangesList(width, listRegionH),
		m.sidebarDocked(width),
	)
}

func blankRows(width, n int) string {
	row := lipgloss.NewStyle().Width(width).Background(theme.Bg).Render("")
	rows := make([]string, n)
	for i := range rows {
		rows[i] = row
	}
	return strings.Join(rows, "\n")
}

// diffWidth is the diff pane's content width: the frame width less the
// sidebar and its divider column. hitTest uses the same formula to resolve a
// diff-pane click against the identical column math View renders with.
func (m *Mission) diffWidth() int {
	w := m.width - sidebarWidth - 1
	if w < 0 {
		w = 0
	}
	return w
}

// frameLayout is View's own line-count arithmetic, factored out so hitTest
// resolves a click against the exact geometry the last frame painted rather
// than a second, potentially drifting copy of it. sidebarTopH is the
// constant sidebarFixedTopRows; listRegionH is the Changes list's own fixed
// height (however many of its rows are actually filled, versus left as
// Bg-filler or scrolled past); sidebarFillerH is how many of the Changes
// list's rows are filler (0 once the list is long enough to scroll, and
// always 0 on History).
type frameLayout struct {
	topH, bodyH, keybarH, noticeH               int
	sidebarTopH, sidebarDockedH, sidebarFillerH int
	listRegionH                                 int
}

func (m *Mission) layout() frameLayout {
	l := frameLayout{
		topH:    lipgloss.Height(renderTopBar(m.model, m.width, m.hoverZone, m.openZone())),
		keybarH: lipgloss.Height(renderKeybar(m.width, m.model.Tab)),
	}
	if m.noticeText() != "" {
		l.noticeH = 1
	}
	l.bodyH = m.height - l.topH - l.keybarH - l.noticeH
	if m.historyTab() {
		l.sidebarTopH = historyFixedTopRows
		l.bodyH = max(l.bodyH, historyFixedTopRows)
		l.listRegionH = l.bodyH - historyFixedTopRows
		return l
	}
	l.sidebarTopH = sidebarFixedTopRows
	l.sidebarDockedH = lipgloss.Height(m.sidebarDocked(sidebarWidth))
	natural := l.sidebarTopH + l.sidebarDockedH
	if l.bodyH < natural {
		l.bodyH = natural
	}
	l.listRegionH = l.bodyH - natural
	l.sidebarFillerH = l.listRegionH - len(m.model.Changes)
	if l.sidebarFillerH < 0 {
		l.sidebarFillerH = 0
	}
	return l
}

func (m *Mission) View() tea.View {
	top := renderTopBar(m.model, m.width, m.hoverZone, m.openZone())
	diffW := m.diffWidth()
	keybar := renderKeybar(m.width, m.model.Tab)
	l := m.layout()
	bodyHeight := l.bodyH

	sidebarPadded := m.renderSidebar(sidebarWidth, bodyHeight)
	var pane string
	if m.historyTab() {
		pane = m.renderHistoryPane(diffW, bodyHeight)
	} else {
		pane = m.renderDiffPane(diffW, bodyHeight)
	}
	diffPadded := lipgloss.NewStyle().Width(diffW).Height(bodyHeight).Background(theme.Bg).Render(pane)

	dividerLine := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render("│")
	dividerLines := make([]string, bodyHeight)
	for i := range dividerLines {
		dividerLines[i] = dividerLine
	}
	divider := strings.Join(dividerLines, "\n")

	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebarPadded, divider, diffPadded)
	out := lipgloss.JoinVertical(lipgloss.Left, top, body, keybar)

	if notice := m.noticeText(); notice != "" {
		out = lipgloss.JoinVertical(lipgloss.Left, out, renderNoticeStrip(notice, m.width))
	}
	if m.modal != nil {
		out = renderMissionModal(out, m.modal, m.width, m.height, lipgloss.Height(top))
	}
	if m.menu != nil {
		out = m.menu.Render(out, m.width)
	}

	v := tea.NewView(out)
	v.AltScreen = true
	// The whole board is hover-driven (row/segment/diff-line/modal-row
	// treatments all key off mouseMotion), and MouseModeCellMotion only
	// reports movement while a button is held, so hover needs AllMotion
	// explicitly -- session's wireMouse decorator defers to whatever mode
	// is already set here rather than overwriting it.
	v.MouseMode = tea.MouseModeAllMotion
	// bubbletea's renderer optimizes trailing styled blanks by erasing to
	// end-of-line rather than emitting every styled space, and an erased
	// cell paints the TERMINAL's own default background, not whatever SGR
	// the erased content carried. Per-row Bg/BgSubtle fills alone can't
	// survive that erase, so the frame's own terminal background is set
	// here too: with it in place, anything the renderer erases or never
	// touches still resolves to theme.Bg instead of the terminal's own
	// default.
	v.BackgroundColor = theme.Bg
	return v
}

// ─── mouse ──────────────────────────────────────────────────────────────
//
// wheelStep mirrors the picker's own wheelStep (mouse.go): how many rows one
// wheel tick moves a cursor-driven pane. doubleClickWindow mirrors the
// picker's doubleClickWindow: how close together two clicks on the same
// file row have to land to read as a double click rather than two singles.
const (
	wheelStep         = 3
	doubleClickWindow = 400 * time.Millisecond
)

// hitKind identifies what a frame coordinate resolved to. Zero value
// (hitNone) is "nothing here" -- blank chrome, a border line, a rule.
type hitKind int

const (
	hitNone hitKind = iota
	hitTopbar
	hitTab
	hitFilterRow
	hitFileCheckbox
	hitFileRow
	hitStash
	hitCommitSummary
	hitCommitDescription
	hitCommitButton
	hitUndoChip
	hitDiffGutter
	hitDiffLine
	hitModalRow
	hitModalAction
	hitModalOutside
	hitCommitRow
	hitHistoryFile
	hitHistoryExpander
	hitHistoryMore
)

// hit is hitTest's result: idx is a Changes/Diff.Lines/modal-matches/History
// commit index depending on kind (for hitTab, 0 is Changes and 1 History),
// zone is topbar.go's own segment enum for hitTopbar.
type hit struct {
	kind hitKind
	idx  int
	zone zoneID
}

// hitTest resolves one frame coordinate (0,0 the frame's own top-left,
// matching how bubbletea v2 already reports inline mouse coordinates -- see
// the picker's own hitZones.at comment) to whatever is painted there, using
// the exact same geometry View built the current frame from. A modal open
// claims every coordinate: nothing underneath it is reachable while it is
// up, the same as the picker's own modal-first mouse routing.
func (m *Mission) hitTest(x, y int) hit {
	if m.modal != nil {
		return m.modalHitTest(x, y)
	}
	l := m.layout()
	if y < l.topH {
		zone := topbarHit(m.width, x)
		if zone == zoneNone {
			return hit{}
		}
		return hit{kind: hitTopbar, zone: zone}
	}
	bodyY := y - l.topH
	if bodyY >= l.bodyH {
		return hit{}
	}
	switch {
	case x < sidebarWidth && m.historyTab():
		return m.historySidebarHit(x, bodyY, l.listRegionH)
	case x < sidebarWidth:
		return m.sidebarHit(x, bodyY, l.listRegionH)
	case x == sidebarWidth:
		return hit{}
	case m.historyTab():
		return m.historyPaneHit(x-sidebarWidth-1, bodyY)
	default:
		return m.diffHit(x-sidebarWidth-1, bodyY, m.diffWidth())
	}
}

// topbarHit mirrors renderTopBar's own column math (topbar.go) exactly: the
// repo segment at the locked sidebarWidth, worktree and branch splitting the
// remainder evenly, the action segment absorbing what's left, a 1-column
// divider between each.
func topbarHit(width, x int) zoneID {
	const dividers = 3
	remaining := width - sidebarWidth - dividers
	if remaining < 0 {
		remaining = 0
	}
	segW := remaining / 3
	lastW := remaining - segW*2

	if x < sidebarWidth {
		return zoneRepo
	}
	x -= sidebarWidth + 1
	if x < 0 {
		return zoneNone
	}
	if x < segW {
		return zoneWorktree
	}
	x -= segW + 1
	if x < 0 {
		return zoneNone
	}
	if x < segW {
		return zoneBranch
	}
	x -= segW + 1
	if x < 0 || x >= lastW {
		return zoneNone
	}
	return zoneAction
}

// sidebarHit walks renderSidebar's own row sequence (mission.go) in lockstep
// to map a body-relative (x, y) to whichever row painted there -- the same
// "recompute the pure layout a second time" approach hitTest takes for the
// top bar and the diff pane, rather than recording zones as a render side
// effect. listRegionH is layout()'s own listRegionH: the Changes list is a
// fixed-height scrolling region (renderChangesList/m.changesTop), so a click
// inside it maps through the same scroll offset the last render left there,
// and the docked block always starts exactly listRegionH rows after the
// list begins, scrolled or not.
func (m *Mission) sidebarHit(x, y, listRegionH int) hit {
	row := 0
	// All three tab-strip rows are the tabs button; hover and click must cover
	// exactly the same rows (renderTabsRow's own invariant comment).
	if y < row+3 {
		return tabsHit(sidebarWidth, x)
	}
	row += 3
	if y == row {
		return hit{} // the tabs-gap blank band row: no click target
	}
	row++
	if y < row+3 {
		return hit{kind: hitFilterRow}
	}
	row += 3
	if y == row {
		return hit{} // master row: no wire affordance to toggle select-all yet
	}
	row++
	if y < row+listRegionH {
		idx := m.changesTop + (y - row)
		if idx < len(m.model.Changes) {
			return fileRowHit(m.model.Changes[idx], idx, x)
		}
		return hit{} // filler row below the last visible change: no click target
	}
	row += listRegionH
	if m.model.StashCount > 0 {
		if y == row {
			return hit{kind: hitStash}
		}
		row++
	}
	row++ // the rule line above the commit box: never a hit target
	if m.amendLocal {
		if y == row {
			return hit{} // amend banner: no click target
		}
		row++
	}
	row++ // the commit box's own top-padding blank band row: no click target
	if y >= row && y < row+3 {
		return hit{kind: hitCommitSummary}
	}
	row += 3
	if y >= row && y < row+4 {
		return hit{kind: hitCommitDescription}
	}
	row += 4
	row++ // the gap row between the description box and the button: no click target
	// The button is a fixed THREE-row unit now (a half-block cap row above
	// and below the solid label row, ratified 2026-09-20's sub-cell-height
	// treatment): all three resolve to the same hit target.
	if y >= row && y < row+3 {
		return hit{kind: hitCommitButton}
	}
	row += 3
	if lc := m.model.Commit.LastCommit; lc != nil && lc.Undoable && y == row {
		return hit{kind: hitUndoChip}
	}
	return hit{}
}

// tabsHit mirrors renderTabsRow's own half-width Changes/History split
// (changes.go) on the Changes tab: a click anywhere in the left half is inert
// (Changes is already the active tab), a click anywhere in the right half
// resolves to History.
func tabsHit(width, x int) hit {
	if x < width/2 {
		return hit{}
	}
	return hit{kind: hitTab, idx: 1}
}

// fileRowHit mirrors renderChangeRow's own checkbox column span
// (changes.go's changeRowCheckboxSpan) to tell a checkbox click from the
// rest of the row.
func fileRowHit(c ChangeRow, idx, x int) hit {
	start, end := changeRowCheckboxSpan(c)
	if x >= start && x < end {
		return hit{kind: hitFileCheckbox, idx: idx}
	}
	return hit{kind: hitFileRow, idx: idx}
}

// diffHit mirrors renderDiffLines' own header-then-lines layout (diff.go):
// diffX is relative to the diff pane's own left edge, paneW is the width the
// pane was rendered at, y=0 is the header (no click target yet), and every
// line after it maps through the same diffTop/window math the last render
// left on m.diffTop. A hunk line has no separate gutter -- its whole width
// IS the toggle, per diff.go's own renderDiffLine comment -- so it resolves
// to hitDiffGutter across the full content width instead of just
// diffGutterWidth. A read-only diff toggles nothing, so every line is a
// plain hitDiffLine.
func (m *Mission) diffHit(diffX, y, paneW int) hit {
	if y == 0 {
		return hit{}
	}
	lines := m.model.Diff.Lines
	idx := m.diffTop + (y - 1)
	if idx < 0 || idx >= len(lines) {
		return hit{}
	}
	contentW := paneW - 1 // the scroll thumb's own reserved column
	if diffX < 0 || diffX >= contentW {
		return hit{}
	}
	if m.model.Diff.ReadOnly {
		return hit{kind: hitDiffLine, idx: idx}
	}
	if lines[idx].Kind == "hunk" || diffX < diffGutterWidth {
		return hit{kind: hitDiffGutter, idx: idx}
	}
	return hit{kind: hitDiffLine, idx: idx}
}

// modalHitTest walks modalBoxLines' own line sequence (modal.go) in
// lockstep -- filter line, top rule, each match row (with its own leading
// group header when the zone labels groups), the action row's rule and
// line, the closing rule and this foldout's own keybar -- to map a frame
// coordinate to a match index without modal.go itself ever recording a zone.
// The trailing rule and keybar carry no click target, so nothing past the
// action row needs its own cursor bookkeeping: nothing left can match li.
// modalHitTest maps a frame coordinate against the SAME fixed-height,
// scroll-windowed geometry modalBoxLines paints (modal.go): the box now
// always spans from its anchor row to the frame's own last row, so a click
// past the row region's own displayLines resolves to the pinned bottom
// block (action/keybar) rather than there being nothing left to hit.
func (m *Mission) modalHitTest(x, y int) hit {
	ms := m.modal
	inner := modalInnerWidth(ms, m.width)
	boxW := inner + 2
	bx := clampX(segmentOrigin(ms.zone, m.width), boxW, m.width)
	by := m.layout().topH
	boxH := m.height - by
	if x < bx || x >= bx+boxW || y < by || y >= by+boxH {
		return hit{kind: hitModalOutside}
	}
	li := y - by - 1 // -1 for the box's own top border
	boxInnerHeight := boxH - 2
	if li < 0 || li >= boxInnerHeight {
		return hit{}
	}

	switch li {
	case 0: // filter line
		return hit{}
	case 1: // top rule
		return hit{}
	}

	above, below := modalFixedRows(ms)
	rowRegionH := boxInnerHeight - above - below
	if rowRegionH < 0 {
		rowRegionH = 0
	}
	rowLocal := li - above
	if rowLocal >= 0 && rowLocal < rowRegionH {
		displayLines := modalDisplayLines(ms)
		idx := ms.scrollTop + rowLocal
		if idx < len(displayLines) && displayLines[idx].header == "" {
			return hit{kind: hitModalRow, idx: displayLines[idx].matchIdx}
		}
		return hit{} // a header row or filler past the list: no click target
	}

	afterRegion := li - above - rowRegionH
	if ms.action != nil {
		switch afterRegion {
		case 0: // the rule above the action row
			return hit{}
		case 1:
			return hit{kind: hitModalAction}
		}
		afterRegion -= 2
	}
	if afterRegion == 0 { // the closing rule
		return hit{}
	}
	return hit{} // the keybar: no click target
}

// mouseClick dispatches a button press against whatever hitTest resolves it
// to. An open menu takes every press: its own rows, or a close from outside
// it. The right button opens a row's menu at the pointer; every other kind
// is a left-click's concern.
func (m *Mission) mouseClick(msg tea.MouseClickMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	if m.menu != nil {
		return m.runMenuOutcome(m.menu.Click(mouse.X, mouse.Y))
	}
	// The notice strip shortens the body, so the hit resolves against the
	// frame that painted it before clearing it changes the geometry.
	h := m.hitTest(mouse.X, mouse.Y)
	m.localNotice = ""
	if mouse.Button == tea.MouseRight {
		return m.rightClick(h, &picker.MenuAnchor{X: mouse.X, Y: mouse.Y})
	}
	if mouse.Button != tea.MouseLeft {
		return m, nil
	}
	switch h.kind {
	case hitTopbar:
		return m.clickTopbar(h.zone)
	case hitTab:
		if h.idx == 1 {
			return m, m.emitTab("history")
		}
		return m, m.emitTab("changes")
	case hitCommitRow:
		return m.clickCommitRow(h.idx, mouse.Mod&tea.ModShift != 0)
	case hitHistoryFile:
		return m.clickHistoryFile(h.idx)
	case hitHistoryMore:
		return m, m.requestMore()
	case hitHistoryExpander:
		m.historyExpanded = !m.historyExpanded
	case hitFilterRow:
		m.focus = focusFilter
		if !m.historyTab() {
			m.filterText = m.model.Filter
		}
	case hitFileCheckbox:
		return m.clickCheckbox(h.idx)
	case hitFileRow:
		return m.clickFileRow(h.idx)
	case hitStash:
		m.localNotice = "Stash foldout lands in v2"
	case hitCommitSummary:
		m.focus = focusSummary
		return m, m.summaryInput.Focus()
	case hitCommitDescription:
		m.focus = focusDescription
		return m, m.descriptionInput.Focus()
	case hitCommitButton:
		return m.clickCommitButton()
	case hitUndoChip:
		return m, m.em.Emit(protocol.Intent{Name: "mission:undo"})
	case hitDiffGutter:
		m.focus = focusDiff
		m.diffCursor = h.idx
		return m, m.diffClickIntent(h.idx)
	case hitDiffLine:
		m.focus = focusDiff
		m.diffCursor = h.idx
	case hitModalRow, hitModalAction:
		return m.clickModalRow(h)
	case hitModalOutside:
		m.closeModal()
	}
	return m, nil
}

// rightClick moves the cursor to the row first, as a left-click would, then
// opens that row's menu at the pointer. A right-click with a foldout open only
// closes it; inside a range selection it keeps the range and opens the
// board-wide section alone.
func (m *Mission) rightClick(h hit, anchor *picker.MenuAnchor) (tea.Model, tea.Cmd) {
	if m.modal != nil {
		m.closeModal()
		return m, nil
	}
	switch h.kind {
	case hitFileRow, hitFileCheckbox:
		model, cmd := m.clickFileRow(h.idx)
		// A right-click is never the first half of a double click.
		m.lastClickPath = ""
		m.openMenu(m.changeTarget(m.selected), anchor)
		return model, cmd
	case hitCommitRow:
		if m.historyRange() && m.historyInSelection(h.idx) {
			m.openMenu(menuTarget{}, anchor)
			return m, nil
		}
		model, cmd := m.clickCommitRow(h.idx, false)
		m.openMenu(m.commitTarget(h.idx), anchor)
		return model, cmd
	case hitHistoryFile:
		model, cmd := m.clickHistoryFile(h.idx)
		m.openMenu(m.historyFileTarget(m.model.History.Files[h.idx].Path), anchor)
		return model, cmd
	}
	return m, nil
}

func (m *Mission) clickTopbar(zone zoneID) (tea.Model, tea.Cmd) {
	switch zone {
	case zoneRepo:
		return m.openRepoModal()
	case zoneWorktree:
		return m.openWorktreeModal()
	case zoneBranch:
		return m.openBranchModal()
	case zoneAction:
		return m, m.em.Emit(protocol.Intent{Name: "mission:action"})
	}
	return m, nil
}

// clickFileRow moves the cursor to idx's row, then checks whether this
// arrived within doubleClickWindow of the previous click on that same row --
// mirroring the picker's own clickRow, keyed on path rather than index since
// a filter or model refresh can shift indices under an unchanged path.
func (m *Mission) clickFileRow(idx int) (tea.Model, tea.Cmd) {
	if idx < 0 || idx >= len(m.model.Changes) {
		return m, nil
	}
	path := m.model.Changes[idx].Path
	now := m.now()
	isDouble := path == m.lastClickPath && !m.lastClickAt.IsZero() && now.Sub(m.lastClickAt) <= doubleClickWindow

	prev := m.selected
	m.selected = path
	m.focus = focusList
	if isDouble {
		m.lastClickPath = ""
		m.lastClickAt = time.Time{}
		m.focus = focusDiff
		return m, m.selectPathCmd(prev)
	}
	m.lastClickPath = path
	m.lastClickAt = now
	return m, m.selectPathCmd(prev)
}

// clickCheckbox always emits the row's stage intent; when the click also
// lands on a row that wasn't already selected, it batches a select intent
// alongside it (mirroring clickFileRow's own selectPathCmd) so the diff pane
// loads that file immediately instead of waiting for the next row click or
// arrow key.
func (m *Mission) clickCheckbox(idx int) (tea.Model, tea.Cmd) {
	if idx < 0 || idx >= len(m.model.Changes) {
		return m, nil
	}
	path := m.model.Changes[idx].Path
	prev := m.selected
	m.selected = path
	m.focus = focusList
	return m, tea.Batch(m.stageIntent(path, "toggle-file"), m.selectPathCmd(prev))
}

func (m *Mission) clickCommitButton() (tea.Model, tea.Cmd) {
	return m.emitCommit()
}

// diffClickIntent resolves idx through the exact same resolver space/enter
// on the keyboard cursor uses (diff.go's resolveStageTarget): a normal line
// stages itself, a hunk header stages its hunk, and a context line (ok
// false) never emits.
func (m *Mission) diffClickIntent(idx int) tea.Cmd {
	mode, selIdx, ok := resolveStageTarget(m.model.Diff.Lines, idx)
	if !ok {
		return nil
	}
	payload := diffStagePayload{Path: m.model.Diff.Path, Mode: mode, SelIdx: selIdx}
	return m.em.Emit(protocol.Intent{Name: "mission:stage", Payload: mustPayload(payload)})
}

// clickModalRow sets the overlay's own cursor to the clicked slot and runs
// it through selectModalRow -- the exact path enter takes -- so a guarded
// row's refusal is selectedRow's decision alone, never duplicated here.
func (m *Mission) clickModalRow(h hit) (tea.Model, tea.Cmd) {
	ms := m.modal
	if h.kind == hitModalAction {
		if ms.action == nil {
			return m, nil
		}
		ms.cursor = len(ms.matches)
	} else {
		ms.cursor = h.idx
	}
	return m.selectModalRow()
}

// mouseMotion tracks whichever region hitTest resolves the pointer to as a
// render hint only: it never moves diffCursor, selected, or the modal's own
// cursor, the same row/cursor split the picker's own handleMouseMotion
// established (mouse.go).
func (m *Mission) mouseMotion(msg tea.MouseMotionMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	if m.menu != nil {
		m.menu.Motion(mouse.X, mouse.Y)
		return m, nil
	}
	m.setHover(mouse.X, mouse.Y)
	return m, nil
}

// setHover points every hover field at whatever hitTest resolves (x, y) to,
// clearing the rest.
func (m *Mission) setHover(x, y int) {
	m.hoverZone = zoneNone
	m.hoverFile = -1
	m.hoverDiffLine = -1
	m.hoverGutter = false
	m.hoverCommitButton = false
	m.hoverTab = false
	m.hoverFilterRow = false
	m.hoverCommitSummary = false
	m.hoverCommitDescription = false
	m.hoverStash = false
	m.hoverUndoChip = false
	m.hoverCommit = -1
	m.hoverHistoryMore = false
	m.hoverHistoryFile = -1
	m.hoverExpander = false
	if m.modal != nil {
		m.modal.hoverRow = -1
		m.modal.hoverAction = false
	}
	switch h := m.hitTest(x, y); h.kind {
	case hitTopbar:
		m.hoverZone = h.zone
	case hitFileRow, hitFileCheckbox:
		m.hoverFile = h.idx
	case hitDiffLine:
		m.hoverDiffLine = h.idx
	case hitDiffGutter:
		m.hoverDiffLine = h.idx
		m.hoverGutter = true
	case hitModalRow:
		m.modal.hoverRow = h.idx
	case hitModalAction:
		m.modal.hoverAction = true
	case hitCommitButton:
		m.hoverCommitButton = true
	case hitTab:
		m.hoverTab = true
	case hitCommitRow:
		m.hoverCommit = h.idx
	case hitHistoryMore:
		m.hoverHistoryMore = true
	case hitHistoryFile:
		m.hoverHistoryFile = h.idx
	case hitHistoryExpander:
		m.hoverExpander = true
	case hitFilterRow:
		m.hoverFilterRow = true
	case hitCommitSummary:
		m.hoverCommitSummary = true
	case hitCommitDescription:
		m.hoverCommitDescription = true
	case hitStash:
		m.hoverStash = true
	case hitUndoChip:
		m.hoverUndoChip = true
	}
}

// mouseWheel scrolls whichever pane the pointer sits over: the modal's own
// cursor (skipping a guarded row, like its keyboard up/down), the diff
// pane's line cursor, or the Changes list's row cursor, each moving the same
// cursor the arrow keys do. The History commit list is the exception: the
// wheel scrolls its view and never its selection (historyScroll). An open
// menu makes the wheel inert (it has no scroll region). A modal
// claims every row like hitTest's own first check; otherwise the tick must
// land inside the body's Y range (between the topbar and the keybar/notice
// strip) -- mirroring hitTest's bodyY bound -- or a tick over the
// keybar/notice row would otherwise nudge a cursor nothing under the pointer
// owns.
func (m *Mission) mouseWheel(msg tea.MouseWheelMsg) (tea.Model, tea.Cmd) {
	mouse := msg.Mouse()
	var delta int
	switch mouse.Button {
	case tea.MouseWheelUp:
		delta = -wheelStep
	case tea.MouseWheelDown:
		delta = wheelStep
	default:
		return m, nil
	}
	if m.menu != nil {
		return m, nil
	}
	if m.modal != nil {
		step := 1
		if delta < 0 {
			step = -1
		}
		m.modal.moveCursor(step)
		return m, nil
	}
	l := m.layout()
	bodyY := mouse.Y - l.topH
	if bodyY < 0 || bodyY >= l.bodyH {
		return m, nil
	}
	if mouse.X >= sidebarWidth {
		if m.historyTab() {
			return m, m.historyWheel(mouse.X-sidebarWidth-1, bodyY, delta)
		}
		m.moveDiffCursor(delta)
		return m, nil
	}
	if m.historyTab() {
		if bodyY >= historyFixedTopRows {
			m.historyScroll(delta)
			m.setHover(mouse.X, mouse.Y)
		}
		return m, nil
	}
	return m, m.cursorSelectCmd(delta)
}
