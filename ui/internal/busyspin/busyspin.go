// Package busyspin is the spinner every view paints for work in flight. It
// ticks only while its view reports something busy, so an idle view runs no
// timer at all.
package busyspin

import (
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/theme"
)

// Spinner is one view's busy glyph. running is true while a tick is in
// flight, so a busy stretch that starts before the last tick lands never
// starts a second chain, and it clears only when a tick lands with nothing
// busy, which is where a chain ends.
type Spinner struct {
	model   spinner.Model
	running bool
}

func New() Spinner {
	return Spinner{model: spinner.New(spinner.WithSpinner(theme.Spinner()))}
}

// Start begins a fresh chain on frame 0 when busy and no chain is running.
// The fresh spinner.Model carries a new ID, so a tick from an earlier chain
// can never advance this one.
func (s *Spinner) Start(busy bool) tea.Cmd {
	if s.running || !busy {
		return nil
	}
	s.running = true
	s.model = spinner.New(spinner.WithSpinner(theme.Spinner()))
	return s.model.Tick
}

// Update advances one frame and schedules the next tick while busy.
func (s *Spinner) Update(msg spinner.TickMsg, busy bool) tea.Cmd {
	if !busy {
		s.running = false
		return nil
	}
	var cmd tea.Cmd
	s.model, cmd = s.model.Update(msg)
	return cmd
}

func (s Spinner) View() string { return s.model.View() }
