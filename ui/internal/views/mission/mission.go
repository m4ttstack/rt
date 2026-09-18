// Package mission is the mission-control view: the top bar, the Changes
// sidebar, the commit box, and the keybar, driven off the Current checkout
// wire model. The diff pane itself is a placeholder until a later task.
package mission

import (
	"encoding/json"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/session"
	"rt-ui/internal/theme"
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
	// reordered or filtered list.
	selected string

	focus            focusKind
	filterText       string
	amendLocal       bool
	summaryInput     textinput.Model
	descriptionInput textinput.Model
}

func New(em *session.Emitter) *Mission {
	return &Mission{
		em:               em,
		reason:           session.ReasonClosed,
		summaryInput:     newCommitInput(""),
		descriptionInput: newCommitInput("Description"),
	}
}

// newCommitInput builds a commit-box textinput themed to the rt palette:
// Pink cursor, Faint placeholder, no prompt glyph (the box border is the
// only chrome).
func newCommitInput(placeholder string) textinput.Model {
	ti := textinput.New()
	ti.Prompt = ""
	ti.CharLimit = 0
	ti.Placeholder = placeholder
	ti.SetWidth(commitBoxInner)
	styles := ti.Styles()
	styles.Focused.Text = lipgloss.NewStyle().Foreground(theme.Text)
	styles.Focused.Placeholder = lipgloss.NewStyle().Foreground(theme.Faint)
	styles.Blurred.Text = lipgloss.NewStyle().Foreground(theme.Text)
	styles.Blurred.Placeholder = lipgloss.NewStyle().Foreground(theme.Faint)
	styles.Cursor.Color = theme.Pink
	ti.SetStyles(styles)
	return ti
}

// editingCommit reports whether the user is actively composing a commit:
// SetModel leaves the summary/description/amend fields alone while this is
// true so a background model refresh cannot clobber an unsent draft.
func (m *Mission) editingCommit() bool {
	return m.focus == focusSummary || m.focus == focusDescription
}

func (m *Mission) SetModel(raw json.RawMessage) error {
	decoded, err := decode(raw)
	if err != nil {
		return err
	}
	m.model = decoded
	m.clampSelection()
	if m.focus != focusSummary {
		m.summaryInput.SetValue(m.model.Commit.Summary)
		m.summaryInput.Placeholder = m.model.Commit.Placeholder
	}
	if m.focus != focusDescription {
		m.descriptionInput.SetValue(m.model.Commit.Description)
	}
	if !m.editingCommit() {
		m.amendLocal = m.model.Commit.Amending
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
	case tea.KeyPressMsg:
		if v.String() == "ctrl+c" {
			return m.quit()
		}
		switch m.focus {
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
		m.moveCursor(-1)
	case "down":
		m.moveCursor(1)
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
	case "b", "w", "r":
		// The branch/worktree/repo modals land in a later task; the key is
		// reserved but does nothing yet.
	case "q":
		return m.quit()
	}
	return m, nil
}

func (m *Mission) diffKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "esc":
		m.focus = focusList
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
		if !m.model.Commit.CanCommit {
			return m, nil
		}
		payload := commitPayload{
			Summary:     m.summaryInput.Value(),
			Description: m.descriptionInput.Value(),
			Amend:       m.amendLocal,
		}
		return m, m.em.Emit(protocol.Intent{Name: "mission:commit", Payload: mustPayload(payload)})
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

func (m *Mission) renderSidebar(width int) string {
	rows := []string{
		renderTabsRow(m.model.ChangedTotal, width),
		renderFilterRow(m.filterDisplayText(), m.focus == focusFilter, width),
		renderMasterRow(m.model.ChangedTotal, m.model.StagedTotal, width),
	}
	for _, c := range m.model.Changes {
		rows = append(rows, renderChangeRow(c, width, c.Path == m.selected))
	}
	if m.model.StashCount > 0 {
		rows = append(rows, renderStashStrip(m.model.StashCount, width))
	}
	rows = append(rows, fg(theme.Rule).Render(strings.Repeat("─", width)))
	rows = append(rows, renderCommitBox(width, m.summaryInput.View(), m.descriptionInput.View(), m.amendLocal, m.model.Commit.ButtonLabel, m.model.Commit.CanCommit))
	if lc := m.model.Commit.LastCommit; lc != nil && lc.Undoable {
		rows = append(rows, renderUndoStrip(*lc, width))
	}
	return lipgloss.JoinVertical(lipgloss.Left, rows...)
}

// renderDiffPlaceholder stands in for the diff pane until it lands: a
// centered Faint hint that a file needs picking.
func renderDiffPlaceholder(width int) string {
	if width < 1 {
		return ""
	}
	return lipgloss.NewStyle().Width(width).Align(lipgloss.Center).Foreground(theme.Faint).Render("select a file")
}

func (m *Mission) View() tea.View {
	top := renderTopBar(m.model, m.width, zoneNone, zoneNone)
	sidebar := m.renderSidebar(sidebarWidth)
	diffW := m.width - sidebarWidth - 1
	if diffW < 0 {
		diffW = 0
	}
	keybar := renderKeybar(m.width)

	bodyHeight := m.height - lipgloss.Height(top) - lipgloss.Height(keybar)
	if bodyHeight < lipgloss.Height(sidebar) {
		bodyHeight = lipgloss.Height(sidebar)
	}
	sidebarPadded := lipgloss.NewStyle().Height(bodyHeight).Render(sidebar)
	diffPadded := lipgloss.NewStyle().Height(bodyHeight).Render(renderDiffPlaceholder(diffW))

	dividerLine := fg(theme.Rule).Render("│")
	dividerLines := make([]string, bodyHeight)
	for i := range dividerLines {
		dividerLines[i] = dividerLine
	}
	divider := strings.Join(dividerLines, "\n")

	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebarPadded, divider, diffPadded)
	out := lipgloss.JoinVertical(lipgloss.Left, top, body, keybar)

	v := tea.NewView(out)
	v.AltScreen = true
	return v
}
