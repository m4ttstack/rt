// Package mission is the mission-control view skeleton: it decodes the
// Current checkout out of the wire model and quits on q, ahead of the full
// board Task 3 adds.
package mission

import (
	"encoding/json"
	"fmt"

	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/session"
)

type Mission struct {
	em     *session.Emitter
	model  Model
	raw    json.RawMessage
	width  int
	height int
	reason session.Reason
}

func New(em *session.Emitter) *Mission {
	return &Mission{em: em, reason: session.ReasonClosed}
}

func (m *Mission) SetModel(raw json.RawMessage) error {
	decoded, err := decode(raw)
	if err != nil {
		return err
	}
	m.model = decoded
	m.raw = raw
	return nil
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
		switch v.String() {
		case "q", "ctrl+c":
			return m.quit()
		}
	}
	return m, nil
}

func (m *Mission) quit() (tea.Model, tea.Cmd) {
	m.reason = session.ReasonQuit
	return m, tea.Sequence(m.em.Emit(protocol.Intent{Name: "quit"}), tea.Quit)
}

func (m *Mission) View() tea.View {
	v := tea.NewView(fmt.Sprintf("mission · %s @ %s", m.model.Current.Repo, m.model.Current.Branch))
	v.AltScreen = true
	return v
}
