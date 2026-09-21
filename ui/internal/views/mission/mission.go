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
)

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

	// lastClickPath/lastClickAt pair a file row's two clicks into a double
	// click (focuses the diff) the same way the picker's own clickRow does
	// for its list; nowFn overrides the clock in tests, nil meaning
	// time.Now.
	lastClickPath string
	lastClickAt   time.Time
	nowFn         func() time.Time
}

func New(em *session.Emitter) *Mission {
	return &Mission{
		em:               em,
		reason:           session.ReasonClosed,
		summaryInput:     newTextInput("", commitBoxInner),
		descriptionInput: newTextInput("Description", commitBoxInner),
		hoverFile:        -1,
		hoverDiffLine:    -1,
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
	m.model = decoded
	m.clampSelection()
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
	case session.CloseRequest:
		m.reason = session.ReasonClosed
		return m, tea.Quit
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
		switch m.focus {
		case focusModal:
			return m.modalKey(v)
		case focusFilter:
			return m.filterKey(v)
		case focusSummary, focusDescription:
			return m.commitKey(v)
		case focusDiff:
			return m.diffKey(v)
		default:
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

// cursorSelectCmd moves the Changes cursor by delta; landing on a different
// row emits that row's mission:select so the driver loads its diff.
func (m *Mission) cursorSelectCmd(delta int) tea.Cmd {
	prev := m.selected
	m.moveCursor(delta)
	return m.selectPathCmd(prev)
}

func (m *Mission) selectPathCmd(prev string) tea.Cmd {
	if m.selected == prev || m.selected == "" {
		return nil
	}
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
// Changes list: tabs(2) + the tabs-gap blank band row(1) + the filter
// box(3) + the master row(1) (docs/design/mission/README.md's Terminal
// geometry table). Unlike the old content-driven top block, this never
// varies with the Changes count -- the list itself is now a fixed-height
// scrolling region, not a block that grows the whole sidebar.
const sidebarFixedTopRows = 7

func (m *Mission) sidebarFixedTop(width int) string {
	return lipgloss.JoinVertical(lipgloss.Left,
		renderTabsRow(m.model.ChangedTotal, width),
		blankRows(width, 1),
		renderFilterRow(m.filterDisplayText(), m.focus == focusFilter, width),
		renderMasterRow(m.model.ChangedTotal, m.model.StagedTotal, width),
	)
}

// sidebarDocked is the bottom-pinned block: stash strip, rule, commit box,
// undo strip.
func (m *Mission) sidebarDocked(width int) string {
	var docked []string
	if m.model.StashCount > 0 {
		docked = append(docked, renderStashStrip(m.model.StashCount, width))
	}
	docked = append(docked, lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render(strings.Repeat("─", width)))
	docked = append(docked, renderCommitBox(width, m.summaryInput.View(), m.descriptionInput.View(), m.amendLocal, m.model.Commit.ButtonLabel, m.commitEnabled()))
	if lc := m.model.Commit.LastCommit; lc != nil && lc.Undoable {
		docked = append(docked, renderUndoStrip(*lc, width))
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
// Bg-filler or scrolled past); sidebarFillerH is how many of those rows are
// filler (0 once the list is long enough to scroll).
type frameLayout struct {
	topH, bodyH, keybarH, noticeH               int
	sidebarTopH, sidebarDockedH, sidebarFillerH int
	listRegionH                                 int
}

func (m *Mission) layout() frameLayout {
	l := frameLayout{
		topH:    lipgloss.Height(renderTopBar(m.model, m.width, m.hoverZone, m.openZone())),
		keybarH: lipgloss.Height(renderKeybar(m.width)),
	}
	if m.noticeText() != "" {
		l.noticeH = 1
	}
	l.sidebarTopH = sidebarFixedTopRows
	l.sidebarDockedH = lipgloss.Height(m.sidebarDocked(sidebarWidth))
	natural := l.sidebarTopH + l.sidebarDockedH
	l.bodyH = m.height - l.topH - l.keybarH - l.noticeH
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
	keybar := renderKeybar(m.width)
	l := m.layout()
	bodyHeight := l.bodyH

	sidebarPadded := m.renderSidebar(sidebarWidth, bodyHeight)
	diffPadded := lipgloss.NewStyle().Width(diffW).Height(bodyHeight).Background(theme.Bg).Render(m.renderDiffPane(diffW, bodyHeight))

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

	v := tea.NewView(out)
	v.AltScreen = true
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
	hitTabHistory
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
)

// hit is hitTest's result: idx is a Changes/Diff.Lines/modal-matches index
// depending on kind, zone is topbar.go's own segment enum for hitTopbar.
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
	case x < sidebarWidth:
		return m.sidebarHit(x, bodyY, l.listRegionH)
	case x == sidebarWidth:
		return hit{}
	default:
		return m.diffHit(x-sidebarWidth-1, bodyY)
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
	if y < row+2 {
		return tabsHit(sidebarWidth, x)
	}
	row += 2
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
// (changes.go): a click anywhere in the left half is inert (Changes is
// already the active tab), a click anywhere in the right half resolves to
// History.
func tabsHit(width, x int) hit {
	if x < width/2 {
		return hit{}
	}
	return hit{kind: hitTabHistory}
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
// diffX is relative to the diff pane's own left edge, y=0 is the header (no
// click target yet), and every line after it maps through the same
// diffTop/window math the last render left on m.diffTop. A hunk line has no
// separate gutter -- its whole width IS the toggle, per diff.go's own
// renderDiffLine comment -- so it resolves to hitDiffGutter across the full
// content width instead of just diffGutterWidth.
func (m *Mission) diffHit(diffX, y int) hit {
	if y == 0 {
		return hit{}
	}
	lines := m.model.Diff.Lines
	idx := m.diffTop + (y - 1)
	if idx < 0 || idx >= len(lines) {
		return hit{}
	}
	contentW := m.diffWidth() - 1 // the scroll thumb's own reserved column
	if diffX < 0 || diffX >= contentW {
		return hit{}
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
	inner := modalWidth(ms, m.width)
	if maxInner := m.width - 2; inner > maxInner {
		inner = maxInner
	}
	if inner < 1 {
		inner = 1
	}
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
// to. The right button only ever opens the file-row context notice; every
// other kind is a left-click's concern.
func (m *Mission) mouseClick(msg tea.MouseClickMsg) (tea.Model, tea.Cmd) {
	m.localNotice = ""
	mouse := msg.Mouse()
	h := m.hitTest(mouse.X, mouse.Y)
	if mouse.Button == tea.MouseRight {
		if h.kind == hitFileRow || h.kind == hitFileCheckbox {
			m.localNotice = "menu lands with polish"
		}
		return m, nil
	}
	if mouse.Button != tea.MouseLeft {
		return m, nil
	}
	switch h.kind {
	case hitTopbar:
		return m.clickTopbar(h.zone)
	case hitTabHistory:
		m.localNotice = "History lands in v2"
	case hitFilterRow:
		m.focus = focusFilter
		m.filterText = m.model.Filter
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
	m.hoverZone = zoneNone
	m.hoverFile = -1
	m.hoverDiffLine = -1
	m.hoverGutter = false
	if m.modal != nil {
		m.modal.hoverRow = -1
		m.modal.hoverAction = false
	}
	switch h := m.hitTest(mouse.X, mouse.Y); h.kind {
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
	}
	return m, nil
}

// mouseWheel scrolls whichever pane the pointer sits over: the modal's own
// cursor (skipping a guarded row, like its keyboard up/down), the diff
// pane's line cursor, or the base list's row cursor -- there being no
// scroll offset independent of the cursor in any of the three today, a
// wheel tick moves the same cursor the arrow keys do. A modal claims every
// row like hitTest's own first check; otherwise the tick must land inside
// the body's Y range (between the topbar and the keybar/notice strip) --
// mirroring hitTest's bodyY bound -- or a tick over the keybar/notice row
// would otherwise nudge a cursor nothing under the pointer owns.
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
		m.moveDiffCursor(delta)
		return m, nil
	}
	return m, m.cursorSelectCmd(delta)
}
