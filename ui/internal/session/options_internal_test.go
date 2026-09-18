package session

import (
	"encoding/json"
	"testing"

	tea "charm.land/bubbletea/v2"
)

type stubView struct{}

func (stubView) Init() tea.Cmd                       { return nil }
func (stubView) Update(tea.Msg) (tea.Model, tea.Cmd) { return stubView{}, nil }
func (stubView) View() tea.View                      { return tea.NewView("stub") }
func (stubView) SetModel(json.RawMessage) error      { return nil }
func (stubView) Reason() Reason                      { return ReasonClosed }

// TestWireMouseSetsCellMotionOnlyWhenOptedIn locks in the actual v2 lever
// for Options.Mouse: there is no ProgramOption for it (see programOptions),
// so this decorator is the only place the option can take effect.
func TestWireMouseSetsCellMotionOnlyWhenOptedIn(t *testing.T) {
	if got := wireMouse(stubView{}, Options{}).View().MouseMode; got != tea.MouseModeNone {
		t.Fatalf("Mouse false: MouseMode = %v, want None", got)
	}
	if got := wireMouse(stubView{}, Options{Mouse: true}).View().MouseMode; got != tea.MouseModeCellMotion {
		t.Fatalf("Mouse true: MouseMode = %v, want CellMotion", got)
	}
}
