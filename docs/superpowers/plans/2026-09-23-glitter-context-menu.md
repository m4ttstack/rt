# glitter Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click on a file or commit row in `rt glitter` opens GitHub Desktop's context menu for that row, and ctrl-k opens the same menu (plus a board-wide section) for whatever has focus.

**Architecture:** The picker's registry menu (`ui/internal/views/picker/modal.go`) becomes an exported engine, `picker.Menu`, that the picker and glitter both drive. glitter builds each menu in Go from one action table and the row data it already has; rows that mirror a key replay that key, every other row emits one new intent, `mission:menu-action`, which the TS driver runs through git-core (new GitHub Desktop ports for `.gitignore` and whole-file discard) or through `lib/file-actions.ts` (lifted out of `rt nav`).

**Tech Stack:** Go + Bubble Tea v2 + lipgloss v2 (rt-ui), Bun + TypeScript (driver, git-core), termwright (pty gate).

**Spec:** `docs/superpowers/specs/2026-09-23-glitter-context-menu-design.md`

**GHD source of truth:** `~/Documents/GitHub/github-desktop` at commit `9dfe6e60`. Paths written `app/src/...` are relative to that clone. Read the named function before porting it.

## Global Constraints

- The rt repo is PUBLIC. Never write a Linear ticket id (the letters R, T, a hyphen, then digits) or an employer name into source, tests, comments, fixtures, or commit messages. Run `bash scripts/repo-purity.sh` before every commit.
- Never use em dashes or en dashes anywhere (code, comments, docs, commit messages). Use "..." or rephrase. Menu labels use the single-character ellipsis `…` exactly where GitHub Desktop does.
- Comments state only constraints the code cannot show (parity anchors, ordering traps, invariants). No narration, no reviewer-facing justification, no decision history, no task numbers.
- Every color is a `theme.go` token (`ui/internal/theme/theme.go`). Never an inline hex or `lipgloss.Color("...")`.
- Lift, don't duplicate: one menu engine (`picker.Menu`), one foreground-dimming transform (`picker.DimForeground`), `clip`/`clipOn` for mission text, `picker.Rank` for filtering. A second copy of any of these is a defect.
- lipgloss `Width()` WRAPS rather than truncates. Clip before `Width()`. Any painted line must be mirrored exactly by the hit test that reads it.
- Menu labels are GitHub Desktop's macOS labels verbatim (section 3 of the spec).
- After any change under `ui/`, run `bun run ui:build`. Never `git add ui/dist/rt-ui` or `docs/design/mission/mission.pen` (the controller commits the board).
- A built binary is only ever run under an isolated HOME (`env -i HOME=<tmp> PATH=$PATH ...`).
- Worktree sessions refuse compound shell commands: run plain single commands (no `&&`, heredocs, `cd x && ...`, or `git -C`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Test commands (run sequentially; another session shares the machine): `bun test packages/git-core`, `bun test lib/mission`, `bun test lib/ui`, `bun test commands/__tests__/nav.test.ts`, `bunx tsc --noEmit`, from `ui/`: `go test ./internal/views/picker/ ./internal/views/mission/ ./internal/protocol/`, and `bun run test:pty`.

## Rulings made while planning

1. **`picker.Menu` lives in the picker package**, exported beside `Viewport` and `Rank`. A separate package would need `Rank` and create an import cycle.
2. **Picker tests may change accessors only.** `picker_test.go` reaches into modal internals (`m.modal.rows`, `m.modalBox`, `m.modalHover`, ...). The lift may rename those accessors in the tests; it may not change any expected value, and `render_test.go`, `cli_replay_test.go`, `tmux_replay_test.go`, and `picker_e2e_test.go` stay byte-identical.
3. **ctrl-k inside a text field stays the field's own binding** (bubbles' textinput uses ctrl+k to delete to end of line). The menu opens from the Changes list, the diff, the History list, and the History file column.
4. **A menu keeps the target it opened for.** A model push while the menu is open never retargets or closes it; the driver answers a vanished target with a notice.
5. **Unit tests cannot read intent payloads** (`New(nil)` has no emitter). Payload assertions live in session tests through the real binary (`openMission`, `sgrClick`); unit tests assert menu state and that a command was returned.
6. **The editor launches detached.** `launchEditor` in `commands/code.ts` runs `execSync` with inherited stdio, which would block the driver and paint over the board. glitter gets an async, stdio-ignored launch with the same app-bundle fallback.
7. **History file existence is computed once per changeset and on every refresh,** never per push, following `MissionDeps`' caching contract for sync calls.
8. **Board-wide rows carry `Quiet`** (Dimmer text), like nav's global-scope rows.

## Review Focus

1. **Paths with gitignore specials and spaces** (`a b/[x]#!.txt`): Ignore File escapes `[ ] ! * # ?` exactly as GHD does, and reveal/open/copy pass the path as one argv element, never through a shell. Tests in Task 4 (`escapeGitSpecialCharacters`) and Task 5 (driver passes the untouched absolute path to `fileActions`).
2. **A menu at the frame's right and bottom edges, and at 80 columns:** the box slides left/up to fit, is never wider than the frame, and every row's click lands on the painted row. Tests in Task 2 (`TestMenuSlidesInsideTheFrame`) and Task 6 (`TestMenuHitMatchesPaintAtEveryWidth`).
3. **The target vanishes while the menu is open** (another tool discards the file): choosing Discard answers "x has no changes to discard" and changes nothing. Test in Task 5.
4. **Right-click while a foldout is open or a text field has focus:** with a foldout open the click only closes the foldout; with the summary focused, a right-click on a row opens the menu and blurs the field; ctrl-k in a text field never opens the menu. Tests in Task 6.
5. **Dotfiles and odd extensions in labels** (`.env`, `.env.local`, `a.tar.gz`, `Makefile`, `a.`): the Go label and the TS pattern agree with Node's `path.extname`. Tests in Task 5 (TS table) and Task 6 (the same table in Go).

## File Structure

| File | Responsibility |
|---|---|
| `ui/internal/views/picker/menu.go` (new) | `Menu`, `MenuItem`, `MenuAnchor`, `MenuOutcome`: rows, sections, disabled rows, filter, cursor, hover, steps, placement, rendering, hit zones; `DimForeground`. |
| `ui/internal/views/picker/modal.go` | Picker's registry menu and TS-driven modal become thin callers of `Menu`. |
| `ui/internal/views/picker/mouse.go`, `picker.go` | Modal mouse and key routing call `Menu`. |
| `ui/internal/views/mission/modal.go` | Foldouts drop their dimming copy and call `picker.DimForeground`. |
| `ui/internal/views/mission/menu.go` (new) | glitter's action table, targets, row sets, open/close, key/mouse routing, running a row. |
| `ui/internal/views/mission/mission.go`, `history.go`, `changes.go` | `focusMenu`, routing, right-click, ctrl-k, keybar entry. |
| `ui/internal/views/mission/model.go` | `EditorLabel`, `HistoryFileRow.OnDisk`. |
| `packages/git-core/src/gitignore.ts` (new) | GHD `gitignore.ts` port. |
| `packages/git-core/src/discard.ts` (new) | GHD `discardChanges` with its helpers (`getIndexChanges`, `resetPaths`, `checkoutIndex`, `listSubmodules`, `resetSubmodulePaths`). |
| `packages/git-core/src/types.ts`, `client.ts`, `index.ts` | Three new `GitClient` methods and exports. |
| `lib/file-actions.ts` (new) | Clipboard, reveal, open: the calls `rt nav` makes today. |
| `commands/nav.ts` | Calls `lib/file-actions.ts`. |
| `commands/code.ts` | Exports `resolveEditorForDir` and `launchEditorDetached`. |
| `lib/ui/protocol.ts`, `lib/mission/model.ts`, `lib/mission/history-model.ts`, `lib/mission/driver.ts`, `commands/glitter.ts` | Wire fields, `mission:menu-action`, deps. |
| `ui/fixtures/session-model-mission.json`, `session-model-mission-history.json` | Golden fixtures gain the new fields. |
| `e2e/pty/glitter.test.ts` | ctrl-k round trip through the binary. |
| `docs/design/mission/README.md`, `mission.pen`, `ContextMenu.png` (new) | Board, section, deviations, geometry. |

---

### Task 1: Context menu board and delivery check (controller-owned, gated on Matt)

**Files:**
- Modify: `docs/design/mission/mission.pen` (through the Pencil MCP only)
- Create: `docs/design/mission/ContextMenu.png`, `docs/design/mission/ContextMenuStates.png`

This task is the controller's. It runs while Tasks 2 to 5 are implemented; Task 6 does not start until Matt has signed off the exported pictures (open them for him; a bare path does not count).

- [ ] **Step 1: Delivery check.** In a tmux session running `rt glitter` from this worktree (`scratchpad/live-history.sh start 150 40` pointed at this worktree's `cli.ts`), send an SGR right press over a Changes file row with `tmux send-keys -t histlook -l $'\e[<2;10;12M'` and confirm the notice "menu lands with polish" appears. Send ctrl-k (`tmux send-keys -t histlook C-k`) and confirm the frame does not change (unbound today, so it must reach the view without side effects). Record both results in the ledger. If either key fails to arrive, stop and raise it with Matt before any UI work.
- [ ] **Step 2: Draw the board** beside the History boards: a Changes file menu anchored at a pointer near the right edge (slid left), a commit menu, ctrl-k centered with only the board-wide section, disabled rows, the Discard question step, the Create Tag name step, the History "File Does Not Exist on Disk" menu, and a hovered row next to the cursor row. Tokens from `theme.go` only: Surface box, Panel border, SelBg + Pink bar cursor, HoverBg hover, TextSoft item rows, Dimmer board rows, Faint disabled rows, KeybarKey hints, Rule dividers.
- [ ] **Step 3: Export** `ContextMenu.png` and `ContextMenuStates.png`, `open` both for Matt, and get his sign-off.
- [ ] **Step 4: Commit** the pen file and PNGs after Matt saves in Pencil: `git add docs/design/mission/mission.pen docs/design/mission/ContextMenu.png docs/design/mission/ContextMenuStates.png`, message `docs: context menu boards`.

---

### Task 2: Lift the picker's menu into `picker.Menu`

**Files:**
- Create: `ui/internal/views/picker/menu.go`, `ui/internal/views/picker/menu_test.go`
- Modify: `ui/internal/views/picker/modal.go`, `mouse.go`, `picker.go`, `picker_test.go` (accessors only), `ui/internal/views/mission/modal.go`

**Interfaces:**
- Produces (exact, later tasks rely on these):

```go
package picker

// MenuAnchor is the frame cell a right-click opened a menu at.
type MenuAnchor struct{ X, Y int }

// MenuItem is one menu row. A rule paints between two visible rows whose
// Section differs.
type MenuItem struct {
	ID       string
	Label    string
	Hint     string
	Section  int
	Quiet    bool
	Disabled bool
	Value    string
}

type MenuOutcomeKind int

const (
	MenuStay MenuOutcomeKind = iota
	MenuClosed
	MenuChosen
	MenuNamed
	MenuPassthrough
)

type MenuOutcome struct {
	Kind MenuOutcomeKind
	Item MenuItem
	Name string
	Key  string
}

func NewMenu(title string, items []MenuItem, anchor *MenuAnchor) *Menu
func (mn *Menu) Key(msg tea.KeyPressMsg) MenuOutcome
func (mn *Menu) Click(x, y int) MenuOutcome
func (mn *Menu) Motion(x, y int)
func (mn *Menu) Render(parent string, width int) string
func (mn *Menu) BoxHeight(width int) int
func (mn *Menu) SetAnchor(a *MenuAnchor)
func (mn *Menu) Title() string
func DimForeground(s string) string
```

- Consumes: `Rank`, `Match`, `clipRunes`, `keyGlyph`, `theme` tokens (all existing in the picker package).

The lift moves code; it does not redesign it. `Menu` owns what `modalState` plus the Model's `modalHover`/`modalZones`/`modalBox` own today: title, rows, query, matches, cursor, anchor, hover, zones, box rectangle. Keep the internal field names `title`, `rows`, `query`, `matches`, `cursor`, `anchor` so `picker_test.go`'s accessors keep resolving through embedding (below).

- [ ] **Step 1: Write the failing tests** in `menu_test.go`:

```go
package picker

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func menuItems() []MenuItem {
	return []MenuItem{
		{ID: "a", Label: "Open with…", Section: 0},
		{ID: "b", Label: "Reveal in Finder", Section: 0},
		{ID: "c", Label: "Sort", Hint: "⌃s", Section: 1, Quiet: true},
	}
}

func TestMenuEnterChoosesTheCursorRow(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if out.Kind != MenuChosen || out.Item.ID != "b" {
		t.Fatalf("got %+v, want b chosen", out)
	}
}

func TestMenuEscAtTheRootCloses(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuClosed {
		t.Fatalf("esc = %+v, want MenuClosed", out)
	}
}

func TestMenuTypingFiltersAndAChordPassesThrough(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	for _, r := range "rev" {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "b" {
		t.Fatalf("filtered enter chose %q, want b", out.Item.ID)
	}
	mn = NewMenu("x.go", menuItems(), nil)
	if out := mn.Key(tea.KeyPressMsg{Code: 's', Mod: tea.ModCtrl}); out.Kind != MenuPassthrough || out.Key != "ctrl+s" {
		t.Fatalf("chord = %+v, want passthrough ctrl+s", out)
	}
}

func TestMenuRuleSeparatesSections(t *testing.T) {
	mn := NewMenu("x.go", menuItems(), nil)
	frame := mn.Render(strings.Repeat(strings.Repeat(" ", 80)+"\n", 23)+strings.Repeat(" ", 80), 80)
	plain := ansi.Strip(frame)
	reveal := strings.Index(plain, "Reveal in Finder")
	sort := strings.Index(plain, "Sort")
	if reveal < 0 || sort < 0 || !strings.Contains(plain[reveal:sort], "─") {
		t.Fatal("a rule must paint between section 0 and section 1")
	}
}

func TestMenuSlidesInsideTheFrame(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	mn := NewMenu("x.go", menuItems(), &MenuAnchor{X: 78, Y: 22})
	frame := mn.Render(parent, 80)
	for i, line := range strings.Split(frame, "\n") {
		if w := lipgloss.Width(line); w != 80 {
			t.Fatalf("line %d is %d wide, want 80", i, w)
		}
	}
	if got := len(strings.Split(frame, "\n")); got != 24 {
		t.Fatalf("frame is %d lines, want 24", got)
	}
}

func TestMenuClickChoosesThePaintedRowAndOutsideCloses(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	mn := NewMenu("x.go", menuItems(), &MenuAnchor{X: 10, Y: 5})
	frame := ansi.Strip(mn.Render(parent, 80))
	lines := strings.Split(frame, "\n")
	for y, line := range lines {
		if x := strings.Index(line, "Reveal in Finder"); x >= 0 {
			if out := mn.Click(lipgloss.Width(line[:x]), y); out.Kind != MenuChosen || out.Item.ID != "b" {
				t.Fatalf("click on the painted row = %+v", out)
			}
		}
	}
	if out := mn.Click(0, 0); out.Kind != MenuClosed {
		t.Fatalf("click outside = %+v, want MenuClosed", out)
	}
}
```

`ansi` is `github.com/charmbracelet/x/ansi`, which the mission tests already import for `ansi.Strip`.

- [ ] **Step 2: Run** `go test ./internal/views/picker/ -run 'TestMenu'` from `ui/`. Expected: FAIL, `undefined: NewMenu`.

- [ ] **Step 3: Implement `menu.go` by moving code.** Move from `modal.go` into `menu.go` unchanged except for names: `modalOrigin` (becomes a `*Menu` method reading `mn.anchor`), `modalInner`, `modalBoxLines`, `modalBoxFrame`, `modalContentWidth`, `modalJustify`, `modalHeaderLine`, `modalFilterLine`, `modalRuleLine`, `modalNoMatchLine`, `modalRowLine`, `surfaceBg`, `sfg`, `modalMinWidth`, `modalTitleCap`, `fgTrueColorSGR`, `dimRamp`, `rgbKey`, `dimBlend`, `blendTowardBg`, `blendChannel`, and `dimForeground` (exported as `DimForeground`; every picker caller updated). Move `modalBoxRect` from `mouse.go` and the zone recording from `recordModalZones`. The row type becomes:

```go
type menuRow struct {
	text     string
	hint     string
	section  int
	quiet    bool
	disabled bool
	id       string
	value    string
}

type Menu struct {
	title   string
	rows    []menuRow
	query   string
	matches []Match
	cursor  int
	anchor  *MenuAnchor
	hover   int
	zones   hitZones
	box     modalBoxRect
}

func NewMenu(title string, items []MenuItem, anchor *MenuAnchor) *Menu {
	rows := make([]menuRow, len(items))
	for i, it := range items {
		rows[i] = menuRow{text: it.Label, hint: it.Hint, section: it.Section, quiet: it.Quiet, disabled: it.Disabled, id: it.ID, value: it.Value}
	}
	mn := &Menu{title: title, rows: rows, anchor: anchor, hover: -1}
	mn.refilter()
	return mn
}
```

The divider rule generalizes `modalDividerBefore` to a section change:

```go
func (mn *Menu) dividerBefore(i int) bool {
	return i > 0 && mn.rows[mn.matches[i].Index].section != mn.rows[mn.matches[i-1].Index].section
}
```

Row tone: `quiet` rows read Dimmer, others TextSoft (today's `isGlobal` rule). `Key` carries `updateModal`'s navigation and typing; esc returns `MenuClosed`; enter returns `MenuChosen` with the cursor row; a key with no `Text` that the menu does not own returns `MenuPassthrough` with `Key: msg.String()` normalized through `canonicalKey`. `Click` returns `MenuChosen` for a row zone, `MenuClosed` outside the box, `MenuStay` inside it. `Motion` sets `hover` from the zones. `Render(parent, width)` is today's `renderModal` body: `DimForeground(parent)`, box at the origin, compositor, zones recorded. `BoxHeight(width)` is `lipgloss.Height` of the unhovered box.

- [ ] **Step 4: Rewire the picker.** `modalState` becomes:

```go
type modalState struct {
	kind modalKind
	*Menu
}
```

`openRegistryMenu` builds items from `deriveMenu`: rows before the `Rule` sentinel get `Section: 0`, rows after it `Section: 1, Quiet: true`, `Hint: keyGlyph(r.Key)`, `ID: r.ActionID`. `openTSModal` builds items with `Label: leftPlainText(r)`, `Hint: plainConcat(r.Right)`, `Value: r.Value`. `updateModal` calls `m.modal.Key(msg)` and maps the outcome: `MenuClosed` to today's esc path (`closeModal`, `armPinRelease`, `tea.ClearScreen`), `MenuChosen` to `selectModalRow`'s dispatch (registry: `actionByID(m.req.Actions, item.ID)`; TS: `writeModalResult(&item.Value)`), `MenuPassthrough` on a registry menu to `actionForKey`. `modalMouseClick` and `modalMouseMotion` call `Click` and `Motion`. `registryMenuHeight` uses `NewMenu(...).BoxHeight(m.width)`. Delete the Model fields `modalHover`, `modalZones`, `modalBox`.

- [ ] **Step 5: Update `picker_test.go` accessors only** (`m.modalBox` becomes `m.modal.box`, `m.modalHover` becomes `m.modal.hover`, `.isGlobal` becomes `.quiet`, `dimForeground` becomes `DimForeground`, and so on). Change no expected value.

- [ ] **Step 6: Mission foldouts use the shared dimming.** In `ui/internal/views/mission/modal.go`, delete `modalDimRamp`, `rgbKeyOf`, `modalDimBlend`, `modalBlendChannel`, `modalBlendTowardBg`, `modalFgSGR`, and `dimForeground`; `renderMissionModal` calls `picker.DimForeground`. Update mission tests that called the local `dimForeground` to `picker.DimForeground`.

- [ ] **Step 7: Run** from `ui/`: `go test ./internal/views/picker/ ./internal/views/mission/`. Expected: PASS, including every pre-existing picker test. Then `git diff --stat -- ui/internal/views/picker/render_test.go ui/internal/views/picker/cli_replay_test.go ui/internal/views/picker/tmux_replay_test.go ui/internal/views/picker/picker_e2e_test.go` must print nothing. Then `bun run ui:build`.

- [ ] **Step 8: Commit** `git add ui/internal/views/picker ui/internal/views/mission/modal.go ui/internal/views/mission/*_test.go`, message `picker: lift the registry menu into an exported Menu both the picker and glitter drive`.

---

### Task 3: Menu abilities: disabled rows, question step, name step

**Files:**
- Modify: `ui/internal/views/picker/menu.go`, `ui/internal/views/picker/menu_test.go`

**Interfaces:**
- Consumes: Task 2's `Menu`.
- Produces:

```go
// Push swaps in a follow-up step (a question or a list); esc returns to the
// rows it replaced, and a click outside still closes the whole menu.
func (mn *Menu) Push(title string, items []MenuItem)

// AskName turns the filter line into a name field for item; enter with a
// non-blank name returns MenuNamed{Item: item, Name: trimmed}, esc returns
// to the rows.
func (mn *Menu) AskName(title, placeholder string, item MenuItem)
```

- [ ] **Step 1: Write the failing tests:**

```go
func TestMenuCursorSkipsDisabledRows(t *testing.T) {
	items := []MenuItem{
		{ID: "a", Label: "Reveal in Finder", Disabled: true},
		{ID: "b", Label: "Open in Zed"},
		{ID: "c", Label: "Open with Default Program", Disabled: true},
		{ID: "d", Label: "Copy File Path", Section: 1},
	}
	mn := NewMenu("x.go", items, nil)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "b" {
		t.Fatalf("the first cursor stop is %q, want b", out.Item.ID)
	}
	mn.Key(tea.KeyPressMsg{Code: tea.KeyDown})
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "d" {
		t.Fatalf("down from b lands on %q, want d", out.Item.ID)
	}
}

func TestMenuDisabledRowIsInertToClickAndHover(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	items := []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}, {ID: "b", Label: "Open in Zed"}}
	mn := NewMenu("x.go", items, &MenuAnchor{X: 4, Y: 4})
	lines := strings.Split(ansi.Strip(mn.Render(parent, 80)), "\n")
	for y, line := range lines {
		if x := strings.Index(line, "Reveal in Finder"); x >= 0 {
			cx := lipgloss.Width(line[:x])
			if out := mn.Click(cx, y); out.Kind != MenuStay {
				t.Fatalf("click on a disabled row = %+v, want MenuStay", out)
			}
			mn.Motion(cx, y)
			if mn.hover != -1 {
				t.Fatal("a disabled row never takes hover")
			}
		}
	}
}

func TestMenuDisabledRowPaintsFaint(t *testing.T) {
	items := []MenuItem{{ID: "a", Label: "Reveal in Finder", Disabled: true}, {ID: "b", Label: "Open in Zed"}}
	mn := NewMenu("x.go", items, nil)
	frame := mn.Render(strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n"), 80)
	line := ""
	for _, l := range strings.Split(frame, "\n") {
		if strings.Contains(ansi.Strip(l), "Reveal in Finder") {
			line = l
		}
	}
	if !strings.Contains(line, fgSGRFor(theme.Faint)) {
		t.Fatal("a disabled row's label paints Faint")
	}
}

func TestMenuPushedStepEscReturnsToTheRows(t *testing.T) {
	mn := NewMenu("x.go", []MenuItem{{ID: "discard", Label: "Discard Changes…"}}, nil)
	mn.Push("Discard all changes to x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}, {ID: "no", Label: "Cancel"}})
	if mn.Title() != "Discard all changes to x.go?" {
		t.Fatalf("title = %q", mn.Title())
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEscape}); out.Kind != MenuStay {
		t.Fatalf("esc in a step = %+v, want MenuStay", out)
	}
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Item.ID != "discard" {
		t.Fatalf("after esc the root rows are back, got %q", out.Item.ID)
	}
}

func TestMenuNameStepSubmitsATrimmedName(t *testing.T) {
	tag := MenuItem{ID: "tag", Label: "Create Tag…"}
	mn := NewMenu("fix the thing", []MenuItem{tag}, nil)
	mn.AskName("Create a Tag", "Name", tag)
	if out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter}); out.Kind != MenuStay {
		t.Fatalf("enter on a blank name = %+v, want MenuStay", out)
	}
	for _, r := range " v1.2.0 " {
		mn.Key(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	out := mn.Key(tea.KeyPressMsg{Code: tea.KeyEnter})
	if out.Kind != MenuNamed || out.Name != "v1.2.0" || out.Item.ID != "tag" {
		t.Fatalf("got %+v", out)
	}
}

func TestMenuStepsKeepTheBoxInsideTheFrame(t *testing.T) {
	parent := strings.TrimSuffix(strings.Repeat(strings.Repeat(" ", 80)+"\n", 24), "\n")
	mn := NewMenu("x.go", []MenuItem{{ID: "a", Label: "Discard Changes…"}}, &MenuAnchor{X: 79, Y: 23})
	mn.Push(strings.Repeat("Discard all changes to a/very/long/path/", 4)+"x.go?", []MenuItem{{ID: "yes", Label: "Discard Changes"}})
	for _, line := range strings.Split(mn.Render(parent, 80), "\n") {
		if w := lipgloss.Width(line); w != 80 {
			t.Fatalf("a step's frame line is %d wide, want 80", w)
		}
	}
}
```

`fgSGRFor` returns `"38;2;" + rgbKey(c)`; add it to `menu_test.go` along with the `rt-ui/internal/theme` import.

- [ ] **Step 2: Run** `go test ./internal/views/picker/ -run 'TestMenu'`. Expected: FAIL (`undefined: (*Menu).Push`, disabled rows selectable).

- [ ] **Step 3: Implement.** Disabled rows: `refilter` puts the cursor on the first enabled match (`-1` when none); `moveCursor` steps over disabled matches and stays put when no enabled row lies in that direction; enter with cursor `-1` is `MenuStay`; `Click` on a disabled row's zone is `MenuStay`; `Motion` leaves `hover` at `-1` over one; `modalRowLine` paints a disabled row's label and hint in Faint and never paints hover or cursor on it. Steps: a `stack []menuLevel` where `menuLevel` holds `title, rows, query, matches, cursor, naming, nameFor, name, placeholder`; `Push` and `AskName` push the current level and install the new one; esc with a non-empty stack pops (`MenuStay`), at the root closes (`MenuClosed`). In a name step, typed text and backspace edit `name` (not `query`, so nothing refilters), the filter line paints the name in Text or the placeholder in Faint after the chevron, enter with `strings.TrimSpace(name) != ""` returns `MenuNamed`. The header's right text reads `esc back` inside a step and `esc dismiss` at the root.

- [ ] **Step 4: Run** `go test ./internal/views/picker/`. Expected: PASS. Then `bun run ui:build`.

- [ ] **Step 5: Commit** `git add ui/internal/views/picker`, message `picker: menus gain disabled rows, a follow-up question step, and a name step`.

---

### Task 4: git-core: `.gitignore` and whole-file discard ports

**Files:**
- Create: `packages/git-core/src/gitignore.ts`, `packages/git-core/src/discard.ts`, `packages/git-core/src/__tests__/gitignore.test.ts`, `packages/git-core/src/__tests__/discard.test.ts`
- Modify: `packages/git-core/src/types.ts`, `client.ts`, `index.ts`, `packages/git-core/src/vendor/ghd/README.md` (vendor table: note the ported functions and the commit)

**Interfaces:**
- Produces on `GitClient`:

```ts
/** GHD appendIgnoreRule: patterns appended verbatim to the root .gitignore. */
appendIgnoreRule(patterns: string | string[]): Promise<void>;
/** GHD appendIgnoreFile: paths escaped (escapeGitSpecialCharacters) then appended. */
appendIgnoreFile(paths: string | string[]): Promise<void>;
/** GHD GitStore.discardChanges: Trash first, then reset and checkout-index only what needs it. */
discardChanges(files: ChangedFile[], opts?: { moveToTrash?: (absPath: string) => Promise<void> }): Promise<void>;
```

- Exported from `index.ts`: `escapeGitSpecialCharacters`.

- [ ] **Step 1: Write the failing tests.** `gitignore.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient, escapeGitSpecialCharacters } from "../index.ts";

describe("escapeGitSpecialCharacters (GHD gitignore.ts)", () => {
  it("backslash-escapes [ ] ! * # ? and nothing else", () => {
    expect(escapeGitSpecialCharacters("a b/[x]#!*?.txt")).toBe("a b/\\[x\\]\\#\\!\\*\\?.txt");
  });
});

describe("appendIgnoreRule / appendIgnoreFile", () => {
  it("creates a missing root .gitignore", async () => {
    const sb = await makeSandbox();
    try {
      await createGitClient(sb.dir).appendIgnoreRule("*.log");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("*.log\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("terminates the existing last line before appending", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write(".gitignore", "node_modules");
      await createGitClient(sb.dir).appendIgnoreFile("dist/[x].js");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("node_modules\ndist/\\[x\\].js\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("with core.autocrlf=false ends the text with CRLF (GHD's own rule)", async () => {
    const sb = await makeSandbox();
    try {
      await sb.git(["config", "core.autocrlf", "false"]);
      await createGitClient(sb.dir).appendIgnoreRule("*.tmp");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("*.tmp\r\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("with core.autocrlf and core.safecrlf both true normalizes every line to CRLF", async () => {
    const sb = await makeSandbox();
    try {
      await sb.git(["config", "core.autocrlf", "true"]);
      await sb.git(["config", "core.safecrlf", "true"]);
      await sb.write(".gitignore", "a\nb\n");
      await createGitClient(sb.dir).appendIgnoreRule("c");
      expect(await readFile(join(sb.dir, ".gitignore"), "utf8")).toBe("a\r\nb\r\nc\r\n\r\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("refuses a symlinked root .gitignore and leaves its target alone", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("elsewhere.txt", "keep\n");
      await symlink(join(sb.dir, "elsewhere.txt"), join(sb.dir, ".gitignore"));
      await expect(createGitClient(sb.dir).appendIgnoreRule("x")).rejects.toThrow(
        "Cannot use a symbolic link as the root .gitignore file",
      );
      expect(await readFile(join(sb.dir, "elsewhere.txt"), "utf8")).toBe("keep\n");
    } finally {
      await sb.cleanup();
    }
  });
});
```

The CRLF expectations follow GHD's `formatGitIgnoreContents` exactly; before asserting, trace the port by hand and correct the expected strings to what GHD's code produces, not what seems natural.

`discard.test.ts` (fake trash moves the file into a scratch dir so the real Trash stays untouched):

```ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { makeSandbox, type Sandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function fakeTrash(): Promise<{ moveToTrash: (abs: string) => Promise<void>; moved: string[] }> {
  const bin = await mkdtemp(join(tmpdir(), "git-core-trash-"));
  const moved: string[] = [];
  return {
    moved,
    moveToTrash: async (abs) => {
      moved.push(abs);
      await rename(abs, join(bin, `${moved.length}-${basename(abs)}`));
    },
  };
}

async function status(sb: Sandbox): Promise<string> {
  return sb.git(["status", "--porcelain=v1", "--untracked-files=all"]);
}

describe("discardChanges (GHD GitStore.discardChanges)", () => {
  it("restores a modified file and trashes the edited copy", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      const trash = await fakeTrash();
      const client = createGitClient(sb.dir);
      await client.discardChanges([{ path: "a.txt", kind: "modified", staged: false, unstaged: true }], trash);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("1\n");
      expect(trash.moved).toEqual([join(sb.dir, "a.txt")]);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("removes an untracked file by trashing it", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("new.txt", "x\n");
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "new.txt", kind: "untracked", staged: false, unstaged: true }], trash);
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("unstages and removes a staged new file", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("added.txt", "x\n");
      await sb.git(["add", "added.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "added.txt", kind: "added", staged: true, unstaged: false }], trash);
      expect(existsSync(join(sb.dir, "added.txt"))).toBe(false);
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("undoes a staged rename, restoring the old path", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("old.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["mv", "old.txt", "new.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges(
        [{ path: "new.txt", kind: "renamed", staged: true, unstaged: false, originalPath: "old.txt" }],
        trash,
      );
      expect(existsSync(join(sb.dir, "new.txt"))).toBe(false);
      expect(await readFile(join(sb.dir, "old.txt"), "utf8")).toBe("1\n");
      expect(await status(sb)).toBe("");
    } finally {
      await sb.cleanup();
    }
  });

  it("restores a deleted file without touching the Trash", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.git(["rm", "-q", "a.txt"]);
      const trash = await fakeTrash();
      await createGitClient(sb.dir).discardChanges([{ path: "a.txt", kind: "deleted", staged: true, unstaged: false }], trash);
      expect(trash.moved).toEqual([]);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("1\n");
    } finally {
      await sb.cleanup();
    }
  });

  it("a failing Trash leaves the tree and the index exactly as they were", async () => {
    const sb = await makeSandbox();
    try {
      await sb.write("a.txt", "1\n");
      await sb.commitAll("first");
      await sb.write("a.txt", "2\n");
      await sb.git(["add", "a.txt"]);
      await sb.write("a.txt", "3\n");
      const before = await status(sb);
      const failing = { moveToTrash: async () => { throw new Error("Trash is full"); } };
      await expect(
        createGitClient(sb.dir).discardChanges([{ path: "a.txt", kind: "modified", staged: true, unstaged: true }], failing),
      ).rejects.toThrow("Trash is full");
      expect(await status(sb)).toBe(before);
      expect(await readFile(join(sb.dir, "a.txt"), "utf8")).toBe("3\n");
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run** `bun test packages/git-core/src/__tests__/gitignore.test.ts packages/git-core/src/__tests__/discard.test.ts`. Expected: FAIL (`appendIgnoreRule is not a function`).

- [ ] **Step 3: Implement `gitignore.ts`** as a verbatim port of GHD `app/src/lib/git/gitignore.ts` (`ensureGitIgnoreIsNotSymbolicLink`, `openExistingGitIgnore`, `readGitIgnoreAtRoot`, `saveGitIgnore`, `appendIgnoreRule`, `appendIgnoreFile`, `escapeGitSpecialCharacters`, `formatGitIgnoreContents`), taking `ctx: ClientContext` where GHD takes `repository`, with `repository.path` becoming `ctx.dir`. GHD's `getConfigValue(repository, key)` becomes:

```ts
async function getConfigValue(ctx: ClientContext, key: string): Promise<string | null> {
  const out = (await rawGit(ctx.dir, ["config", "--get", key], { okCodes: [1] })).trim();
  return out === "" ? null : out;
}
```

GHD's `isErrnoException(error)` becomes `error instanceof Error && "code" in error`. Keep GHD's branch order in `formatGitIgnoreContents` byte for byte, including `autocrlf === 'true'` choosing `\n` and any other set value choosing `\r\n`, with a one-line parity comment naming the GHD function.

- [ ] **Step 4: Implement `discard.ts`** as a port of GHD `GitStore.discardChanges` (`app/src/lib/stores/git-store.ts` 1545-1650) with `moveToTrash` always true and no permanent-delete fallback: a Trash failure throws before any git step. Port its helpers verbatim: `getIndexChanges` (`diff-index --cached --name-status --no-renames -z HEAD --`, retry against `4b825dc642cb6eb9a060e54bf8d69288fbee4904` on exit 128, via `rawGit` with `okCodes: [128]`), `IndexStatus` and `getNoRenameIndexStatus`, `resetPaths(ctx, "HEAD", paths)` (`reset HEAD -- ...paths`, no-op for none), `checkoutIndex` (`checkout-index -f -u -q --stdin -z` with the paths NUL-joined on stdin, `okCodes: [1]`), `listSubmodules` (existence checks on `.gitmodules`, `.git/modules`, and the common dir's `modules` from `rev-parse --absolute-git-dir` plus its `commondir` file, then `submodule status --` with `okCodes: [128]` and GHD's status regex), and `resetSubmodulePaths` (`submodule update --recursive --force -- ...paths`). rt's `ChangedFile.kind` maps to GHD's status kinds as: `"deleted"` is GHD Deleted, `"renamed"` with `originalPath` is GHD Renamed (reset both paths, check out the old one), everything else takes GHD's default branch. Keep GHD's `necessaryPathsToCheckout` filter expression exactly, even though it reads oddly. The default `moveToTrash`:

```ts
async function trashItem(absPath: string): Promise<void> {
  const proc = Bun.spawn(["/usr/bin/trash", absPath], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`Could not move ${absPath} to the Trash${err.trim() ? `: ${err.trim()}` : ""}`);
}
```

- [ ] **Step 5: Wire** the three methods into `GitClient` (`types.ts` with the doc comments above), `createGitClient` (`client.ts`), and export `escapeGitSpecialCharacters` from `index.ts`. Add `expect(typeof client.<name>).toBe("function")` for the three to `client-shape.test.ts`.

- [ ] **Step 6: Run** `bun test packages/git-core`. Expected: PASS. Then `bunx tsc --noEmit`.

- [ ] **Step 7: Commit** `git add packages/git-core`, message `git-core: port GitHub Desktop's gitignore append and whole-file discard`.

---

### Task 5: TS wiring: file actions, editor, wire fields, `mission:menu-action`

**Files:**
- Create: `lib/file-actions.ts`, `lib/__tests__/file-actions.test.ts`, `lib/mission/__tests__/menu-action.test.ts`
- Modify: `commands/nav.ts`, `commands/code.ts`, `commands/glitter.ts`, `lib/ui/protocol.ts`, `lib/mission/model.ts`, `lib/mission/history-model.ts`, `lib/mission/driver.ts`, `ui/internal/views/mission/model.go`, `ui/fixtures/session-model-mission.json`, `ui/fixtures/session-model-mission-history.json`, and the mission test that builds `MissionDeps` fakes (add the new deps to its factory)

**Interfaces:**
- Consumes: Task 4's `appendIgnoreRule`, `appendIgnoreFile`, `discardChanges`; existing `createTag`.
- Produces:

```ts
// lib/file-actions.ts
export interface FileActions {
  copy(text: string): void;
  reveal(absPath: string, kind?: "file" | "folder"): void;
  open(absPath: string): void;
}
export function createFileActions(spawnSync?: typeof import("child_process").spawnSync): FileActions;

// commands/code.ts
export interface ResolvedEditor { command: string; label: string }
export function resolveEditorForDir(dir: string): ResolvedEditor | null;
export async function launchEditorDetached(command: string, target: string): Promise<boolean>;

// MissionDeps additions
fileActions: FileActions;
resolveEditor: (dir: string) => ResolvedEditor | null;
launchEditor: (command: string, target: string) => Promise<boolean>;
pathExists: (absPath: string) => boolean;
```

- Wire: `MissionModel.editorLabel: string`; `MissionHistoryFileRow.onDisk: boolean`; intent `"mission:menu-action"` with payload `{ action: string; path?: string; sha?: string; name?: string }`. Go mirror: `Model.EditorLabel string \`json:"editorLabel"\``, `HistoryFileRow.OnDisk bool \`json:"onDisk"\``.

- [ ] **Step 1: Write the failing tests.** `lib/__tests__/file-actions.test.ts` pins the exact calls `rt nav` made before the lift:

```ts
import { describe, expect, test } from "bun:test";
import { createFileActions } from "../file-actions.ts";

function recorder() {
  const calls: unknown[][] = [];
  const spawnSync = ((...args: unknown[]) => { calls.push(args); return { status: 0 }; }) as never;
  return { calls, actions: createFileActions(spawnSync) };
}

describe("file actions (rt nav's calls, lifted)", () => {
  test("copy pipes the text to pbcopy", () => {
    const { calls, actions } = recorder();
    actions.copy("/a b/[x].txt");
    expect(calls).toEqual([["pbcopy", [], { input: "/a b/[x].txt" }]]);
  });

  test("reveal selects a file in Finder and opens a folder", () => {
    const { calls, actions } = recorder();
    actions.reveal("/r/a.txt");
    actions.reveal("/r", "folder");
    expect(calls).toEqual([
      ["open", ["-R", "/r/a.txt"], { stdio: "ignore" }],
      ["open", ["/r"], { stdio: "ignore" }],
    ]);
  });

  test("open hands the path to its default app as one argument", () => {
    const { calls, actions } = recorder();
    actions.open("/r/a b.txt");
    expect(calls).toEqual([["open", ["/r/a b.txt"], { stdio: "ignore" }]]);
  });
});
```

`lib/mission/__tests__/menu-action.test.ts` drives `MissionDriver` with the fakes the existing driver tests use (copy their factory; add `fileActions`, `resolveEditor`, `launchEditor`, `pathExists` fakes that record calls) and a fake client whose `appendIgnoreFile`, `appendIgnoreRule`, `discardChanges`, and `createTag` record their arguments. One test per action, each sending `{ t: "intent", name: "mission:menu-action", payload }` and asserting the recorded call:

| payload | expected |
|---|---|
| `{ action: "copy-path", path: "src/a b.ts" }` | `fileActions.copy("<worktree>/src/a b.ts")`, notice `"Copied"` |
| `{ action: "copy-relative-path", path: "src/./a.ts" }` | `fileActions.copy("src/a.ts")` |
| `{ action: "copy-sha", sha: "abc123" }` | `fileActions.copy("abc123")` |
| `{ action: "reveal", path: "src/a.ts" }` | `fileActions.reveal("<worktree>/src/a.ts")` |
| `{ action: "reveal-repo" }` | `fileActions.reveal("<worktree>", "folder")` |
| `{ action: "open-default", path: "src/a.ts" }` | `fileActions.open("<worktree>/src/a.ts")` |
| `{ action: "open-editor", path: "src/a.ts" }` with `resolveEditor` returning `{ command: "zed", label: "Zed" }` | `launchEditor("zed", "<worktree>/src/a.ts")` |
| `{ action: "open-editor", path: "src/a.ts" }` with `resolveEditor` returning null | no launch, notice `"No editor set: run rt code once to pick one"` |
| `{ action: "open-repo-editor" }` | `launchEditor("zed", "<worktree>")` |
| `{ action: "ignore-file", path: "dist/[x].js" }` | `appendIgnoreFile("dist/[x].js")` |
| `{ action: "ignore-folder", path: "/dist/sub" }` | `appendIgnoreFile("/dist/sub")` |
| `{ action: "ignore-extension", path: "src/a.test.ts" }` | `appendIgnoreRule("*.ts")` |
| `{ action: "ignore-extension", path: ".env" }` | no call |
| `{ action: "discard-file", path: "a.txt" }` with `a.txt` in the snapshot | `discardChanges([<that ChangedFile>])`, its selection cleared |
| `{ action: "discard-file", path: "gone.txt" }` not in the snapshot | no call, notice `"gone.txt has no changes to discard"` |
| `{ action: "create-tag", sha: "abc123", name: " v1 " }` | `createTag("v1", { sha: "abc123" })` |
| `{ action: "create-tag", sha: "abc123", name: "bad..name" }` with `createTag` throwing `Error("invalid tag name")` | notice `"invalid tag name"` |

Add an `extname` parity table test in the same file: `["a.go", ".go"], [".gitignore", ""], [".env.local", ".local"], ["a.tar.gz", ".gz"], ["Makefile", ""], ["dir.d/file", ""], ["a.", "."]` through `path.extname`, the exact table Task 6 asserts in Go.

Extend the model tests: `buildModel` output carries `editorLabel` (`"Zed"` from the driver's cached editor, `""` when none), and a History file row carries `onDisk` from the driver's lookup.

- [ ] **Step 2: Run** `bun test lib/__tests__/file-actions.test.ts lib/mission`. Expected: FAIL (missing module, unknown intent).

- [ ] **Step 3: Implement `lib/file-actions.ts`:**

```ts
import { spawnSync as realSpawnSync } from "child_process";

export interface FileActions {
  copy(text: string): void;
  reveal(absPath: string, kind?: "file" | "folder"): void;
  open(absPath: string): void;
}

export function createFileActions(spawnSync: typeof realSpawnSync = realSpawnSync): FileActions {
  return {
    copy: (text) => {
      spawnSync("pbcopy", [], { input: text });
    },
    reveal: (absPath, kind = "file") => {
      spawnSync("open", kind === "file" ? ["-R", absPath] : [absPath], { stdio: "ignore" });
    },
    open: (absPath) => {
      spawnSync("open", [absPath], { stdio: "ignore" });
    },
  };
}
```

In `commands/nav.ts`, replace the four inline calls with `createFileActions(deps.spawnSync)`: `open` on a file uses `.open(target)`, `finder` uses `.open(cwd)`, `reveal` uses `.reveal(target, kind)`, `copy-path` uses `.copy(target)`, and `editor` on a file uses `.open(target)`. `bun test commands/__tests__/nav.test.ts` must pass unchanged.

- [ ] **Step 4: Export the editor helpers** from `commands/code.ts`:

```ts
export interface ResolvedEditor {
  command: string;
  label: string;
}

export function resolveEditorForDir(dir: string): ResolvedEditor | null {
  const prefs = loadPrefs();
  const basename = dir.split("/").pop() || "unknown";
  const command = resolveEditorSync(prefs, editorPrefKey(dir), [basename]);
  return command ? { command, label: editorLabelFor(command) } : null;
}

// glitter owns the terminal, so the launch must neither inherit stdio nor
// block the driver the way launchEditor's execSync does.
export async function launchEditorDetached(command: string, target: string): Promise<boolean> {
  for (const cmd of [command, appBundleFallback(command)]) {
    if (!cmd) continue;
    const proc = Bun.spawn(["/bin/sh", "-c", `${cmd} "$1"`, "sh", target], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) === 0) return true;
  }
  return false;
}
```

- [ ] **Step 5: Wire types and fixtures.** Add `"mission:menu-action"` to `SESSION_INTENT_NAMES`, `editorLabel: string` to `MissionModel`, `onDisk: boolean` to `MissionHistoryFileRow` (and to the Go structs above). `grep -rn "mission:history-more" ui/internal` to find any Go-side intent list and add the new name there too. Regenerate both golden fixtures and read them by eye: `session-model-mission.json` gains `"editorLabel"`, every History file row gains `"onDisk"`.

- [ ] **Step 6: Implement the driver.** Deps as listed. `refresh()` resolves and caches `this.editor = this.deps.resolveEditor(this.state.currentWorktree)` beside the other per-refresh caches and clears the on-disk cache. `model()` passes `editorLabel: this.editor?.label ?? ""` and an `onDisk(path)` lookup into `buildHistoryModel`, which the driver memoizes per `this.history.changeset` identity:

```ts
private onDiskCache: { changeset: unknown; paths: Set<string> } = { changeset: null, paths: new Set() };

private onDisk(): (path: string) => boolean {
  const changeset = this.history.changeset;
  if (this.onDiskCache.changeset !== changeset) {
    const root = this.state.currentWorktree;
    const files = changeset?.files ?? [];
    this.onDiskCache = {
      changeset,
      paths: new Set(files.filter((f) => this.deps.pathExists(join(root, f.path))).map((f) => f.path)),
    };
  }
  return (path) => this.onDiskCache.paths.has(path);
}
```

`handle()` gains `case "mission:menu-action": await this.handleMenuAction(intent.payload as MenuActionPayload | undefined); break;` and:

```ts
interface MenuActionPayload {
  action: string;
  path?: string;
  sha?: string;
  name?: string;
}

private async handleMenuAction(p: MenuActionPayload | undefined): Promise<void> {
  if (!p || typeof p.action !== "string") return;
  const root = this.state.currentWorktree;
  const rel = typeof p.path === "string" ? p.path : null;
  const abs = rel === null ? null : join(root, rel);
  const client = this.deps.client(root);
  let mutated = false;
  try {
    switch (p.action) {
      case "copy-path":
        if (abs) this.copy(abs);
        break;
      case "copy-relative-path":
        if (rel) this.copy(normalize(rel));
        break;
      case "copy-sha":
        if (typeof p.sha === "string") this.copy(p.sha);
        break;
      case "reveal":
        if (abs) this.deps.fileActions.reveal(abs);
        break;
      case "reveal-repo":
        this.deps.fileActions.reveal(root, "folder");
        break;
      case "open-default":
        if (abs) this.deps.fileActions.open(abs);
        break;
      case "open-editor":
      case "open-repo-editor": {
        const target = p.action === "open-repo-editor" ? root : abs;
        if (!target) break;
        if (!this.editor) {
          this.state.notice = "No editor set: run rt code once to pick one";
          break;
        }
        if (!(await this.deps.launchEditor(this.editor.command, target))) {
          this.state.notice = `Could not open ${this.editor.label}`;
        }
        break;
      }
      case "ignore-file":
      case "ignore-folder":
        if (rel) {
          await client.appendIgnoreFile(rel);
          mutated = true;
        }
        break;
      case "ignore-extension": {
        const ext = rel ? extname(rel) : "";
        if (ext) {
          await client.appendIgnoreRule(`*${ext}`);
          mutated = true;
        }
        break;
      }
      case "discard-file": {
        const file = rel ? this.snapshot.files.find((f) => f.path === rel) : undefined;
        if (!file) {
          if (rel) this.state.notice = `${rel} has no changes to discard`;
          break;
        }
        await client.discardChanges([file]);
        this.state.selections.delete(file.path);
        mutated = true;
        break;
      }
      case "create-tag": {
        const name = typeof p.name === "string" ? p.name.trim() : "";
        if (typeof p.sha === "string" && name !== "") {
          await client.createTag(name, { sha: p.sha });
          mutated = true;
        }
        break;
      }
    }
  } catch (err) {
    this.state.notice = err instanceof Error ? err.message : String(err);
  }
  if (mutated) await this.refresh();
  this.push();
}

private copy(text: string): void {
  this.deps.fileActions.copy(text);
  this.state.notice = "Copied";
}
```

Use the driver's actual snapshot field name (`this.snapshot` today) and its selection map; `join`, `normalize`, `extname` from `node:path`.

- [ ] **Step 7: Wire `commands/glitter.ts`:** `fileActions: createFileActions()`, `resolveEditor: resolveEditorForDir`, `launchEditor: launchEditorDetached`, `pathExists: existsSync`.

- [ ] **Step 8: Run** `bun test lib/__tests__/file-actions.test.ts lib/mission lib/ui commands/__tests__/nav.test.ts`, `bunx tsc --noEmit`, and from `ui/`: `go test ./internal/protocol/ ./internal/views/mission/`. Expected: PASS.

- [ ] **Step 9: Commit** in two steps: first `git add lib/file-actions.ts lib/__tests__/file-actions.test.ts commands/nav.ts` (message `lift rt nav's clipboard, reveal, and open into lib/file-actions.ts`), then the rest (message `glitter: mission:menu-action runs copy, reveal, open, editor, ignore, discard, and tag in the driver`).

---

### Task 6: glitter's menus (gated on Task 1's sign-off)

**Files:**
- Create: `ui/internal/views/mission/menu.go`, `ui/internal/views/mission/menu_test.go`
- Modify: `ui/internal/views/mission/mission.go` (focus kind, fields, Update routing, mouse routing, View compositing), `changes.go` (keybar), `modal.go` (naming entry point for Create Branch from Commit), `ui/internal/views/mission/mission_test.go` (session tests)

**Interfaces:**
- Consumes: Task 2 and 3's `picker.Menu` API; Task 5's `EditorLabel`, `OnDisk`, `mission:menu-action`.
- Produces: `focusMenu`; `(*Mission).openMenu(t menuTarget, anchor *picker.MenuAnchor)`; `jsExtname(p string) string`.

- [ ] **Step 1: Write the failing unit tests** in `menu_test.go` (reuse `newMouseTestMission`, `changesRowY`, `historyFixtureModel`, `groupedMission`, `historyRowFrameY`, `pushModel`):

```go
package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

func labels(items []picker.MenuItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		mark := ""
		if it.Disabled {
			mark = " (disabled)"
		}
		out[i] = it.Label + mark
	}
	return out
}

func TestJsExtnameMatchesNode(t *testing.T) {
	for _, c := range [][2]string{{"a.go", ".go"}, {".gitignore", ""}, {".env.local", ".local"}, {"a.tar.gz", ".gz"}, {"Makefile", ""}, {"dir.d/file", ""}, {"a.", "."}} {
		if got := jsExtname(c[0]); got != c[1] {
			t.Errorf("jsExtname(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

func TestChangesFileMenuIsGitHubDesktops(t *testing.T) {
	m := newMouseTestMission()
	m.model.EditorLabel = "Zed"
	_, items := m.menuItems(menuTarget{kind: targetChange, path: "src/a.go", status: "modified"})
	want := []string{
		"Discard Changes…",
		"Ignore File (Add to .gitignore)",
		"Ignore Folder (Add to .gitignore)…",
		"Ignore All .go Files (Add to .gitignore)",
		"Copy File Path",
		"Copy Relative File Path",
		"Reveal in Finder",
		"Open in Zed",
		"Open with Default Program",
	}
	got := labels(items)[:len(want)]
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("rows\n got %q\nwant %q", got, want)
	}
}

func TestChangesFileMenuGatesItsRows(t *testing.T) {
	m := newMouseTestMission()
	_, items := m.menuItems(menuTarget{kind: targetChange, path: ".gitignore", status: "deleted"})
	got := strings.Join(labels(items), "|")
	for _, want := range []string{
		"Ignore File (Add to .gitignore) (disabled)",
		"Reveal in Finder (disabled)",
		"Open in External Editor (disabled)",
		"Open with Default Program (disabled)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	for _, absent := range []string{"Ignore Folder", "Ignore All"} {
		if strings.Contains(got, absent) {
			t.Errorf("a root dotfile offers no %q row", absent)
		}
	}
}

func TestHistoryFileMenuOffDiskIsOneDisabledRow(t *testing.T) {
	m := newHistoryTestMission()
	title, items := m.menuItems(menuTarget{kind: targetHistoryFile, path: "gone.go", onDisk: false})
	if title != "gone.go" || items[0].Label != "File Does Not Exist on Disk" || !items[0].Disabled {
		t.Fatalf("got %q %q", title, labels(items))
	}
	if items[1].Section == items[0].Section {
		t.Fatal("the board-wide section follows under its own rule")
	}
}

func TestCommitMenuOffersUndoOnlyOnTheNewestUndoableCommit(t *testing.T) {
	m := newHistoryTestMission()
	m.model.Commit.LastCommit = &LastCommit{Summary: "x", Undoable: true}
	_, newest := m.menuItems(menuTarget{kind: targetCommit, sha: "s1", newest: true})
	_, older := m.menuItems(menuTarget{kind: targetCommit, sha: "s2"})
	if labels(newest)[0] != "Undo Commit…" {
		t.Fatalf("newest: %q", labels(newest))
	}
	if strings.Contains(strings.Join(labels(older), "|"), "Undo Commit") {
		t.Fatal("an older commit offers no undo")
	}
	want := "Create Branch from Commit|Create Tag…|Copy SHA"
	if !strings.Contains(strings.Join(labels(older), "|"), want) {
		t.Fatalf("older: %q", labels(older))
	}
}

func TestRightClickOnAFileRowSelectsItAndOpensItsMenuAtThePointer(t *testing.T) {
	m := newMouseTestMission()
	y := changesRowY(m, 1)
	m.Update(tea.MouseClickMsg{X: 12, Y: y, Button: tea.MouseRight})
	if m.menu == nil || m.focus != focusMenu {
		t.Fatal("right-click on a file row opens the menu")
	}
	if m.selected != m.model.Changes[1].Path {
		t.Fatalf("selected %q, want the clicked row", m.selected)
	}
	if !strings.Contains(m.View().Content, "Discard Changes…") {
		t.Fatal("the menu paints")
	}
}

func TestCtrlKOpensTheBoardSectionAndEscCloses(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu == nil {
		t.Fatal("ctrl-k on the Changes list opens the menu")
	}
	if !strings.Contains(m.View().Content, "Switch Branch…") {
		t.Fatal("the board-wide section is listed")
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu != nil || m.focus != focusList {
		t.Fatal("esc closes the menu back to the list")
	}
}

func TestCtrlKInATextFieldIsTheFieldsOwn(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'c', Text: "c"})
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	if m.menu != nil {
		t.Fatal("ctrl-k in the summary field never opens the menu")
	}
}

func TestRightClickWithAFoldoutOpenOnlyClosesIt(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 1), Button: tea.MouseRight})
	if m.menu != nil {
		t.Fatal("a right-click outside an open foldout only closes the foldout")
	}
}

func TestBoardRowReplaysItsKey(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.KeyPressMsg{Code: 'k', Mod: tea.ModCtrl})
	for _, r := range "switch" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.menu != nil || m.modal == nil || m.modal.zone != zoneBranch {
		t.Fatal("Switch Branch… opens the branch foldout exactly as b does")
	}
}

func TestDiscardAsksBeforeItActs(t *testing.T) {
	m := newMouseTestMission()
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 0), Button: tea.MouseRight})
	_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd != nil || m.menu == nil || !strings.HasPrefix(m.menu.Title(), "Discard all changes to") {
		t.Fatal("Discard Changes… asks first and emits nothing yet")
	}
	_, cmd = m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil || m.menu != nil {
		t.Fatal("confirming emits and closes")
	}
}

func TestMenuHitMatchesPaintAtEveryWidth(t *testing.T) {
	for width := 80; width <= 200; width += 7 {
		m := newMouseTestMission()
		m.width = width
		m.Update(tea.MouseClickMsg{X: width - 2, Y: changesRowY(m, 0), Button: tea.MouseRight})
		frame := m.View().Content
		for y, line := range strings.Split(frame, "\n") {
			if w := lipgloss.Width(line); w != width {
				t.Fatalf("width %d: line %d is %d wide", width, y, w)
			}
		}
		rowX, rowY := -1, -1
		for y, line := range strings.Split(ansi.Strip(frame), "\n") {
			if x := strings.Index(line, "Copy File Path"); x >= 0 {
				rowX, rowY = lipgloss.Width(line[:x]), y
			}
		}
		if rowY < 0 {
			t.Fatalf("width %d: the menu row never painted", width)
		}
		m.Update(tea.MouseMotionMsg{X: rowX, Y: rowY})
		if hovered := strings.Split(m.View().Content, "\n")[rowY]; !strings.Contains(hovered, bgSGR(theme.HoverBg)) {
			t.Fatalf("width %d: hovering the painted row did not paint HoverBg on it", width)
		}
		if _, cmd := m.Update(tea.MouseClickMsg{X: rowX, Y: rowY, Button: tea.MouseLeft}); cmd == nil || m.menu != nil {
			t.Fatalf("width %d: a click on the painted row must run it and close the menu", width)
		}
	}
}
```

`bgSGR` is the existing helper in `render_test.go`.

- [ ] **Step 2: Add session tests** in `mission_test.go` that read the emitted intent line: right-click (`sgrClick(2, x, y)`) on a Changes row, `down` to Copy File Path, enter, then wait for a line containing `"name":"mission:menu-action"` and `"action":"copy-path"` and the row's path; ctrl-k on the History list, choose Copy SHA, and assert `"action":"copy-sha"` with the cursor commit's sha; Create Tag… with a typed name asserts `"action":"create-tag"` with `"name":"v9"` and the sha.

- [ ] **Step 3: Run** from `ui/`: `go test ./internal/views/mission/ -run 'Menu|Jsext|RightClick|CtrlK|Discard|BoardRow'`. Expected: FAIL (`undefined: menuTarget`).

- [ ] **Step 4: Implement `menu.go`:**

```go
package mission

import (
	"path"
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

// boardSection sorts after every item section so the board-wide rows always
// sit under the last rule.
const boardSection = 100

type menuActionPayload struct {
	Action string `json:"action"`
	Path   string `json:"path,omitempty"`
	Sha    string `json:"sha,omitempty"`
	Name   string `json:"name,omitempty"`
}

// jsExtname is Node's path.extname, which GitHub Desktop builds its
// "Ignore All .ext Files" label from: a basename whose only dot leads it
// has no extension.
func jsExtname(p string) string {
	base := path.Base(p)
	if strings.Trim(base, ".") == "" {
		return ""
	}
	i := strings.LastIndex(base, ".")
	if i <= 0 {
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
```

Opening, targets, and running:

```go
func (m *Mission) openMenu(t menuTarget, anchor *picker.MenuAnchor) (tea.Model, tea.Cmd) {
	title, items := m.menuItems(t)
	m.blurCommitInputs()
	m.menu = picker.NewMenu(title, items, anchor)
	m.menuTarget = t
	m.menuPrevFocus = m.focus
	m.focus = focusMenu
	return m, nil
}

func (m *Mission) closeMenu() {
	m.menu = nil
	m.focus = m.menuPrevFocus
	if m.focus == focusMenu || m.focus == focusSummary || m.focus == focusDescription {
		m.focus = focusList
	}
}

// focusedTarget is ctrl-k's target: the row the focused region acts on.
func (m *Mission) focusedTarget() menuTarget {
	if m.historyTab() {
		if m.focus == focusHistoryFiles || m.focus == focusDiff {
			return m.historyFileTarget(m.historyFile)
		}
		if m.historyOnMore || m.historyAnchor != "" {
			return menuTarget{}
		}
		return m.commitTarget(m.historyIndex(m.historyCursor))
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
		m.closeMenu()
		m.focus = focusList
		press := tea.KeyPressMsg{Code: []rune(k)[0], Text: k}
		if m.historyTab() {
			return m.historyListKey(press)
		}
		return m.listKey(press)
	}
	if folder, ok := strings.CutPrefix(it.ID, "ignore-folder:"); ok {
		m.closeMenu()
		return m, m.emitMenuAction("ignore-folder", menuTarget{path: folder}, "")
	}
	switch it.ID {
	case "discard-file":
		m.menu.Push("Discard all changes to "+t.path+"?", []picker.MenuItem{
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
	}
	m.closeMenu()
	return m, m.emitMenuAction(it.ID, t, "")
}

// ignoreFolderItems is GHD's Ignore Folder submenu: every ancestor folder,
// deepest first, rooted with a leading slash.
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
```

`openBranchModalFrom` goes in `modal.go`, beside `selectModalAction`, reusing its naming start:

```go
// openBranchModalFrom is Create Branch from Commit: the branch foldout opens
// already naming, its new branch starting at sha. It skips openBranchModal's
// detached-HEAD refusal, since a commit is a starting point either way.
func (m *Mission) openBranchModalFrom(sha, short string) (tea.Model, tea.Cmd) {
	m.modal = newBranchModal(m.model)
	m.focus = focusModal
	m.modal.action.label = "New branch from " + short + "…"
	m.modal.action.buildPayload = func(name string) json.RawMessage {
		return mustPayload(checkoutNewPayload{New: true, From: sha, Name: name})
	}
	return m.selectModalAction()
}
```

- [ ] **Step 5: Route input in `mission.go`.** Add `focusMenu` to `focusKind`; fields `menu *picker.Menu`, `menuTarget menuTarget`, `menuPrevFocus focusKind`. In `Update`'s `KeyPressMsg` case, after `ctrl+c`: `if m.focus == focusMenu { return m.runMenuOutcome(m.menu.Key(v)) }`; in `listKey`, `historyListKey`, `historyFilesKey`, and `diffKey` add `case "ctrl+k": return m.openMenu(m.focusedTarget(), nil)` (text fields keep their own ctrl+k). In `mouseClick`, before the hit test: `if m.menu != nil { return m.runMenuOutcome(m.menu.Click(mouse.X, mouse.Y)) }`. Replace the right-button branch:

```go
if mouse.Button == tea.MouseRight {
	if m.modal != nil {
		m.closeModal()
		return m, nil
	}
	anchor := &picker.MenuAnchor{X: mouse.X, Y: mouse.Y}
	switch h.kind {
	case hitFileRow, hitFileCheckbox:
		model, cmd := m.clickFileRow(h.idx)
		_, _ = m.openMenu(m.changeTarget(m.selected), anchor)
		return model, cmd
	case hitCommitRow:
		if m.historyAnchor != "" && m.historyInSelection(h.idx) {
			return m.openMenu(menuTarget{}, anchor)
		}
		model, cmd := m.clickCommitRow(h.idx, false)
		_, _ = m.openMenu(m.commitTarget(h.idx), anchor)
		return model, cmd
	case hitHistoryFile:
		model, cmd := m.clickHistoryFile(h.idx)
		_, _ = m.openMenu(m.historyFileTarget(m.model.History.Files[h.idx].Path), anchor)
		return model, cmd
	}
	return m, nil
}
```

`mouseMotion`: `if m.menu != nil { m.menu.Motion(mouse.X, mouse.Y); return m, nil }`. `mouseWheel`: inert while the menu is open. `View`: after the foldout, `if m.menu != nil { out = m.menu.Render(out, m.width) }`. ctrl-k passes a nil anchor, which centers the box.

- [ ] **Step 6: Keybar.** In `renderKeybar` (`changes.go`), insert `{"⌃k", "menu"}` right after `{"2", "history"}` in the Changes pairs and right after `{"1", "changes"}` in the History pairs.

- [ ] **Step 7: Run** from `ui/`: `go test ./internal/views/mission/ ./internal/views/picker/ ./internal/protocol/`. Expected: PASS, including `TestHistoryFrameFitsEveryWidth` and the keybar width tests. Then `bun run ui:build`.

- [ ] **Step 8: Commit** `git add ui/internal/views/mission`, message `glitter: right-click and ctrl-k open GitHub Desktop's file and commit menus with a board-wide section`.

---

### Task 7: pty gate, docs, and the live check

**Files:**
- Modify: `e2e/pty/glitter.test.ts`, `docs/design/mission/README.md`

- [ ] **Step 1: Write the pty test** beside the existing History round trip: launch glitter through the binary as the existing tests do, press ctrl-k, wait for the screen to contain `Switch Branch…` and `Reveal Repository in Finder`, press esc, wait for both to disappear.

- [ ] **Step 2: Run** `bun run test:pty`. Expected: PASS (it fails before Task 6 is built, since ctrl-k did nothing).

- [ ] **Step 3: README.** In `docs/design/mission/README.md` add a "Context menu" section (targets, how it opens and closes, the row sets by reference to the spec, the board-wide section, the boards `ContextMenu.png`/`ContextMenuStates.png`), add to the ratified deviations: menus filter by typing and carry key hints; ctrl-k always carries a board-wide section; Ignore Folder is a follow-up list, not a submenu; a failed move to the Trash does not offer a permanent delete; View on GitHub is not offered yet. Add the menu's geometry row (box: 1 border + header + filter + rule, one line per row, one line per section rule, 1 border) to the terminal geometry table. Add "⌃k menu" to the keybar rows.

- [ ] **Step 4: Commit** `git add e2e/pty/glitter.test.ts docs/design/mission/README.md`, message `glitter: pty gate opens the menu with ctrl-k; design README documents the context menu`.

- [ ] **Step 5 (controller): Live check.** Run glitter from this worktree in tmux, open every board state (right-click via `tmux send-keys -l $'\e[<2;X;YM'`, ctrl-k, the Discard step, the Create Tag step, a History file menu, a commit menu), capture each frame, and compare with the boards cell by cell for tokens and composition. Fix what reads wrong before handing Matt the test-drive command.
