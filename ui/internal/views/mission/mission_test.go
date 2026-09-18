package mission_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rt-ui/internal/testutil"
)

func fixtureLine(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, b); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// fixtureModelJSON pulls the "model" field's raw value out of a
// session-model-*.json fixture (an envelope of {t, model}), compacted to
// the one-line form openMission needs to splice into its own open envelope.
func fixtureModelJSON(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Model json.RawMessage `json:"model"`
	}
	if err := json.Unmarshal(b, &envelope); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, envelope.Model); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// TestOpenDecodesCurrentAndQuitEmitsClosedQuit mirrors the board's
// TestQuitConfirmsWhenRunningAndEmitsQuitOnY harness shape, minus the
// confirm layer this skeleton has no reason to gate behind yet.
func TestOpenDecodesCurrentAndQuitEmitsClosedQuit(t *testing.T) {
	s := testutil.StartSession(t, []string{testutil.Binary(t), "session", "--view", "mission"}, nil)
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"t":"hello"`) || !strings.Contains(l, `"mission"`) {
		t.Fatalf("hello: %q ok=%v", l, ok)
	}
	s.Send(fixtureLine(t, "session-open-mission.json"))
	s.WaitForPaint("main")
	if !strings.Contains(s.Screen(), "remote:github.com%2Fm4ttstack%2Frt") {
		t.Fatalf("Current.Repo not decoded onto the screen:\n%s", s.Screen())
	}
	s.Type("q")
	l, _ := s.ReadLine(2 * time.Second)
	if !strings.Contains(l, `"t":"intent"`) || !strings.Contains(l, `"quit"`) {
		t.Fatalf("expected a quit intent first: %q", l)
	}
	l, _ = s.ReadLine(2 * time.Second)
	if !strings.Contains(l, `"reason":"quit"`) {
		t.Fatalf("closed: %q", l)
	}
	if exit := s.Wait(); exit != 0 {
		t.Fatalf("exit %d", exit)
	}
}

const (
	keyEnter     = "\r"
	keyEsc       = "\x1b"
	keyCtrlEnter = "\x1b[13;5u" // Kitty CSI-u: codepoint 13 (Enter) with modifier 5 (1 + ctrl's bit 4)
)

// openMission starts a mission session and opens it against model, a
// pretty- or compact-printed JSON object (the "model" field's value, not a
// full open envelope), waiting for wantPaint to appear before returning.
func openMission(t *testing.T, model, wantPaint string) *testutil.Session {
	t.Helper()
	s := testutil.StartSession(t, []string{testutil.Binary(t), "session", "--view", "mission"}, nil)
	s.ReadLine(2 * time.Second)
	s.Send(`{"t":"open","view":"mission","model":` + model + `}`)
	s.WaitForPaint(wantPaint)
	return s
}

const canCommitModel = `{"current":{"repo":"repo-tools","branch":"main"},` +
	`"changes":[{"path":"a.go","origPath":"","status":"modified","include":"all"}],` +
	`"changedTotal":1,"stagedTotal":1,"filter":"",` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit 1 file to main","canCommit":true,"lastCommit":null},` +
	`"stashCount":0,"notice":""}`

func TestSpaceOnCursorRowEmitsStageWithPath(t *testing.T) {
	s := s5open(t)
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) || !strings.Contains(l, `"mode":"toggle-file"`) {
		t.Fatalf("stage intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestCommitFocusTypeCtrlEnterEmitsCommitWithTypedSummary(t *testing.T) {
	s := openMission(t, canCommitModel, "Commit 1 file to main")
	s.Type("c")
	s.Type("h", "i")
	s.Type(keyCtrlEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:commit"`) || !strings.Contains(l, `"summary":"hi"`) {
		t.Fatalf("commit intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestCtrlEnterDoesNotEmitWhenCanCommitFalse(t *testing.T) {
	s := s5open(t)
	s.Type("c")
	s.Type(keyCtrlEnter)
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("ctrl-enter with canCommit false must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestFilterFocusTypeEnterEmitsSelectWithFilter(t *testing.T) {
	s := s5open(t)
	s.Type("/")
	s.Type("x", "y")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:select"`) || !strings.Contains(l, `"filter":"xy"`) {
		t.Fatalf("select intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestEscFromFilterCancelsWithoutEmitting(t *testing.T) {
	s := s5open(t)
	s.Type("/")
	s.Type("z")
	s.Type(keyEsc)
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("esc must not emit a select intent: %q", l)
	}
	// Back in list focus, space still moves the cursor row's stage intent,
	// proving esc actually returned focus rather than leaving filter typing
	// dead-ended.
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) {
		t.Fatalf("space after esc should still stage: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffSpaceOnAddLineEmitsStageWithSelIdx drives the cursor down to the
// fixture's first add line (index 2 of session-model-mission.json's Diff.Lines,
// selIdx 0) and checks space stages that line, not the hunk header it starts
// on.
func TestDiffSpaceOnAddLineEmitsStageWithSelIdx(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type("\x1b[B", "\x1b[B")
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/mission.go"`) ||
		!strings.Contains(l, `"mode":"line"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("diff stage intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffSpaceOnHunkHeaderEmitsHunkModeWithSelIdx presses space at the
// diff pane's default cursor position (the fixture's line 0, a hunk header
// with SelIdx -1). The header IS the hunk toggle, so this must resolve to
// hunk mode and the first selectable line after it (index 2, selIdx 0),
// never the header's own -1.
func TestDiffSpaceOnHunkHeaderEmitsHunkModeWithSelIdx(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/mission.go"`) ||
		!strings.Contains(l, `"mode":"hunk"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("space on hunk header: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffSKeyEmitsHunkMode mirrors the space-on-header case for s: same
// default cursor, same resolved selIdx.
func TestDiffSKeyEmitsHunkMode(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type("s")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"mode":"hunk"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("diff hunk-stage intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffDKeyEmitsDiscard presses d at the default cursor (the hunk
// header): same resolution as space, mission:discard instead of stage.
func TestDiffDKeyEmitsDiscard(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type("d")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:discard"`) || !strings.Contains(l, `"mode":"hunk"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("diff discard intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffSpaceOnContextRowEmitsNothing: a context line has nothing to
// select (SelIdx -1, not a hunk toggle), so space must no-op rather than
// emit a negative selIdx.
func TestDiffSpaceOnContextRowEmitsNothing(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type("\x1b[B") // down to line 1, the fixture's context row
	s.Type(" ")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("space on a context row must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestDiffDOnContextRowEmitsNothing mirrors the context-row case for d.
func TestDiffDOnContextRowEmitsNothing(t *testing.T) {
	s := s5open(t)
	s.Type(keyEnter)
	s.Type("\x1b[B")
	s.Type("d")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("d on a context row must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestUndoKeyEmitsUndoIntent(t *testing.T) {
	s := s5open(t)
	s.Type("u")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:undo"`) {
		t.Fatalf("undo intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestActionKeyEmitsActionIntent(t *testing.T) {
	s := s5open(t)
	s.Type("f")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:action"`) {
		t.Fatalf("action intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestRepoModalEnterEmitsRepoIntentWithRowID drives the default cursor (the
// fixture's first repo row, repo-tools) straight to enter.
func TestRepoModalEnterEmitsRepoIntentWithRowID(t *testing.T) {
	s := s5open(t)
	s.Type("r")
	s.WaitForPaint("chat")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:repo"`) || !strings.Contains(l, `"repo":"repo-tools"`) {
		t.Fatalf("repo intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestBranchModalCheckoutEmitsIntentWithBranchName moves one row down from
// the current branch (recent) to "main" (other): the guarded row sits past
// it and is never reached here.
func TestBranchModalCheckoutEmitsIntentWithBranchName(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.WaitForPaint("main")
	s.Type("\x1b[B")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:checkout"`) || !strings.Contains(l, `"branch":"main"`) {
		t.Fatalf("checkout intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestGuardedBranchRowFilteredAloneEmitsNothingOnEnter types a query that
// isolates the guarded row as the only match: the cursor has nowhere
// selectable to land, and enter must still refuse it.
func TestGuardedBranchRowFilteredAloneEmitsNothingOnEnter(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.Type("picker-polish")
	s.WaitForPaint("picker-polish")
	s.Type(keyEnter)
	if l, ok := s.ReadLine(300 * time.Millisecond); ok {
		t.Fatalf("guarded row must not emit on enter: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestWorktreeModalEmitsIntentWithPath moves from the current worktree
// (gandalf) down to the on-deck one (frodo).
func TestWorktreeModalEmitsIntentWithPath(t *testing.T) {
	s := s5open(t)
	s.Type("w")
	s.WaitForPaint("frodo")
	s.Type("\x1b[B")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:worktree"`) ||
		!strings.Contains(l, `"path":"/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/frodo"`) {
		t.Fatalf("worktree intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestModalEscClosesWithoutEmittingAndReturnsFocusToList(t *testing.T) {
	s := s5open(t)
	s.Type("r")
	s.WaitForPaint("chat")
	s.Type(keyEsc)
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("esc must not emit: %q", l)
	}
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) {
		t.Fatalf("space after esc should still stage, proving focus returned to the list: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestBranchActionRowEmitsCheckoutNewFromCurrent walks past the recent and
// other rows (the guarded row auto-skips) to land on the action slot.
func TestBranchActionRowEmitsCheckoutNewFromCurrent(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.WaitForPaint("New branch from")
	s.Type("\x1b[B", "\x1b[B")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:checkout"`) || !strings.Contains(l, `"new":true`) ||
		!strings.Contains(l, `"from":"rt-191-mission-tui"`) {
		t.Fatalf("branch action intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestWorktreeActionRowEmitsWorktreeNew(t *testing.T) {
	s := s5open(t)
	s.Type("w")
	s.WaitForPaint("Provision new worktree")
	s.Type("\x1b[B", "\x1b[B")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:worktree"`) || !strings.Contains(l, `"new":true`) {
		t.Fatalf("worktree action intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

const detachedModel = `{"current":{"repo":"repo-tools","branch":"a1b2c3d","detached":true},` +
	`"branches":[{"name":"main","current":false,"ahead":0,"behind":0,"guardedBy":"","group":"other"}],` +
	`"changes":[],"changedTotal":0,"stagedTotal":0,"filter":"",` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit","canCommit":false,"lastCommit":null},` +
	`"stashCount":0,"notice":""}`

// TestDetachedHeadRefusesBranchModalWithNotice presses b on a detached
// checkout: no modal opens (no filter box paints) and nothing emits, only a
// local refusal notice.
func TestDetachedHeadRefusesBranchModalWithNotice(t *testing.T) {
	s := openMission(t, detachedModel, "Detached HEAD")
	s.Type("b")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("detached HEAD must not emit anything on b: %q", l)
	}
	s.WaitForPaint("check out a branch")
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestAmendToggleFromListShowsBanner(t *testing.T) {
	s := s5open(t)
	s.Type("a")
	s.WaitForPaint("Amending last commit")
	s.Type("a")
	s.WaitForGone("Amending last commit")
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// s5open opens the mission view against the shared model fixture (three
// Changes rows, canCommit false) and waits for its first row to paint. Named
// for the task that introduced the changes pane, to keep it distinct from
// openMission's bespoke per-scenario models.
func s5open(t *testing.T) *testutil.Session {
	t.Helper()
	return openMission(t, fixtureModelJSON(t, "session-model-mission.json"), "model.go")
}
