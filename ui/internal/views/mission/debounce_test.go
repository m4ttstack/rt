package mission

import (
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

// instantSelectTick replaces selectTick for the duration of a test so a
// debounce settles by directly invoking its callback -- no real sleep --
// which is how these tests drive the generation logic deterministically.
// board.go's own tick (board_test.go) has no equivalent time-driven test to
// follow, so this package supplies its own rather than writing a
// sleep-based test against a real timer, which would be flaky.
func instantSelectTick(t *testing.T) {
	t.Helper()
	prev := selectTick
	selectTick = func(_ time.Duration, fn func(time.Time) tea.Msg) tea.Cmd {
		return func() tea.Msg { return fn(time.Time{}) }
	}
	t.Cleanup(func() { selectTick = prev })
}

func downKey() tea.KeyPressMsg { return tea.KeyPressMsg{Code: tea.KeyDown} }
func upKey() tea.KeyPressMsg   { return tea.KeyPressMsg{Code: tea.KeyUp} }

// TestCursorMoveSchedulesDebounceWithoutEmitting pins the headline behavior:
// a single cursor move returns a debounce tick, not an immediate select --
// distinguishable because selectPathCmd's emit always returns a nil tea.Msg
// (session.Emitter.Emit's own shape) while a scheduled tick returns a typed
// selectDebounceMsg.
func TestCursorMoveSchedulesDebounceWithoutEmitting(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, cmd := m.Update(downKey())
	if cmd == nil {
		t.Fatal("a cursor move must still schedule a debounce tick")
	}
	if m.selected != "b.go" {
		t.Fatalf("cursor movement itself must be instant, got %q", m.selected)
	}
	msg := cmd()
	if _, ok := msg.(selectDebounceMsg); !ok {
		t.Fatalf("cursor move's cmd must resolve to a selectDebounceMsg, not an immediate emit, got %#v", msg)
	}
}

// TestDebounceSettlesToFinalPathAfterOneMove: with nothing else pending, the
// tick's own generation still matches when it fires, so it settles and
// emits the row the cursor landed on.
func TestDebounceSettlesToFinalPathAfterOneMove(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, cmd := m.Update(downKey())
	_, settle := m.Update(cmd())
	if settle == nil {
		t.Fatal("a settled tick whose generation still matches must emit")
	}
	if m.selected != "b.go" {
		t.Fatalf("settled path should be the row the cursor landed on, got %q", m.selected)
	}
}

// TestRapidMovesEmitOnceWithFinalPath drives three quick movements before
// any of their ticks fire, then fires all three ticks in scheduling order
// (as the real timers would, each 150ms after its own move): only the last
// one's generation still matches, so exactly one mission:select goes out,
// carrying the row the cursor actually settled on rather than a row it only
// passed through.
func TestRapidMovesEmitOnceWithFinalPath(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, cmd1 := m.Update(downKey()) // a.go -> b.go
	_, cmd2 := m.Update(downKey()) // b.go -> c.go
	_, cmd3 := m.Update(upKey())   // c.go -> b.go

	_, r1 := m.Update(cmd1())
	if r1 != nil {
		t.Fatal("a superseded tick must be a no-op")
	}
	_, r2 := m.Update(cmd2())
	if r2 != nil {
		t.Fatal("a superseded tick must be a no-op")
	}
	_, r3 := m.Update(cmd3())
	if r3 == nil {
		t.Fatal("the final tick's generation must still match and emit")
	}
	if m.selected != "b.go" {
		t.Fatalf("final settled path should be b.go, got %q", m.selected)
	}
}

// TestReturningToOriginalRowEmitsNothing: the cursor moves away and back
// before the interval elapses, so the settled path equals the one already
// showing and selectPathCmd's own no-op-on-unchanged guard applies -- no
// mission:select at all, not even for the intermediate row.
func TestReturningToOriginalRowEmitsNothing(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, cmd1 := m.Update(downKey()) // a.go -> b.go
	_, cmd2 := m.Update(upKey())   // b.go -> a.go (back where it started)

	_, r1 := m.Update(cmd1())
	if r1 != nil {
		t.Fatal("the superseded first tick must be a no-op")
	}
	_, r2 := m.Update(cmd2())
	if r2 != nil {
		t.Fatal("settling back on the original row must not emit")
	}
}

// TestClickFileRowStillEmitsImmediately pins the click path's exemption:
// clickFileRow calls selectPathCmd directly, with no tick in between. The
// returned cmd is session.Emitter.Emit's own closure (New(nil) in these
// tests leaves em nil), so it is checked for existence only, never called --
// mirroring how the rest of this package's click tests already treat it
// (e.g. TestMouseClickFileRowEmitsOnlyOnRowChange).
func TestClickFileRowStillEmitsImmediately(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	if m.selectPending {
		t.Fatal("no debounce should be pending before the click")
	}
	_, cmd := m.clickFileRow(1)
	if cmd == nil {
		t.Fatal("a click on a different row must emit immediately")
	}
	if m.selectPending {
		t.Fatal("a click must not leave a debounce pending behind it")
	}
}

// TestClickDuringPendingDebounceIsNotDoubleEmitted: a click fires immediately
// while a cursor-move debounce is still in flight. Once the tick from that
// earlier movement fires, its generation is already stale (selectPathCmd's
// own emit bumps selectGen), so it must not fire a second, redundant select
// for a path the click already delivered.
func TestClickDuringPendingDebounceIsNotDoubleEmitted(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, staleTick := m.Update(downKey()) // a.go -> b.go, tick pending

	// The click's own cmd is session.Emitter.Emit's closure (em is nil in
	// this fixture, see clickFileRow's own test above), so it is checked
	// for existence only, never called.
	_, clickCmd := m.clickFileRow(2) // immediate emit to c.go
	if clickCmd == nil {
		t.Fatal("the click must emit immediately")
	}

	_, settled := m.Update(staleTick())
	if settled != nil {
		t.Fatal("the earlier movement's tick must be stale after the click already emitted")
	}
}

// TestMouseWheelRoutesThroughTheSameDebounce confirms the wheel path shares
// cursorSelectCmd rather than emitting on its own.
func TestMouseWheelRoutesThroughTheSameDebounce(t *testing.T) {
	instantSelectTick(t)
	m := newMouseTestMission()

	_, cmd := m.Update(tea.MouseWheelMsg{X: 10, Y: 9, Button: tea.MouseWheelDown})
	if cmd == nil {
		t.Fatal("a wheel move must still schedule a debounce tick")
	}
	if m.selected != "c.go" {
		t.Fatalf("wheel movement itself must be instant, got %q", m.selected)
	}
	msg := cmd()
	if _, ok := msg.(selectDebounceMsg); !ok {
		t.Fatalf("wheel move's cmd must resolve to a selectDebounceMsg, got %#v", msg)
	}
}
