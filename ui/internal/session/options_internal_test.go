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

// allMotionStubView is a View that, like mission.Mission, asks for hover
// motion itself instead of leaving MouseMode at its zero value.
type allMotionStubView struct{ stubView }

func (allMotionStubView) View() tea.View {
	v := tea.NewView("stub")
	v.MouseMode = tea.MouseModeAllMotion
	return v
}

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

// TestMouseViewDefersToAnExplicitMouseMode locks in the other half of
// wireMouse: MouseModeNone is bubbletea's zero value, so a view that sets
// nothing and a view that wants mouse off render identically. This
// decorator only ever wraps a view that opted into Options.Mouse in the
// first place, so it must apply CellMotion only as a default for the
// zero-value case, never clobber a mode the inner view actually chose --
// otherwise a view that asks for AllMotion (mission, to get hover) never
// gets it.
func TestMouseViewDefersToAnExplicitMouseMode(t *testing.T) {
	if got := wireMouse(allMotionStubView{}, Options{Mouse: true}).View().MouseMode; got != tea.MouseModeAllMotion {
		t.Fatalf("inner AllMotion: MouseMode = %v, want AllMotion", got)
	}
	if got := wireMouse(stubView{}, Options{Mouse: true}).View().MouseMode; got != tea.MouseModeCellMotion {
		t.Fatalf("inner unset: MouseMode = %v, want CellMotion default", got)
	}
}
