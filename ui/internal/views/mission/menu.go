// Context menus: GitHub Desktop's right-click menus for a Changes file row,
// a History file row, and a History commit row, each followed by a
// board-wide section that lists every key. picker.Menu is the engine; this
// file only builds the rows and runs what a chosen row means.
package mission

import (
	"path"
	"slices"
	"strings"

	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/views/picker"
)

type targetKind int

const (
	targetNone targetKind = iota
	targetChange
	targetHistoryFile
	targetCommit
)

type menuTarget struct {
	kind    targetKind
	path    string
	status  string
	onDisk  bool
	sha     string
	short   string
	summary string
	newest  bool
}

// boardSection is a section id no row menu uses, so a rule always separates
// the board-wide rows from the row's own.
const boardSection = 100

type menuActionPayload struct {
	Action string `json:"action"`
	Path   string `json:"path,omitempty"`
	Sha    string `json:"sha,omitempty"`
	Name   string `json:"name,omitempty"`
}

// jsExtname is Node's path.extname, which GitHub Desktop builds its "Ignore
// All .ext Files" label from and the driver appends the rule with: a
// basename whose last dot leads it, and "..", have no extension.
func jsExtname(p string) string {
	base := path.Base(p)
	i := strings.LastIndex(base, ".")
	if i <= 0 || base == ".." {
		return ""
	}
	return base[i:]
}

func (m *Mission) editorName() string {
	if m.model.EditorLabel == "" {
		return "External Editor"
	}
	return m.model.EditorLabel
}

func (m *Mission) menuItems(t menuTarget) (string, []picker.MenuItem) {
	var title string
	var items []picker.MenuItem
	switch t.kind {
	case targetChange:
		title = t.path
		items = m.changeItems(t)
	case targetHistoryFile:
		title = t.path
		items = m.historyFileItems(t)
	case targetCommit:
		title = t.summary
		if title == "" {
			title = emptyCommitSummary
		}
		items = m.commitItems(t)
	default:
		title = "Actions"
	}
	return title, append(items, m.boardItems()...)
}

func (m *Mission) changeItems(t menuTarget) []picker.MenuItem {
	isIgnoreFile := path.Base(t.path) == ".gitignore"
	deleted := t.status == "deleted"
	items := []picker.MenuItem{
		{ID: "discard-file", Label: "Discard Changes…", Section: 0},
		{ID: "ignore-file", Label: "Ignore File (Add to .gitignore)", Section: 1, Disabled: isIgnoreFile},
	}
	if path.Dir(t.path) != "." {
		items = append(items, picker.MenuItem{ID: "ignore-folder", Label: "Ignore Folder (Add to .gitignore)…", Section: 1, Disabled: isIgnoreFile})
	}
	if ext := jsExtname(t.path); ext != "" {
		items = append(items, picker.MenuItem{ID: "ignore-extension", Label: "Ignore All " + ext + " Files (Add to .gitignore)", Section: 1})
	}
	return append(items,
		picker.MenuItem{ID: "copy-path", Label: "Copy File Path", Section: 2},
		picker.MenuItem{ID: "copy-relative-path", Label: "Copy Relative File Path", Section: 2},
		picker.MenuItem{ID: "reveal", Label: "Reveal in Finder", Section: 3, Disabled: deleted},
		picker.MenuItem{ID: "open-editor", Label: "Open in " + m.editorName(), Section: 3, Disabled: deleted},
		picker.MenuItem{ID: "open-default", Label: "Open with Default Program", Section: 3, Disabled: deleted},
	)
}

func (m *Mission) historyFileItems(t menuTarget) []picker.MenuItem {
	if !t.onDisk {
		return []picker.MenuItem{{ID: "missing", Label: "File Does Not Exist on Disk", Disabled: true}}
	}
	return []picker.MenuItem{
		{ID: "reveal", Label: "Reveal in Finder", Section: 0},
		{ID: "open-editor", Label: "Open in " + m.editorName(), Section: 0},
		{ID: "open-default", Label: "Open with Default Program", Section: 0},
		{ID: "copy-path", Label: "Copy File Path", Section: 1},
		{ID: "copy-relative-path", Label: "Copy Relative File Path", Section: 1},
	}
}

func (m *Mission) commitItems(t menuTarget) []picker.MenuItem {
	var items []picker.MenuItem
	if lc := m.model.Commit.LastCommit; t.newest && lc != nil && lc.Undoable {
		items = append(items, picker.MenuItem{ID: "undo", Label: "Undo Commit…", Section: 0})
	}
	return append(items,
		picker.MenuItem{ID: "branch-from", Label: "Create Branch from Commit", Section: 1},
		picker.MenuItem{ID: "tag", Label: "Create Tag…", Section: 1},
		picker.MenuItem{ID: "copy-sha", Label: "Copy SHA", Section: 2},
	)
}

// boardItems mirrors listKey and historyTabKey: each keyed row replays its
// key through the handler of the tab the menu opened on, so the lists must
// change together.
func (m *Mission) boardItems() []picker.MenuItem {
	key := func(k, label string) picker.MenuItem {
		return picker.MenuItem{ID: "key:" + k, Label: label, Hint: k, Section: boardSection, Quiet: true}
	}
	action := key("f", m.model.Action.Title)
	action.Disabled = m.model.Action.Busy
	var items []picker.MenuItem
	if m.historyTab() {
		items = []picker.MenuItem{action, key("b", "Switch Branch…"), key("w", "Worktrees…"), key("r", "Repositories…"), key("/", "Filter"), key("e", "Expand"), key("1", "Show Changes")}
	} else {
		items = []picker.MenuItem{key("c", "Commit"), action, key("b", "Switch Branch…"), key("w", "Worktrees…"), key("r", "Repositories…"), key("/", "Filter")}
		if lc := m.model.Commit.LastCommit; lc != nil && lc.Undoable {
			items = append(items, key("u", "Undo Last Commit"))
		}
		items = append(items, key("2", "Show History"))
	}
	return append(items,
		picker.MenuItem{ID: "open-repo-editor", Label: "Open Repository in " + m.editorName(), Section: boardSection, Quiet: true},
		picker.MenuItem{ID: "reveal-repo", Label: "Reveal Repository in Finder", Section: boardSection, Quiet: true},
	)
}

// openMenu anchors the box at a right-click's cell; a nil anchor (ctrl-k)
// centers it.
func (m *Mission) openMenu(t menuTarget, anchor *picker.MenuAnchor) {
	title, items := m.menuItems(t)
	m.blurCommitInputs()
	m.menu = picker.NewMenu(title, items, anchor)
	m.menu.FitParentHeight()
	m.menuTarget = t
	m.menuOnHistory = m.historyTab()
	m.menuPrevFocus = m.focus
	m.focus = focusMenu
}

// closeMenu returns focus to where the menu opened from. The commit inputs
// were blurred on open, so a menu opened from one lands on the list.
func (m *Mission) closeMenu() {
	m.menu = nil
	m.focus = m.menuPrevFocus
	if m.focus == focusMenu || m.focus == focusSummary || m.focus == focusDescription {
		m.focus = focusList
	}
}

// historyRange is a shift selection spanning more than the cursor commit.
func (m *Mission) historyRange() bool {
	return m.historyAnchor != "" && m.historyAnchor != m.historyCursor
}

// focusedTarget is ctrl-k's target: the row the focused region acts on.
// A range, the "Load more" row, or a cursor commit the filter hides has no
// single commit to act on.
func (m *Mission) focusedTarget() menuTarget {
	if m.historyTab() {
		if m.focus == focusHistoryFiles || m.focus == focusDiff {
			return m.historyFileTarget(m.historyFile)
		}
		idx := m.historyIndex(m.historyCursor)
		if m.historyOnMoreRow() || m.historyRange() || !slices.Contains(m.historyVisible(), idx) {
			return menuTarget{}
		}
		return m.commitTarget(idx)
	}
	return m.changeTarget(m.selected)
}

func (m *Mission) changeTarget(p string) menuTarget {
	for _, c := range m.model.Changes {
		if c.Path == p {
			return menuTarget{kind: targetChange, path: c.Path, status: c.Status}
		}
	}
	return menuTarget{}
}

func (m *Mission) historyFileTarget(p string) menuTarget {
	for _, f := range m.model.History.Files {
		if f.Path == p {
			return menuTarget{kind: targetHistoryFile, path: f.Path, status: f.Status, onDisk: f.OnDisk}
		}
	}
	return menuTarget{}
}

func (m *Mission) commitTarget(idx int) menuTarget {
	commits := m.model.History.Commits
	if idx < 0 || idx >= len(commits) {
		return menuTarget{}
	}
	c := commits[idx]
	return menuTarget{kind: targetCommit, sha: c.Sha, short: c.ShortSha, summary: c.Summary, newest: idx == 0}
}

func (m *Mission) emitMenuAction(action string, t menuTarget, name string) tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:menu-action", Payload: mustPayload(menuActionPayload{Action: action, Path: t.path, Sha: t.sha, Name: name})})
}

// runMenuOutcome drops MenuPassthrough: every board row's key is a plain
// character, which the menu takes as filter text, and a chord typed into
// the Create Tag name step must never fire a board binding.
func (m *Mission) runMenuOutcome(out picker.MenuOutcome) (tea.Model, tea.Cmd) {
	t := m.menuTarget
	switch out.Kind {
	case picker.MenuClosed:
		m.closeMenu()
	case picker.MenuNamed:
		m.closeMenu()
		return m, m.emitMenuAction("create-tag", t, out.Name)
	case picker.MenuChosen:
		return m.runMenuItem(out.Item)
	}
	return m, nil
}

func (m *Mission) runMenuItem(it picker.MenuItem) (tea.Model, tea.Cmd) {
	t := m.menuTarget
	if k, ok := strings.CutPrefix(it.ID, "key:"); ok {
		if m.menuOnHistory != m.historyTab() {
			m.closeMenu()
			return m, nil
		}
		m.closeMenu()
		press := tea.KeyPressMsg{Code: []rune(k)[0], Text: k}
		if m.menuOnHistory {
			return m.historyTabKey(press)
		}
		// The Changes diff binds none of these keys; the list binds them all.
		m.focus = focusList
		return m.listKey(press)
	}
	if folder, ok := strings.CutPrefix(it.ID, "ignore-folder:"); ok {
		m.closeMenu()
		return m, m.emitMenuAction("ignore-folder", menuTarget{path: folder}, "")
	}
	switch it.ID {
	case "discard-file":
		m.menu.Push("Discard all changes to "+path.Base(t.path)+"?", []picker.MenuItem{
			{ID: "discard-confirm", Label: "Discard Changes"},
			{ID: "discard-cancel", Label: "Cancel"},
		})
		return m, nil
	case "discard-confirm":
		m.closeMenu()
		return m, m.emitMenuAction("discard-file", t, "")
	case "discard-cancel":
		m.closeMenu()
		return m, nil
	case "ignore-folder":
		m.menu.Push("Ignore Folder (Add to .gitignore)", ignoreFolderItems(t.path))
		return m, nil
	case "tag":
		m.menu.AskName("Create a Tag", "Name", it)
		return m, nil
	case "branch-from":
		m.closeMenu()
		return m.openBranchModalFrom(t.sha, t.short)
	case "undo":
		m.closeMenu()
		return m, m.em.Emit(protocol.Intent{Name: "mission:undo"})
	case "reveal-repo", "open-repo-editor":
		m.closeMenu()
		return m, m.emitMenuAction(it.ID, menuTarget{}, "")
	}
	m.closeMenu()
	return m, m.emitMenuAction(it.ID, t, "")
}

// ignoreFolderItems is GitHub Desktop's Ignore Folder submenu: every
// ancestor folder, deepest first, rooted with a leading slash.
func ignoreFolderItems(p string) []picker.MenuItem {
	parts := strings.Split(p, "/")
	parts = parts[:len(parts)-1]
	items := make([]picker.MenuItem, 0, len(parts))
	for i := len(parts); i > 0; i-- {
		label := "/" + strings.Join(parts[:i], "/")
		items = append(items, picker.MenuItem{ID: "ignore-folder:" + label, Label: label})
	}
	return items
}
