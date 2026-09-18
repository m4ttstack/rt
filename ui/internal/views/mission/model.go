package mission

import "encoding/json"

// Current is the checkout the mission board is pointed at. This is the
// skeleton slice of the wire model: the full repos/changes/action shapes
// land in a later task and will replace Model wholesale.
type Current struct {
	Repo         string `json:"repo"`
	RepoLabel    string `json:"repoLabel"`
	Worktree     string `json:"worktree"`
	WorktreeName string `json:"worktreeName"`
	Branch       string `json:"branch"`
	Detached     bool   `json:"detached"`
}

type Model struct {
	Current Current `json:"current"`
}

// decode tolerates unknown fields: the wire model already carries repos,
// changes and action, none of which this task reads yet.
func decode(raw json.RawMessage) (Model, error) {
	var m Model
	err := json.Unmarshal(raw, &m)
	return m, err
}
