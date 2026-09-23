package mission

import "encoding/json"

// Badge is the ahead/behind and working-tree-status summary shared by repo
// and worktree rows.
type Badge struct {
	Ahead         int    `json:"ahead"`
	Behind        int    `json:"behind"`
	Staged        int    `json:"staged"`
	Unstaged      int    `json:"unstaged"`
	Untracked     int    `json:"untracked"`
	Conflicted    int    `json:"conflicted"`
	Clean         bool   `json:"clean"`
	LastFetchedAt string `json:"lastFetchedAt"` // ISO or ""
}

type RepoRow struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Group   string `json:"group"`
	Badge   Badge  `json:"badge"`
	Current bool   `json:"current"`
}

type WorktreeRow struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Branch  string `json:"branch"`
	Badge   Badge  `json:"badge"`
	Current bool   `json:"current"`
	OnDeck  bool   `json:"onDeck"`
}

type BranchRow struct {
	Name      string `json:"name"`
	Current   bool   `json:"current"`
	Ahead     int    `json:"ahead"`
	Behind    int    `json:"behind"`
	GuardedBy string `json:"guardedBy"` // "" = free; else the refusal detail
	Group     string `json:"group"`     // "default branch" | "recent" | "other" | "guarded"
	Default   bool   `json:"default"`   // the repo's remote default branch (origin/main or origin/master)
	When      string `json:"when"`      // driver-computed relative date, GHD-style ("2 days ago"); "" for the current row
}

type ChangeRow struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Status   string `json:"status"`  // "new"|"modified"|"deleted"|"renamed"|"copied"|"conflicted"
	Include  string `json:"include"` // "all"|"none"|"partial"
}

type DiffLine struct {
	OldNo    int    `json:"oldNo"` // 0 = absent
	NewNo    int    `json:"newNo"` // 0 = absent
	Kind     string `json:"kind"`  // "context"|"add"|"del"|"hunk"
	Text     string `json:"text"`
	Selected bool   `json:"selected"` // staging selection state for add/del lines
	SelIdx   int    `json:"selIdx"`   // git-core DiffSelection line index; -1 for context/hunk
}

type DiffModel struct {
	Path     string     `json:"path"`
	Status   string     `json:"status"`
	Kind     string     `json:"kind"`  // "text"|"binary"|"oversized"|"none"
	Stats    string     `json:"stats"` // "+18 -4"
	Lang     string     `json:"lang"`  // chroma lexer hint, e.g. "typescript"; "" = plain
	Lines    []DiffLine `json:"lines"`
	ReadOnly bool       `json:"readOnly"` // a committed diff (History): no stage gutter, nothing toggles
}

type HistoryCommitRow struct {
	Sha      string   `json:"sha"`
	ShortSha string   `json:"shortSha"`
	Summary  string   `json:"summary"`
	Byline   string   `json:"byline"` // GHD's commit-attribution: "A", "A, B", or "N people"
	When     string   `json:"when"`   // driver-computed relative author date
	Group    string   `json:"group"`  // date header: "Today", "Yesterday", "Earlier this week", "Last week", or "September 2026"
	Tags     []string `json:"tags"`
	Unpushed bool     `json:"unpushed"`
	Selected bool     `json:"selected"` // the driver's selection; the view adopts it when its own cursor falls off the list
}

type HistoryHeader struct {
	Summary      string   `json:"summary"`
	Body         string   `json:"body"`
	Byline       string   `json:"byline"`
	Authors      []string `json:"authors"` // expanded author list, "Name <email>" (GHD renderExpandedAuthor)
	Sha          string   `json:"sha"`
	ShortSha     string   `json:"shortSha"`
	LinesAdded   int      `json:"linesAdded"`
	LinesDeleted int      `json:"linesDeleted"`
	Tags         []string `json:"tags"`
	RangeCount   int      `json:"rangeCount"` // selected commit count; above 1 the header reads "Showing changes from N commits"
	Contiguous   bool     `json:"contiguous"`
}

type HistoryFileRow struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Status   string `json:"status"`
	OnDisk   bool   `json:"onDisk"` // the path exists in the current worktree, not just in the commit
}

type HistoryModel struct {
	Commits      []HistoryCommitRow `json:"commits"`
	HasMore      bool               `json:"hasMore"`
	Loading      bool               `json:"loading"`
	Header       *HistoryHeader     `json:"header"`
	Files        []HistoryFileRow   `json:"files"`
	SelectedFile string             `json:"selectedFile"`
}

type ActionModel struct {
	Kind   string `json:"kind"` // "fetch"|"pull"|"pull-rebase"|"push"|"force-push"|"publish-branch"|"publish-repo"|"busy"|"detached"
	Title  string `json:"title"`
	Meta   string `json:"meta"`
	Ahead  int    `json:"ahead"`
	Behind int    `json:"behind"`
	Busy   bool   `json:"busy"`
}

type CommitModel struct {
	Summary     string      `json:"summary"`
	Description string      `json:"description"`
	Placeholder string      `json:"placeholder"`
	Amending    bool        `json:"amending"`
	ButtonLabel string      `json:"buttonLabel"` // driver-computed, e.g. "Commit 3 files to main"
	CanCommit   bool        `json:"canCommit"`
	LastCommit  *LastCommit `json:"lastCommit"`
}

type LastCommit struct {
	Summary  string `json:"summary"`
	When     string `json:"when"`
	Undoable bool   `json:"undoable"`
}

// Current is the checkout the mission board is pointed at.
type Current struct {
	Repo         string `json:"repo"`
	RepoLabel    string `json:"repoLabel"`
	Worktree     string `json:"worktree"`
	WorktreeName string `json:"worktreeName"`
	Branch       string `json:"branch"`
	Detached     bool   `json:"detached"`
	Settling     bool   `json:"settling"`
}

type Model struct {
	Current      Current       `json:"current"`
	Action       ActionModel   `json:"action"`
	Repos        []RepoRow     `json:"repos"`
	Worktrees    []WorktreeRow `json:"worktrees"`
	Branches     []BranchRow   `json:"branches"`
	Changes      []ChangeRow   `json:"changes"`
	ChangedTotal int           `json:"changedTotal"`
	StagedTotal  int           `json:"stagedTotal"`
	Filter       string        `json:"filter"`
	Diff         DiffModel     `json:"diff"`
	Commit       CommitModel   `json:"commit"`
	StashCount   int           `json:"stashCount"`
	Notice       string        `json:"notice"` // one-line transient notice (guard refusals, not-yet-wired)
	Tab          string        `json:"tab"`    // "changes"|"history"
	History      HistoryModel  `json:"history"`
	EditorLabel  string        `json:"editorLabel"` // rt code's resolved editor ("Zed"), "" when none resolves
}

// decode tolerates unknown fields: the wire model is a shared contract with
// the TS producer, which is free to add fields this version does not read
// yet.
func decode(raw json.RawMessage) (Model, error) {
	var m Model
	err := json.Unmarshal(raw, &m)
	return m, err
}
