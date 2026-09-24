package mission_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/color"
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
	keyCtrlN     = "\x1b[110;5u" // Kitty CSI-u: codepoint 110 ('n') with modifier 5 (1 + ctrl's bit 4)
)

// openMission starts a mission session and opens it against model, a
// pretty- or compact-printed JSON object (the "model" field's value, not a
// full open envelope), waiting for wantPaint to appear before returning.
func openMission(t *testing.T, model, wantPaint string) *testutil.Session {
	t.Helper()
	s := testutil.StartSession(t, []string{testutil.Binary(t), "session", "--view", "mission"}, nil)
	// A binary slow to start under load must not leave hello for the test's
	// own first read.
	if l, ok := s.ReadLine(10 * time.Second); !ok || !strings.Contains(l, `"t":"hello"`) {
		t.Fatalf("hello: %q ok=%v", l, ok)
	}
	s.Send(`{"t":"open","view":"mission","model":` + model + `}`)
	s.WaitForPaint(wantPaint)
	return s
}

const canCommitModel = `{"current":{"repo":"repo-tools","branch":"main"},` +
	`"changes":[{"path":"a.go","origPath":"","status":"modified","include":"all"}],` +
	`"changedTotal":1,"stagedTotal":1,"filter":"",` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit 1 file to main","canCommit":true,"lastCommit":null},` +
	`"stash":null,"notice":""}`

func TestSpaceOnCursorRowEmitsStageWithPath(t *testing.T) {
	s := s5open(t)
	s.Type(" ")
	l, ok := s.ReadLine(2 * time.Second)
	// mission.go, not model.go: the Changes list now sorts case-insensitively
	// by path (ratified 2026-09-21), and "mission.go" < "model.go" ('i' < 'o').
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/mission.go"`) || !strings.Contains(l, `"mode":"toggle-file"`) {
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

// TestCtrlEnterDoesNotEmitWithEmptySummary: the fixture's canCommit is true
// (staged files exist), but the local summary is still empty, so the commit
// gate stays closed.
func TestCtrlEnterDoesNotEmitWithEmptySummary(t *testing.T) {
	s := s5open(t)
	s.Type("c")
	s.Type(keyCtrlEnter)
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("ctrl-enter with an empty summary must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestCtrlEnterEmitsCommitFromFixtureWithTypedSummary drives the shared
// fixture (canCommit true: two staged files) through the full type-and-send
// path.
func TestCtrlEnterEmitsCommitFromFixtureWithTypedSummary(t *testing.T) {
	s := s5open(t)
	s.Type("c")
	s.Type("o", "k")
	s.Type(keyCtrlEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:commit"`) || !strings.Contains(l, `"summary":"ok"`) {
		t.Fatalf("commit intent from the fixture: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

const noStagedModel = `{"current":{"repo":"repo-tools","branch":"main"},` +
	`"changes":[{"path":"a.go","origPath":"","status":"modified","include":"none"}],` +
	`"changedTotal":1,"stagedTotal":0,"filter":"",` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit 0 files to main","canCommit":false,"lastCommit":null},` +
	`"stash":null,"notice":""}`

// TestAmendToggleEnablesCommitDespiteWireCanCommitFalse: with nothing staged
// (canCommit false), toggling amend locally plus a typed summary must still
// open the commit path -- amending re-uses the last commit's own changes, so
// an empty index is not a blocker.
func TestAmendToggleEnablesCommitDespiteWireCanCommitFalse(t *testing.T) {
	s := openMission(t, noStagedModel, "Commit 0 files to main")
	s.Type("a")
	s.WaitForPaint("Amending last commit")
	s.Type("c")
	s.Type("f", "x")
	s.Type(keyCtrlEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:commit"`) || !strings.Contains(l, `"summary":"fx"`) || !strings.Contains(l, `"amend":true`) {
		t.Fatalf("amend commit intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestListCursorMoveEmitsSelectWithRowPath: moving the Changes cursor loads
// that row's diff, so down and back up each emit mission:select with the row
// the cursor landed on.
// Row order is the Changes list's own case-insensitive path sort (ratified
// 2026-09-21): mission.go, model.go, topbar.go ('i' < 'o' < 't').
func TestListCursorMoveEmitsSelectWithRowPath(t *testing.T) {
	s := s5open(t)
	s.Type("\x1b[B")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:select"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) {
		t.Fatalf("select intent after down: %q", l)
	}
	s.Type("\x1b[A")
	l, ok = s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:select"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/mission.go"`) {
		t.Fatalf("select intent after up: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestListCursorAtTopUpDoesNotEmit: the cursor clamps on the first row, so
// up at the top lands on the same row and must not emit a redundant select.
func TestListCursorAtTopUpDoesNotEmit(t *testing.T) {
	s := s5open(t)
	s.Type("\x1b[A")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("up on the clamped first row must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickFileRowEmitsSelectWithPath clicks the second Changes row
// (model.go, absolute y=13 per the coordinate walk on
// TestMouseClickCheckboxCellEmitsToggleFileWithPath) while the cursor sits
// on the first: the click moves the cursor and emits that row's select. The
// third row (topbar.go) is not used here: with the padding rows added above
// the tabs and top bar, the fixture's fixed 30-row PTY only has room to show
// two of its three Changes rows without scrolling.
// Row 1 (0-indexed) is "model.go" under the Changes list's own
// case-insensitive path sort (ratified 2026-09-21): mission.go, model.go,
// topbar.go.
func TestMouseClickFileRowEmitsSelectWithPath(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 20, 13))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:select"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) {
		t.Fatalf("file-row click select intent: %q", l)
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
// TestBranchModalCheckoutEmitsIntentWithBranchName pins the cursor's initial
// landing spot too: "main" is the fixture's default branch, and default
// branch is the first GHD section (mission: branch rows sort into the
// desktop's section order, 2026-09-20), so the cursor opens directly on it
// with no navigation needed.
func TestBranchModalCheckoutEmitsIntentWithBranchName(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.WaitForPaint("main")
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

// TestBranchCtrlNEntersNamingWithoutEmitting pins the naming sub-mode: ctrl-n
// opens the name field in place of the old frozen "new branch" payload, and
// nothing is emitted until a name is actually committed.
func TestBranchCtrlNEntersNamingWithoutEmitting(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.WaitForPaint("New branch from")
	s.Type(keyCtrlN)
	if l, ok := s.ReadLine(300 * time.Millisecond); ok {
		t.Fatalf("ctrl-n must not emit until a name is entered: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestWorktreeCtrlNEntersNamingWithoutEmitting mirrors the branch case for
// "Provision new worktree…".
func TestWorktreeCtrlNEntersNamingWithoutEmitting(t *testing.T) {
	s := s5open(t)
	s.Type("w")
	s.WaitForPaint("Provision new worktree")
	s.Type(keyCtrlN)
	if l, ok := s.ReadLine(300 * time.Millisecond); ok {
		t.Fatalf("ctrl-n must not emit until a name is entered: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestBranchNamingEnterEmitsCheckoutNewWithTypedName types a name after
// ctrl-n and confirms the following enter is what emits, carrying it.
func TestBranchNamingEnterEmitsCheckoutNewWithTypedName(t *testing.T) {
	s := s5open(t)
	s.Type("b")
	s.WaitForPaint("New branch from")
	s.Type(keyCtrlN)
	s.Type("my-feature")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:checkout"`) ||
		!strings.Contains(l, `"payload":{"new":true,"from":"rt-191-mission-tui","name":"my-feature"}`) {
		t.Fatalf("branch naming intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestWorktreeNamingEnterEmitsWorktreeNewWithTypedName mirrors the branch
// case for the worktree action row.
func TestWorktreeNamingEnterEmitsWorktreeNewWithTypedName(t *testing.T) {
	s := s5open(t)
	s.Type("w")
	s.WaitForPaint("Provision new worktree")
	s.Type(keyCtrlN)
	s.Type("my-feature")
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:worktree"`) ||
		!strings.Contains(l, `"payload":{"new":true,"name":"my-feature"}`) {
		t.Fatalf("worktree naming intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestRepoModalCtrlNDoesNothing pins the repo modal's own exclusion: it has
// no action row (a new repo comes from cloning, not from this foldout), so
// ctrl-n there must not emit.
func TestRepoModalCtrlNDoesNothing(t *testing.T) {
	s := s5open(t)
	s.Type("r")
	s.WaitForPaint("chat")
	s.Type(keyCtrlN)
	if l, ok := s.ReadLine(300 * time.Millisecond); ok {
		t.Fatalf("repo modal ctrl-n must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

const detachedModel = `{"current":{"repo":"repo-tools","branch":"a1b2c3d","detached":true},` +
	`"branches":[{"name":"main","current":false,"ahead":0,"behind":0,"guardedBy":"","group":"other"}],` +
	`"changes":[],"changedTotal":0,"stagedTotal":0,"filter":"",` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit","canCommit":false,"lastCommit":null},` +
	`"stash":null,"notice":""}`

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

// sgrClick/sgrMotion/sgrWheel encode the SGR mouse escape sequences
// (ultraviolet's decoder.go parseSGRMouseEvent) the pty carries a real
// terminal's mouse reports over: "\x1b[<Cb;Cx;CyM", 1-indexed coordinates,
// M for a press (never a release, which mission's Update never routes on).
// button is the X11 code (0 left, 2 right, 32|button for plain motion, 64/65
// for wheel up/down).
func sgrClick(button, x, y int) string {
	return fmt.Sprintf("\x1b[<%d;%d;%dM", button, x+1, y+1)
}

func sgrMotion(x, y int) string { return sgrClick(32, x, y) }

const (
	sgrWheelUp   = 64
	sgrWheelDown = 65
)

// TestMouseClickCheckboxCellEmitsToggleFileWithPath drives a left click at
// the checkbox column of the fixture's second Changes row (topbar.go):
// tabs(3, pad+label+underline)+tabs-gap(1)+filter(3)+master(1)=8 body rows
// ahead of the list (docs/design/mission/README.md's Terminal geometry
// table: the tabs-gap blank band row), +1 for row index 1 = bodyY 9;
// topH(4)+bodyY(9) = frame y 13, checkbox at x=2 (the "  " prefix's own
// width).
// Row 1 (0-indexed) is "model.go" under the Changes list's own
// case-insensitive path sort (ratified 2026-09-21): mission.go, model.go,
// topbar.go -- not the fixture's initial cursor row, so clicking its
// checkbox batches a select intent alongside the stage intent; the
// two land as concurrent Cmds, so the read order between them is not
// guaranteed and both lines are checked as a set.
func TestMouseClickCheckboxCellEmitsToggleFileWithPath(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 2, 13))
	l1, ok1 := s.ReadLine(2 * time.Second)
	l2, ok2 := s.ReadLine(2 * time.Second)
	if !ok1 || !ok2 {
		t.Fatalf("checkbox click on an unselected row should emit both a stage and a select intent: %q / %q", l1, l2)
	}
	var hasStage, hasSelect bool
	for _, l := range []string{l1, l2} {
		if strings.Contains(l, `"name":"mission:stage"`) && strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) && strings.Contains(l, `"mode":"toggle-file"`) {
			hasStage = true
		}
		if strings.Contains(l, `"name":"mission:select"`) && strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) {
			hasSelect = true
		}
	}
	if !hasStage || !hasSelect {
		t.Fatalf("checkbox click on an unselected row should emit both a stage and a select intent for model.go: %q / %q", l1, l2)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickDiffGutterOnAddLineEmitsLineStage clicks the gutter column
// (x=0 relative to the diff pane, absolute sidebarWidth+1) of the fixture's
// third diff line (index 2, the first add line, selIdx 0): the diff pane
// starts at topH(4), header@4, then one line per index (idx0 hunk@5, idx1
// context@6, idx2 add@7).
func TestMouseClickDiffGutterOnAddLineEmitsLineStage(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, sidebarWidthConst+1, 7))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/mission.go"`) ||
		!strings.Contains(l, `"mode":"line"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("gutter click stage intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickHunkRowEmitsHunkStage clicks anywhere across the fixture's
// hunk header (index 0, absolute y=5: the diff pane's header sits at
// topH(4), the hunk line right after it): the whole row is the toggle, so
// any x within the diff pane's content resolves the same as a gutter click.
func TestMouseClickHunkRowEmitsHunkStage(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, sidebarWidthConst+4, 5))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:stage"`) || !strings.Contains(l, `"mode":"hunk"`) || !strings.Contains(l, `"selIdx":0`) {
		t.Fatalf("hunk row click stage intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickUndoChipEmitsUndoIntent clicks the undo strip row. The
// stash/rule/commit-box/undo block docks to the sidebar's bottom edge
// (mission.go's sidebarBlocks/renderSidebar), so its row depends on the
// pane height, not just the row count above it: PTY is 30x100, topbar
// height 4 (docs/design/mission/README.md's Terminal geometry table), keybar
// 1, no notice, so bodyH=25; the fixed top rows (tabs 3 + tabs-gap 1 +
// filter 3 + master 1 = 8) plus a 2-row list region (the fixture's 3 changes
// rows no longer all fit without scrolling once the tabs and top bar each
// gained a padding row) plus the docked block (stash 1 + rule 1 + commit-box
// top pad 1 + summary 3 + description 4 + gap 1 + button 3 (top half-block
// cap, label, bottom half-block cap -- ratified 2026-09-20's sub-cell-height
// treatment) + undo 1 = 15) exactly fill the 25-row body; undo sits at bodyY
// 8+2+1+1+1+3+4+1+3=24, frame y = topH(4)+24 = 28 -- unchanged from before,
// since the extra rows above cancel exactly against the shrunk list region
// (docked-block-start = topH + bodyH - dockedH, and topH+bodyH is constant
// for a fixed pane height regardless of how topH's own row count moves).
func TestMouseClickUndoChipEmitsUndoIntent(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 5, 28))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:undo"`) {
		t.Fatalf("undo chip click intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickActionSegmentEmitsActionIntent clicks the top bar's action
// segment: width 100, sidebarWidth 46, 3 dividers, remaining 51 split
// 17/17/17 -- action starts at column 46+1+17+1+17+1 = 83.
func TestMouseClickActionSegmentEmitsActionIntent(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 90, 0))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:action"`) {
		t.Fatalf("action segment click intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickRepoSegmentOpensModalThenRowClickEmitsRepoIntent mirrors
// TestRepoModalEnterEmitsRepoIntentWithRowID with the mouse doing both the
// open (a click on the repo segment, column 0) and the row selection.
func TestMouseClickRepoSegmentOpensModalThenRowClickEmitsRepoIntent(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 5, 0))
	s.WaitForPaint("chat")
	// The repo modal is anchored at x=0 (segmentOrigin's zoneRepo case) and
	// its own y at topH(4); its first content row sits after the filter
	// line, the top rule, and the fixture's own "local" group header (both
	// repo rows share that group) -- li=3 within the box, frame y = topH(4)
	// + li(3) + 1 (the box's own top border) = 8.
	s.Type(sgrClick(0, 5, 8))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:repo"`) || !strings.Contains(l, `"repo":"repo-tools"`) {
		t.Fatalf("repo modal row click intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickOutsideModalClosesIt opens the repo modal, then clicks far
// outside its box (bottom-right corner): the overlay should close without
// emitting, restoring the undimmed frame (WaitForGone on "chat", the second
// repo row only the modal ever paints).
func TestMouseClickOutsideModalClosesIt(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 5, 0))
	s.WaitForPaint("chat")
	s.Type(sgrClick(0, 99, 29))
	s.WaitForGone("chat")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("outside-modal click must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseClickHistoryTabEmitsTabHistory clicks the tabs button's label row
// (absolute y=5, one row into the sidebar after topH(4): the tabs button is
// a 2-row pad+label span, and either row hits the same target) right half:
// Changes and History each occupy half of sidebarWidth(46), so any x >= 23
// resolves to History.
func TestMouseClickHistoryTabEmitsTabHistory(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(0, 30, 5))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:tab"`) || !strings.Contains(l, `"tab":"history"`) {
		t.Fatalf("History tab click intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// historyModel mirrors history_test.go's historyFixtureModel on the wire.
const historyModel = `{"tab":"history","current":{"repo":"repo-tools","branch":"main"},` +
	`"history":{"commits":[` +
	`{"sha":"s1","shortSha":"s1","summary":"Fix pty paint predicate","byline":"Matt","when":"3 hours ago","group":"Today","tags":[],"unpushed":true,"selected":true},` +
	`{"sha":"s2","shortSha":"s2","summary":"Guard badges","byline":"Matt","when":"5 hours ago","group":"Today","tags":["v0.9.1"],"unpushed":false,"selected":false},` +
	`{"sha":"s3","shortSha":"s3","summary":"","byline":"Matt, Claude","when":"1 day ago","group":"Yesterday","tags":[],"unpushed":false,"selected":false}],` +
	`"hasMore":false,"loading":false,` +
	`"header":{"summary":"Fix pty paint predicate","body":"","byline":"Matt","authors":["Matt <m@x>"],"sha":"s1full","shortSha":"s1","linesAdded":12,"linesDeleted":4,"tags":[],"rangeCount":1,"contiguous":true},` +
	`"files":[{"path":"lib/mission/model.ts","origPath":"","status":"modified"}],"selectedFile":"lib/mission/model.ts"},` +
	`"diff":{"path":"lib/mission/model.ts","status":"modified","kind":"text","stats":"","lang":"","lines":[{"oldNo":0,"newNo":1,"kind":"add","text":"x","selected":false,"selIdx":-1}],"readOnly":true},` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit 0 files to main","canCommit":false,"lastCommit":null},` +
	`"stash":null,"notice":""}`

// historyRowY is the frame row of commit idx's summary line: topH(4), then
// the History sidebar's tabs(3) + tabs-gap(1) + filter box(3), then the
// Today header over s1 and s2 and the Yesterday header over s3, and three
// rows per commit (summary, byline, separator rule).
func historyRowY(idx int) int {
	headers := 1
	if idx >= 2 {
		headers = 2
	}
	return 4 + 7 + headers + 3*idx
}

func openHistory(t *testing.T) *testutil.Session {
	t.Helper()
	return openMission(t, historyModel, "Fix pty paint predicate")
}

// longHistoryModel is historyModel with n commits all under Today, s0
// selected, and hasMore as given.
func longHistoryModel(n int, hasMore bool) string {
	commits := make([]string, n)
	for i := range commits {
		commits[i] = fmt.Sprintf(`{"sha":"sha%02d","shortSha":"sh%02d","summary":"subject-%02d","byline":"author-%02d","when":"1 hour ago","group":"Today","tags":[],"unpushed":false,"selected":%v}`, i, i, i, i, i == 0)
	}
	model := strings.Replace(historyModel, historyModel[strings.Index(historyModel, `"commits":[`):strings.Index(historyModel, `"hasMore":false`)],
		`"commits":[`+strings.Join(commits, ",")+`],`, 1)
	return strings.Replace(model, `"hasMore":false`, fmt.Sprintf(`"hasMore":%v`, hasMore), 1)
}

// listTopY is the frame row of the History list's first row: topH(4) plus
// tabs(3) + tabs-gap(1) + filter box(3).
const listTopY = 4 + 7

// TestHistoryWheelScrollsTheListWithoutEmitting: a wheel tick over the list
// moves the view three lines and sends nothing to the driver.
func TestHistoryWheelScrollsTheListWithoutEmitting(t *testing.T) {
	s := openMission(t, longHistoryModel(20, true), "subject-00")
	waitRow(t, s, listTopY, "  Today")
	s.Type(sgrClick(sgrWheelDown, 5, listTopY+2))
	s.WaitForGone("subject-00")
	waitRow(t, s, listTopY+1, "subject-01")
	for range 20 {
		s.Type(sgrClick(sgrWheelDown, 5, listTopY+2))
	}
	s.WaitForPaint("subject-19")
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("wheel ticks must not emit, even at the end of the list: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// moreRowY is the action row under longHistoryModel(1, true): the Today
// header, s0's summary, byline, and rule, then the row.
const moreRowY = listTopY + 4

// TestHistoryActionRowEnterEmitsOneMore: down from the only commit lands on
// the action row without selecting anything, enter asks for the next page
// once, and the in-flight row answers neither enter nor a click.
func TestHistoryActionRowEnterEmitsOneMore(t *testing.T) {
	s := openMission(t, longHistoryModel(1, true), "Load 100 more commits")
	s.Type("\x1b[B")
	s.Type(keyEnter)
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"name":"mission:history-more"`) {
		t.Fatalf("enter on the action row should emit mission:history-more first and alone: %q", l)
	}
	s.WaitForPaint("Loading…")
	s.Type(keyEnter)
	s.Type(sgrClick(0, 5, moreRowY))
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("the in-flight row must not emit again: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryActionRowClickEmitsOneMore(t *testing.T) {
	s := openMission(t, longHistoryModel(1, true), "Load 100 more commits")
	waitRow(t, s, moreRowY, "Load 100 more commits")
	s.Type(sgrClick(0, 5, moreRowY))
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"name":"mission:history-more"`) {
		t.Fatalf("a click on the action row should emit mission:history-more: %q", l)
	}
	s.WaitForPaint("Loading…")
	s.Type(sgrClick(0, 5, moreRowY))
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("a click on the in-flight row must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestHistoryFilterNarrowsLiveAndReHomesWithOneSelect: typing into the
// History filter narrows the list on every keystroke and never goes to the
// driver; the one intent is the debounced select for the re-homed cursor,
// and esc brings every commit back without another.
func TestHistoryFilterNarrowsLiveAndReHomesWithOneSelect(t *testing.T) {
	s := openHistory(t)
	waitRow(t, s, listTopY-2, "Filter history")
	s.Type("/")
	s.Type("g", "u", "a", "r", "d")
	waitRow(t, s, listTopY+1, "Guard badges")
	if row := screenRow(s, historyRowY(1)); strings.Contains(row, "Empty commit message") {
		t.Fatalf("the filter should hide the other commits: %q", row)
	}
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"name":"mission:history-select"`) || !strings.Contains(l, `"shas":["s2"]`) {
		t.Fatalf("hiding s1 should re-home the cursor to s2 and select it once: %q", l)
	}
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("the filter itself never reaches the driver: %q", l)
	}
	s.Type(keyEsc)
	waitRow(t, s, listTopY+1, "Fix pty paint predicate")
	waitRow(t, s, listTopY-2, "Filter history")
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("esc clears the filter without emitting: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// waitRow waits for screen row y to contain want: a frame can land in more
// than one read, so the row a test checks may paint after the text it waited
// on.
func waitRow(t *testing.T, s *testutil.Session, y int, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(screenRow(s, y), want) {
		if time.Now().After(deadline) {
			t.Fatalf("screen row %d never showed %q: %q", y, want, screenRow(s, y))
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// screenRow is one row of the session's screen as plain text, "" past the
// last painted row.
func screenRow(s *testutil.Session, y int) string {
	if rows := strings.Split(s.Screen(), "\n"); y < len(rows) {
		return rows[y]
	}
	return ""
}

// TestHistoryDateHeadersPaintAndStayInert drives the real binary: each run
// of commits opens on its date header, and a click on a header emits
// nothing.
func TestHistoryDateHeadersPaintAndStayInert(t *testing.T) {
	s := openHistory(t)
	s.WaitForPaint("Yesterday")
	for y, want := range map[int]string{historyRowY(0) - 1: "Today", historyRowY(2) - 1: "Yesterday"} {
		waitRow(t, s, y, want)
		if row := screenRow(s, y); !strings.HasPrefix(row, "  "+want) {
			t.Fatalf("screen row %d should open with the %q header: %q", y, want, row)
		}
	}
	waitRow(t, s, historyRowY(0), "Fix pty paint predicate")
	s.Type(sgrClick(0, 2, historyRowY(2)-1))
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("clicking a date header must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestPressTwoEmitsTabHistory(t *testing.T) {
	s := openMission(t, canCommitModel, "Commit 1 file to main")
	s.Type("2")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:tab"`) || !strings.Contains(l, `"tab":"history"`) {
		t.Fatalf("tab intent after 2: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryDownEmitsDebouncedSelect(t *testing.T) {
	s := openHistory(t)
	s.Type("\x1b[B")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-select"`) || !strings.Contains(l, `"shas":["s2"]`) {
		t.Fatalf("history-select after down: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestHistoryUpAtTopDoesNotEmit is TestListCursorAtTopUpDoesNotEmit for the
// commit list; the window outlasts the 150ms debounce.
func TestHistoryUpAtTopDoesNotEmit(t *testing.T) {
	s := openHistory(t)
	s.Type("\x1b[A")
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("up on the newest commit must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryShiftDownEmitsRange(t *testing.T) {
	s := openHistory(t)
	s.Type("\x1b[1;2B")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-select"`) || !strings.Contains(l, `"shas":["s1","s2"]`) {
		t.Fatalf("history-select after shift+down: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryClickCommitRowEmitsImmediately(t *testing.T) {
	s := openHistory(t)
	s.Type(sgrClick(0, 2, historyRowY(1)))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-select"`) || !strings.Contains(l, `"shas":["s2"]`) {
		t.Fatalf("history-select after a row click: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryClickShowingCommitDoesNotEmit(t *testing.T) {
	s := openHistory(t)
	s.Type(sgrClick(0, 2, historyRowY(0)))
	if l, ok := s.ReadLine(400 * time.Millisecond); ok {
		t.Fatalf("clicking the commit already showing must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestTabSwitchPushClearsTabHover hovers and clicks the History half, then
// pushes the History model as the driver would: with no further motion the
// Changes half, now the inactive one, must repaint in Bg, not HoverBg.
func TestTabSwitchPushClearsTabHover(t *testing.T) {
	s := s5open(t)
	s.Type(sgrMotion(30, 5))
	s.Type(sgrClick(0, 30, 5))
	if l, ok := s.ReadLine(2 * time.Second); !ok || !strings.Contains(l, `"tab":"history"`) {
		t.Fatalf("setup: History tab click intent: %q", l)
	}
	s.Send(`{"t":"model","model":` + historyModel + `}`)
	s.WaitForPaint("Fix pty paint predicate")
	themeBg := color.RGBA{R: 0x16, G: 0x12, B: 0x24, A: 0xff}
	for _, y := range []int{4, 5} {
		if got := testutil.CellBackground(s.TTY(), 1, y); !sameRGB(got, themeBg) {
			t.Fatalf("Changes half cell (1,%d) should be Bg after the switch, got %#v", y, got)
		}
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestHistoryShiftClickEmitsRange sends a left press with the SGR shift bit
// (4) set.
func TestHistoryShiftClickEmitsRange(t *testing.T) {
	s := openHistory(t)
	s.Type(sgrClick(4, 2, historyRowY(1)))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-select"`) || !strings.Contains(l, `"shas":["s1","s2"]`) {
		t.Fatalf("history-select after a shift+click: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryPressOneEmitsTabChanges(t *testing.T) {
	s := openHistory(t)
	s.Type("1")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:tab"`) || !strings.Contains(l, `"tab":"changes"`) {
		t.Fatalf("tab intent after 1: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryClickChangesTabEmitsTabChanges(t *testing.T) {
	s := openHistory(t)
	s.Type(sgrClick(0, 5, 5))
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:tab"`) || !strings.Contains(l, `"tab":"changes"`) {
		t.Fatalf("Changes tab click intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestHistoryHoverCommitRowPaintsHoverBg drives a bare motion report over
// the third commit's summary row through the real renderer and waits for
// that cell to repaint in HoverBg.
func TestHistoryHoverCommitRowPaintsHoverBg(t *testing.T) {
	s := openHistory(t)
	y := historyRowY(2)
	s.Type(sgrMotion(20, y))
	hoverBg := color.RGBA{R: 0x2F, G: 0x2A, B: 0x4A, A: 0xff}
	deadline := time.Now().Add(2 * time.Second)
	for !sameRGB(testutil.CellBackground(s.TTY(), 20, y), hoverBg) {
		if time.Now().After(deadline) {
			t.Fatalf("hovered commit row never painted HoverBg, got %#v", testutil.CellBackground(s.TTY(), 20, y))
		}
		time.Sleep(20 * time.Millisecond)
	}
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("hover must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

const historyOneFile = `"files":[{"path":"lib/mission/model.ts","origPath":"","status":"modified"}]`

func TestHistoryEnterEnterDownEmitsFileSelect(t *testing.T) {
	model := strings.Replace(historyModel, historyOneFile,
		`"files":[{"path":"lib/mission/model.ts","origPath":"","status":"modified"},{"path":"lib/mission/driver.ts","origPath":"","status":"new"}]`, 1)
	s := openMission(t, model, "2 changed files")
	s.Type(keyEnter)
	s.Type("\x1b[B")
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-file"`) || !strings.Contains(l, `"path":"lib/mission/driver.ts"`) {
		t.Fatalf("history-file after enter, down: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestHistoryOversizedEnterEmitsShowOversized(t *testing.T) {
	model := strings.Replace(historyModel, `"kind":"text"`, `"kind":"oversized"`, 1)
	s := openMission(t, model, "enter shows")
	s.Type(keyEnter)
	s.Type(keyEnter)
	s.Type(keyEnter)
	l, ok := s.ReadLine(2 * time.Second)
	if !ok || !strings.Contains(l, `"name":"mission:history-file"`) || !strings.Contains(l, `"path":"lib/mission/model.ts"`) || !strings.Contains(l, `"showOversized":true`) {
		t.Fatalf("history-file showOversized after enter on an oversized diff: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseRightClickFileRowOpensItsMenu right-clicks the fixture's first
// Changes row (absolute y=12: topH(4) + the 8-row tabs/tabs-gap/filter/
// master prefix); esc closes the menu without emitting.
func TestMouseRightClickFileRowOpensItsMenu(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(2, 10, 12))
	s.WaitForPaint("Discard Changes…")
	s.Type(keyEsc)
	s.WaitForGone("Discard Changes…")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("opening and closing the menu must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestMouseWheelOverKeybarRowDoesNotMoveCursor pins mouseWheel's Y bound: a
// wheel tick at y=29 (row 30 of the 30-row pty, the keybar's own row, past
// the body -- TestMouseClickOutsideModalClosesIt's "far outside" corner) must
// be a no-op rather than nudging the Changes-list cursor, even though its x=5
// falls in the same column range a real body row would resolve against. The
// fixture's cursor starts on row 0 (model.go, absolute y=10 per
// TestMouseRightClickFileRowShowsNotice); an unbounded wheel-down would walk
// it wheelStep(3) rows to row 2 (mission.go, y=12 per
// TestMouseClickFileRowEmitsSelectWithPath), visibly moving the "▌" cursor
// bar, so a before/after screen comparison catches the regression without
// reaching into Mission's unexported fields.
func TestMouseWheelOverKeybarRowDoesNotMoveCursor(t *testing.T) {
	s := s5open(t)
	before := s.Screen()
	s.Type(sgrClick(sgrWheelDown, 5, 29))
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("wheel over the keybar row must not emit anything: %q", l)
	}
	if after := s.Screen(); before != after {
		t.Fatalf("wheel over the keybar row moved the cursor:\nbefore:\n%s\nafter:\n%s", before, after)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// ─── terminal background (real renderer, real pty) ─────────────────────

// TestLiveFrameSetsTerminalBackgroundToThemeBg pins the fix for a defect
// no in-process render test can see: bubbletea's real renderer is free to
// erase a run of styled trailing blanks down to a bare erase-to-end-of-line
// control code, which paints with the TERMINAL's own default background,
// not whatever SGR the erased content carried -- so mission.go's View()
// sets tea.View.BackgroundColor (an OSC 11 sequence) to theme.Bg every
// frame. Verified through the real compiled binary over a real pty
// (testutil.Session), replayed through a real terminal emulator
// (testutil.TerminalBackground/CellBackground), not by inspecting
// Mission.View().Content directly -- that string never carries evidence of
// what the renderer does to it on the way to a real terminal.
func TestLiveFrameSetsTerminalBackgroundToThemeBg(t *testing.T) {
	s := s5open(t)
	tty := s.TTY()
	s.Send(`{"t":"close"}`)
	s.Wait()

	themeBg := color.RGBA{R: 0x16, G: 0x12, B: 0x24, A: 0xff}
	if got := testutil.TerminalBackground(tty); !sameRGB(got, themeBg) {
		t.Fatalf("terminal's own default background should be theme.Bg, got %#v", got)
	}
}

// TestLiveFrameCellBeyondPTYResolvesToThemeBg is the case cell-level content
// fills can never cover: a region the app never drew a single byte into (an
// oversized real terminal pane around a smaller frame, or scrollback above
// the alt-screen). Replaying the same session bytes into an emulator taller
// than the pty's own 30 rows puts row 35 entirely outside anything rt-ui
// composed; with the terminal-level background set, Emulator.Draw still
// resolves it to theme.Bg instead of the emulator's unset default.
func TestLiveFrameCellBeyondPTYResolvesToThemeBg(t *testing.T) {
	s := s5open(t)
	tty := s.TTY()
	s.Send(`{"t":"close"}`)
	s.Wait()

	themeBg := color.RGBA{R: 0x16, G: 0x12, B: 0x24, A: 0xff}
	if got := testutil.CellBackgroundBeyondPTY(tty, 50, 35); !sameRGB(got, themeBg) {
		t.Fatalf("a cell beyond the pty's own rows should still resolve to theme.Bg via the terminal-level background, got %#v", got)
	}
}

// TestLiveFrameFillerAndDiffBlankCellsResolveToThemeBg re-checks the two
// regions the coordinator's live capture named (the sidebar's bottom-dock
// filler gap and the diff pane's blank region past its content) through the
// real renderer, not just the composed-string tests in render_test.go.
func TestLiveFrameFillerAndDiffBlankCellsResolveToThemeBg(t *testing.T) {
	s := s5open(t)
	tty := s.TTY()
	s.Send(`{"t":"close"}`)
	s.Wait()

	themeBg := color.RGBA{R: 0x16, G: 0x12, B: 0x24, A: 0xff}
	cases := []struct {
		name string
		x, y int
	}{
		// The filler gap shrank from 3 rows to 1 when the commit button
		// grew from 1 row to 3 (ratified 2026-09-20's sub-cell-height
		// treatment: a half-block cap above and below the label row), so
		// row 14 -- filler before that change -- is now the stash strip.
		{"sidebar filler gap", 20, 13},
		{"diff pane blank region", 70, 25},
	}
	for _, c := range cases {
		if got := testutil.CellBackground(tty, c.x, c.y); !sameRGB(got, themeBg) {
			t.Fatalf("%s cell (%d,%d) should resolve to theme.Bg, got %#v", c.name, c.x, c.y, got)
		}
	}
}

// sameRGB compares two colors by their 8-bit RGB channels, ignoring
// whichever concrete color.Color type each side happens to be (the
// emulator hands back a colorful.Color; the constants here are color.RGBA).
func sameRGB(a, b color.Color) bool {
	if a == nil || b == nil {
		return a == b
	}
	ar, ag, ab, _ := a.RGBA()
	br, bg, bb, _ := b.RGBA()
	return ar>>8 == br>>8 && ag>>8 == bg>>8 && ab>>8 == bb>>8
}

// sidebarWidthConst mirrors topbar.go's sidebarWidth for this file's own
// coordinate comments; a package-external test cannot reference the
// unexported constant directly.
const sidebarWidthConst = 46

// s5open opens the mission view against the shared session-model-mission
// fixture (three Changes rows, one staged, canCommit true, a six-line diff)
// and waits for its first row to paint; bespoke per-scenario models go
// through openMission directly.
func s5open(t *testing.T) *testutil.Session {
	t.Helper()
	return openMission(t, fixtureModelJSON(t, "session-model-mission.json"), "model.go")
}

const (
	keyCtrlK = "\x0b"
	keyDown  = "\x1b[B"
)

// waitIntent reads emitted lines until one is the named intent; a select a
// right-click fires first is not the line under test.
func waitIntent(t *testing.T, s *testutil.Session, name string) string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		l, ok := s.ReadLine(time.Until(deadline))
		if !ok {
			t.Fatalf("no %s intent arrived", name)
		}
		if strings.Contains(l, `"name":"`+name+`"`) {
			return l
		}
	}
}

// TestRightClickCopyFilePathEmitsTheRowsPath right-clicks model.go (frame
// row 13, see TestMouseClickCheckboxCellEmitsToggleFileWithPath), steps down
// past Discard and the three Ignore rows, and chooses Copy File Path.
func TestRightClickCopyFilePathEmitsTheRowsPath(t *testing.T) {
	s := s5open(t)
	s.Type(sgrClick(2, 12, 13))
	s.WaitForPaint("Copy File Path")
	s.Type(keyDown, keyDown, keyDown, keyDown, keyEnter)
	l := waitIntent(t, s, "mission:menu-action")
	if !strings.Contains(l, `"action":"copy-path"`) || !strings.Contains(l, `"path":"ui/internal/views/mission/model.go"`) {
		t.Fatalf("copy-path intent: %q", l)
	}
	s.WaitForGone("Copy File Path")
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestCtrlKOnTheHistoryListCopiesTheCursorSha(t *testing.T) {
	s := openHistory(t)
	s.Type(keyCtrlK)
	s.WaitForPaint("Copy SHA")
	s.Type(keyDown, keyDown, keyEnter)
	l := waitIntent(t, s, "mission:menu-action")
	if !strings.Contains(l, `"action":"copy-sha"`) || !strings.Contains(l, `"sha":"s1"`) {
		t.Fatalf("copy-sha intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

// TestRepoRowsFromACommitMenuCarryNoTarget: Reveal Repository in Finder acts
// on the worktree, so choosing it from a commit's menu sends no sha.
func TestRepoRowsFromACommitMenuCarryNoTarget(t *testing.T) {
	s := openHistory(t)
	s.Type(keyCtrlK)
	s.WaitForPaint("Copy SHA")
	s.Type("r", "e", "v", "e", "a", "l", " ", "r", "e", "p", "o")
	s.WaitForGone("Copy SHA")
	s.Type(keyEnter)
	l := waitIntent(t, s, "mission:menu-action")
	if !strings.Contains(l, `"action":"reveal-repo"`) || strings.Contains(l, `"sha"`) || strings.Contains(l, `"path"`) {
		t.Fatalf("reveal-repo intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestCreateTagEmitsTheTypedNameAndSha(t *testing.T) {
	s := openHistory(t)
	s.Type(keyCtrlK)
	s.WaitForPaint("Create Tag…")
	s.Type(keyDown, keyEnter)
	s.WaitForPaint("Create a Tag")
	s.Type("v", "9", keyEnter)
	l := waitIntent(t, s, "mission:menu-action")
	if !strings.Contains(l, `"action":"create-tag"`) || !strings.Contains(l, `"name":"v9"`) || !strings.Contains(l, `"sha":"s1"`) {
		t.Fatalf("create-tag intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

const stashShowingModel = `{"current":{"repo":"repo-tools","branch":"main"},"changes":[],"changedTotal":0,"stagedTotal":0,"filter":"",` +
	`"diff":{"path":"a.txt","status":"modified","kind":"text","stats":"","lang":"","lines":[{"oldNo":0,"newNo":1,"kind":"add","text":"stashed line","selected":false,"selIdx":-1}],"readOnly":true},` +
	`"commit":{"summary":"","description":"","placeholder":"Summary (required)","amending":false,"buttonLabel":"Commit 0 files to main","canCommit":false,"lastCommit":null},` +
	`"stash":{"sha":"s1","branch":"main","files":[{"path":"a.txt","origPath":"","status":"modified","onDisk":false},{"path":"b.txt","origPath":"","status":"new","onDisk":false}],"showing":true,"selectedFile":"a.txt"},` +
	`"notice":""}`

func TestHOpensTheStashWithoutAPath(t *testing.T) {
	s := s5open(t)
	s.Type("h")
	if l := waitIntent(t, s, "mission:stash-select"); !strings.Contains(l, `"payload":{}`) {
		t.Fatalf("opening the stash selects the driver's first file: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestStashViewKeysEmitPathShaAndHide(t *testing.T) {
	s := openMission(t, stashShowingModel, "Stashed changes")
	s.Type(keyDown)
	if l := waitIntent(t, s, "mission:stash-select"); !strings.Contains(l, `"payload":{"path":"b.txt"}`) {
		t.Fatalf("stash file move: %q", l)
	}
	s.Type("R")
	if l := waitIntent(t, s, "mission:stash-restore"); !strings.Contains(l, `"payload":{"sha":"s1"}`) {
		t.Fatalf("restore: %q", l)
	}
	s.Type("h")
	waitIntent(t, s, "mission:stash-hide")
	s.Send(`{"t":"close"}`)
	s.Wait()
}
