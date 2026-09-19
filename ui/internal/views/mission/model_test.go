package mission

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// modelFixture reads the "model" sub-object out of a session-line fixture
// (the shape SetModel and decode actually receive, per session.ModelUpdate).
func modelFixture(t *testing.T, name string) json.RawMessage {
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
	return envelope.Model
}

func TestSetModelDecodesEveryTopField(t *testing.T) {
	m := &Mission{}
	if err := m.SetModel(modelFixture(t, "session-model-mission.json")); err != nil {
		t.Fatalf("SetModel: %v", err)
	}

	if m.model.Current.Repo != "repo-tools" || m.model.Current.Branch != "rt-191-mission-tui" {
		t.Fatalf("Current: %+v", m.model.Current)
	}
	if m.model.Action.Kind != "pull" || m.model.Action.Ahead != 3 || m.model.Action.Behind != 2 {
		t.Fatalf("Action: %+v", m.model.Action)
	}
	if len(m.model.Repos) != 2 || m.model.Repos[0].Badge.Staged != 1 {
		t.Fatalf("Repos: %+v", m.model.Repos)
	}
	if len(m.model.Worktrees) != 2 || !m.model.Worktrees[1].OnDeck {
		t.Fatalf("Worktrees: %+v", m.model.Worktrees)
	}
	if len(m.model.Branches) != 3 || m.model.Branches[2].GuardedBy == "" {
		t.Fatalf("Branches[2].GuardedBy not populated: %+v", m.model.Branches)
	}
	if len(m.model.Changes) != 3 || m.model.Changes[0].Include != "all" || m.model.Changes[1].Include != "none" || m.model.Changes[2].Include != "partial" {
		t.Fatalf("Changes: %+v", m.model.Changes)
	}
	if m.model.ChangedTotal != 3 || m.model.StagedTotal != 2 {
		t.Fatalf("totals: changed=%d staged=%d", m.model.ChangedTotal, m.model.StagedTotal)
	}
	if len(m.model.Diff.Lines) != 6 || m.model.Diff.Lines[0].Kind != "hunk" {
		t.Fatalf("Diff.Lines[0].Kind: %+v", m.model.Diff.Lines)
	}
	if !m.model.Diff.Lines[2].Selected || m.model.Diff.Lines[2].SelIdx != 0 {
		t.Fatalf("Diff.Lines[2] add selection: %+v", m.model.Diff.Lines[2])
	}
	if m.model.Commit.LastCommit == nil || !m.model.Commit.LastCommit.Undoable {
		t.Fatalf("Commit.LastCommit: %+v", m.model.Commit.LastCommit)
	}
	if m.model.StashCount != 1 || m.model.Notice != "" {
		t.Fatalf("StashCount=%d Notice=%q", m.model.StashCount, m.model.Notice)
	}
}

func TestDecodeIgnoresUnknownFields(t *testing.T) {
	var v map[string]any
	if err := json.Unmarshal(modelFixture(t, "session-model-mission.json"), &v); err != nil {
		t.Fatal(err)
	}
	v["surprise"] = "from a newer driver"
	augmented, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}

	m, err := decode(augmented)
	if err != nil {
		t.Fatalf("decode with unknown field: %v", err)
	}
	if m.Current.Repo != "repo-tools" {
		t.Fatalf("decode with unknown field lost known data: %+v", m.Current)
	}
}

func TestClampSelectionPreservesByPathAndFallsBack(t *testing.T) {
	m := &Mission{}
	if err := m.SetModel(modelFixture(t, "session-model-mission.json")); err != nil {
		t.Fatalf("SetModel: %v", err)
	}
	if m.selected != m.model.Changes[0].Path {
		t.Fatalf("initial selection: got %q want %q", m.selected, m.model.Changes[0].Path)
	}

	m.selected = m.model.Changes[2].Path

	var v map[string]any
	if err := json.Unmarshal(modelFixture(t, "session-model-mission.json"), &v); err != nil {
		t.Fatal(err)
	}
	// Drop the previously selected row: it fell out of the filtered list.
	changes := v["changes"].([]any)
	v["changes"] = changes[:2]
	shrunk, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(shrunk); err != nil {
		t.Fatalf("SetModel (shrunk): %v", err)
	}
	if m.selected != m.model.Changes[0].Path {
		t.Fatalf("fallback selection: got %q want %q", m.selected, m.model.Changes[0].Path)
	}

	v["changes"] = []any{}
	empty, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(empty); err != nil {
		t.Fatalf("SetModel (empty): %v", err)
	}
	if m.selected != "" {
		t.Fatalf("empty-list selection: got %q want \"\"", m.selected)
	}
}
