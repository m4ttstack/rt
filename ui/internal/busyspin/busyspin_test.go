package busyspin

import (
	"testing"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/theme"
)

func tickOf(t *testing.T, cmd tea.Cmd) spinner.TickMsg {
	t.Helper()
	if cmd == nil {
		t.Fatal("no command returned: the spinner is not ticking")
	}
	tick, ok := cmd().(spinner.TickMsg)
	if !ok {
		t.Fatal("the command yielded no spinner tick")
	}
	return tick
}

func TestIdleNeverStarts(t *testing.T) {
	s := New()
	if cmd := s.Start(false); cmd != nil {
		t.Fatal("an idle view must not start a tick chain")
	}
}

func TestBusyStartsOneChain(t *testing.T) {
	s := New()
	tickOf(t, s.Start(true))
	if cmd := s.Start(true); cmd != nil {
		t.Fatal("a second Start while a tick is in flight must not start another chain")
	}
}

func TestTickAdvancesFramesWhileBusy(t *testing.T) {
	s := New()
	tick := tickOf(t, s.Start(true))
	for want := 0; want < len(theme.SpinnerFrames)+1; want++ {
		if got := s.View(); got != theme.SpinnerFrames[want%len(theme.SpinnerFrames)] {
			t.Fatalf("frame %d paints %q, want %q", want, got, theme.SpinnerFrames[want%len(theme.SpinnerFrames)])
		}
		tick = tickOf(t, s.Update(tick, true))
	}
}

func TestIdleTickEndsTheChainAndTheNextStartsOnFrameZero(t *testing.T) {
	s := New()
	tick := tickOf(t, s.Start(true))
	tick = tickOf(t, s.Update(tick, true))
	if cmd := s.Update(tick, false); cmd != nil {
		t.Fatal("a tick landing with nothing busy must end the chain")
	}
	tickOf(t, s.Start(true))
	if got := s.View(); got != theme.SpinnerFrames[0] {
		t.Fatalf("a new chain paints %q, want frame 0 %q", got, theme.SpinnerFrames[0])
	}
}

func TestStaleTickFromAnEndedChainDoesNotAdvanceTheNewOne(t *testing.T) {
	s := New()
	stale := tickOf(t, s.Start(true))
	s.Update(stale, false)
	fresh := tickOf(t, s.Start(true))
	s.Update(stale, true)
	if got := s.View(); got != theme.SpinnerFrames[0] {
		t.Fatalf("a stale tick advanced the new chain to %q", got)
	}
	tickOf(t, s.Update(fresh, true))
	if got := s.View(); got != theme.SpinnerFrames[1] {
		t.Fatalf("the new chain's own tick paints %q, want frame 1 %q", got, theme.SpinnerFrames[1])
	}
}
