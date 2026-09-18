# Mission-Control TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Go mission-control session view in rt-ui: a GitHub-Desktop-mirroring, mouse-driven changes+diff+commit surface with repo/worktree/branch dropdowns and the adaptive fetch/pull/push action, driven by a TS driver over the session NDJSON bridge.

**Architecture:** A new `session` view kind `"mission"` in `ui/internal/views/mission/` (board mold: full-model replacement pushes in, intents out), painted entirely from theme.go token roles. The TS side follows the runner mold: `commands/mission.ts` gates and wires, `lib/mission/driver.ts` owns state and the intent loop, building the wire model from three feeds: the daemon badge cache (`repos:status` + `git-status` broadcast frames), direct git-core reads for the current worktree, and a new headless git-action core for fetch/pull/push/publish/force-push. Line/hunk staging goes through git-core's vendored `DiffSelection` exactly as chunk 2 shipped it.

**Tech Stack:** Go (Bubble Tea v2, lipgloss v2, Chroma for syntax highlighting), Bun/TypeScript driver, packages/git-core, the rt daemon feeds.

**Spec:** The visual contract is `docs/design/mission/` (README + boards + mission.pen), signed off 2026-09-18. Behavior authority: the Linear ticket "Chunk 4: mission-control TUI in rt-ui" plus the GHD-parity inventory reflected in the boards (adaptive button state machine, tri-state checkboxes, undo strip, guarded checkout). The rt-ui bridge spec (`docs/superpowers/specs/2026-08-29-rt-ui-bridge-design.md`) and picker redesign spec (`2026-08-31-rt-picker-redesign-design.md`) bind the protocol and picker-idiom conventions.

## Global Constraints

- Public repo. `bash scripts/repo-purity.sh` before any push. NO Linear ticket ids (RT-*, SKILLS-*) in code, comments, tests, commit messages, PR text. No em or en dashes anywhere new. Clean-code comments only.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` after a blank line.
- Every color and glyph in Go comes from `ui/internal/theme` roles; inline hex anywhere in view code is a defect. The design boards in `docs/design/mission/` are the pixel truth; deviations are fixed or ratified by updating the board in the same change.
- Interaction conventions are binding: HoverBg mouse-hover distinct from SelBg cursor row (hover never moves the cursor); modal lift = Surface fill + Panel border + parent dim; no shadows, no radii; keybar grammar key(PinkSoft) label(TextSoft) group(Lav).
- Protocol changes to `lib/ui/protocol.ts` and `ui/internal/protocol/` REQUIRE matching `ui/fixtures/*.json` fixtures; both `lib/ui/__tests__/protocol.test.ts` and `ui/internal/protocol/session_test.go` must exercise them ("a change here without a fixture change is a contract break").
- `bun run ui:build` after any change under `ui/`; `bun run ui:test` (go vet + go test) must pass. The rt-ui rebuild hook covers commits, but implementers verify explicitly.
- The TS CLI stays UI-free (no JSX/ink); all rendering is Go. `lib/__tests__/no-ui-in-cli.test.ts` gates it.
- New command modules get thunked literal entries in `lib/module-registry.ts`. `requiresTTY: true` + `fullscreen: true` on the tree leaf, plus the in-function `interactive()` gate (runner precedent).
- The daemon thread is untouched by this chunk; the driver is a CLI process. Sync execs are fine in the driver (runner precedent) but never in anything the daemon imports.
- `bun run test` does not run e2e; anything pinned verbatim needs `bun run test:all` or the specific e2e file before claiming verification.
- Micro-mutations stay library-level: staging APIs are called by the driver; no new tree leaves for stage/discard.
- Worktree Bash guard for SDD workers: one plain command per Bash call; scripts go to scratchpad files run as `bash <path>`.

## Design decisions locked by this plan

- **Mouse is opt-in per view.** `session.Run` gains an options parameter; only the mission view enables mouse reporting. The board's terminal-selection behavior is unchanged.
- **Intent vocabulary is namespaced** (`mission:*`) and carried in the existing Intent shape plus one new optional `payload` field (TS `unknown`, Go `json.RawMessage`). One coordinated protocol change, fixtured.
- **Adaptive action parity:** state machine copies GHD's selection order (progress > no-remote publish-repo > unborn fetch > detached disabled > no-upstream publish-branch > up-to-date fetch > force-push-recommended > behind pull > push). Diverged = Pull with both counts. `forcePushRecommended` is set only when this session observed an amend/undo/rebase on the current branch; force-push is otherwise reachable from the action segment's menu.
- **Publish repository is display-only in v1**: the state renders (parity), activating it shows a "not yet wired" notice line; repo publishing stays out of scope per the project audit.
- **Stash strip is display-only in v1** (count + hint to `rt git stash`); restore/discard flows are v2.
- **History tab renders dimmed** with a "v2" meta; no history data flows.
- **Checkout guard:** branch checkout routes through `checkBranchGuard`; guarded rows render locked (boards) and the intent is refused driver-side with the guard's detail as a notice.

## File Structure

| Unit | Files |
|---|---|
| Protocol | `lib/ui/protocol.ts` (payload field + mission intent names), `ui/internal/protocol/session.go` (payload passthrough), `ui/fixtures/session-open-mission.json`, `ui/fixtures/session-intent-mission-commit.json`, `ui/fixtures/session-model-mission.json` |
| Session options | `ui/internal/session/session.go` (Options{Mouse}), `ui/cmd/rt-ui/verbs.go` (mission registration + per-view options) |
| Go view | `ui/internal/views/mission/model.go` (wire structs + decode), `topbar.go`, `changes.go`, `diff.go`, `modal.go`, `mission.go` (tea.Model + key/mouse routing), `render_test.go`, `mission_test.go`, `model_test.go` |
| Highlighting | `ui/go.mod` (+ github.com/alecthomas/chroma/v2), `ui/internal/views/mission/highlight.go` + test |
| TS action core | `lib/mission/git-actions.ts` + `lib/mission/__tests__/git-actions.test.ts` |
| TS model build | `lib/mission/model.ts` + `lib/mission/__tests__/model.test.ts` |
| TS driver | `lib/mission/driver.ts` + `lib/mission/__tests__/driver.test.ts` |
| Command | `commands/mission.ts`, `lib/command-tree-def.ts` (leaf `mission`), `lib/module-registry.ts` (thunk), `e2e/tests/mission.test.ts` (non-TTY gate pin) |

The wire model types live twice by design (TS `lib/mission/wire.ts` exported from `model.ts`, Go `model.go`) exactly as the board does it; the golden fixture `session-model-mission.json` is the cross-language contract.

---

### Task 1: Protocol: `payload` on Intent, mission intent names, golden fixtures

**Files:**
- Modify: `lib/ui/protocol.ts` (SESSION_INTENT_NAMES at :125, SessionIntent :127-133, parseSessionLine intent case :276)
- Modify: `ui/internal/protocol/session.go` (Intent struct :29-35, EncodeIntent :66-70)
- Create: `ui/fixtures/session-open-mission.json`, `ui/fixtures/session-intent-mission-commit.json`, `ui/fixtures/session-model-mission.json`
- Test: `lib/ui/__tests__/protocol.test.ts` (extend the session-fixture cases), `ui/internal/protocol/session_test.go` (extend fixture round-trips)

**Interfaces:**
- Produces (TS): `SESSION_INTENT_NAMES` gains, verbatim: `"mission:action"`, `"mission:stage"`, `"mission:discard"`, `"mission:commit"`, `"mission:undo"`, `"mission:checkout"`, `"mission:worktree"`, `"mission:repo"`, `"mission:select"`, `"mission:refresh"`. `SessionIntent` gains `payload?: unknown`.
- Produces (Go): `Intent` gains `Payload json.RawMessage \`json:"payload,omitempty"\``.
- Fixture contents (exact):

`ui/fixtures/session-intent-mission-commit.json`:
```json
{ "t": "intent", "name": "mission:commit", "payload": { "summary": "fix parser", "description": "", "amend": false } }
```

`ui/fixtures/session-open-mission.json`:
```json
{ "t": "open", "view": "mission", "model": { "current": { "repo": "remote:github.com%2Fm4ttstack%2Frt", "worktree": "/w/gandalf", "branch": "main" }, "repos": [], "changes": [], "action": { "kind": "fetch", "title": "Fetch origin", "meta": "Never fetched", "busy": false, "ahead": 0, "behind": 0 } } }
```

`ui/fixtures/session-model-mission.json`: the full MissionModel example given in Task 3 Step 1 (single source: write it there, reference the same bytes here).

- [ ] **Step 1: Extend the TS types and parser** exactly as above; `parseSessionLine`'s intent branch also accepts and passes through `payload` untouched.
- [ ] **Step 2: Extend Go's Intent** with the Payload field; `EncodeIntent` marshals the struct as-is (json omitempty keeps old wire bytes identical when absent). Add a Go fixture round-trip case for `session-intent-mission-commit.json` asserting Name and raw payload bytes survive encode/decode.
- [ ] **Step 3: Add the three fixtures** and extend `lib/ui/__tests__/protocol.test.ts`: the new intent name parses; an unknown name still throws; `payload` round-trips; old fixtures unchanged byte-for-byte (`git diff --stat` shows no edits to existing fixture files).
- [ ] **Step 4: Run** `bun test lib/ui` and, from `ui/`: `go test ./internal/protocol/...`. Both green.
- [ ] **Step 5: Commit** `protocol: mission intents with a payload field, golden fixtures`.

---

### Task 2: Session mouse option + mission view registration skeleton

**Files:**
- Modify: `ui/internal/session/session.go` (Run signature + NewProgram options)
- Modify: `ui/cmd/rt-ui/verbs.go` (imports, advertisedViews, viewFor, per-view options)
- Create: `ui/internal/views/mission/mission.go` (skeleton), `ui/internal/views/mission/model.go` (skeleton decode)
- Test: `ui/internal/session/session_test.go` (options plumb-through), `ui/internal/views/mission/mission_test.go` (skeleton open/quit)

**Interfaces:**
- Produces: `session.Options{ Mouse bool }`; `Run(ctx, viewName, views, mk, in, out, term, version, opts Options)` (all existing callers updated in the same task; verbs.go passes `Options{Mouse: viewName == "mission"}`). When `opts.Mouse`, the program adds `tea.WithMouseCellMotion()`.
- Produces: `mission.New(em *session.Emitter) *Mission` satisfying `session.View`; skeleton `SetModel` decodes into `Model` (Task 3 shapes), `Reason()` returns the stored reason, `q`/ctrl-c quit via the sequenced emit pattern:
```go
func (m *Mission) quit() (tea.Model, tea.Cmd) {
	m.reason = session.ReasonQuit
	return m, tea.Sequence(m.em.Emit(protocol.Intent{Name: "quit"}), tea.Quit)
}
```
- `advertisedViews()` returns `[]string{"board", "mission"}` (+ echo under the test env var); `viewFor` gains `case "mission": return func(em *session.Emitter) session.View { return mission.New(em) }`.

- [ ] **Step 1: Failing Go test** in session_test.go: constructing Run's program with `Options{Mouse:true}` is observable via a small seam (factor the option list into `programOptions(term, opts)` returning `[]tea.ProgramOption`; test asserts length differs between Mouse true/false; keep it dumb and structural).
- [ ] **Step 2: Implement** Options + programOptions + Run signature change; update the sole Run caller (verbs.go runSession) and the echo-view tests.
- [ ] **Step 3: Skeleton mission view** with the fixture-backed test: `session-open-mission.json`'s model decodes; `q` quits with reason quit (mirror `TestQuitConfirmsWhenRunningAndEmitsQuitOnY`'s harness shape from the board, minus the confirm).
- [ ] **Step 4: Run** from `ui/`: `go vet ./... && go test ./...`; then `bun run ui:build`.
- [ ] **Step 5: Commit** `rt-ui: mission view skeleton behind an opt-in mouse session option`.

---

### Task 3: The mission wire model (Go decode + golden fixture)

**Files:**
- Modify: `ui/internal/views/mission/model.go` (full wire structs)
- Create: the full `ui/fixtures/session-model-mission.json`
- Test: `ui/internal/views/mission/model_test.go`

**Interfaces (Go structs, verbatim; json tags all lowerCamel):**
```go
type Badge struct {
	Ahead, Behind          int
	Staged, Unstaged, Untracked, Conflicted int
	Clean                  bool
	LastFetchedAt          string // ISO or ""
}
type RepoRow struct {
	ID, Label, Group string
	Badge            Badge
	Current          bool
}
type WorktreeRow struct {
	Path, Name, Branch string
	Badge              Badge
	Current, OnDeck    bool
}
type BranchRow struct {
	Name        string
	Current     bool
	Ahead, Behind int
	GuardedBy   string // "" = free; else the refusal detail
	Group       string // "recent" | "other" | "guarded"
}
type ChangeRow struct {
	Path, OrigPath, Status string // Status: "new"|"modified"|"deleted"|"renamed"|"copied"|"conflicted"
	Include                string // "all"|"none"|"partial"
}
type DiffLine struct {
	OldNo, NewNo int    // 0 = absent
	Kind         string // "context"|"add"|"del"|"hunk"
	Text         string
	Selected     bool   // staging selection state for add/del lines
	SelIdx       int    // git-core DiffSelection line index; -1 for context/hunk
}
type DiffModel struct {
	Path, Status string
	Kind         string // "text"|"binary"|"oversized"|"none"
	Stats        string // "+18 -4"
	Lang         string // chroma lexer hint, e.g. "typescript"; "" = plain
	Lines        []DiffLine
}
type ActionModel struct {
	Kind  string // "fetch"|"pull"|"pull-rebase"|"push"|"force-push"|"publish-branch"|"publish-repo"|"busy"|"detached"
	Title, Meta string
	Ahead, Behind int
	Busy  bool
}
type CommitModel struct {
	Summary, Description, Placeholder string
	Amending                          bool
	ButtonLabel                       string // driver-computed, e.g. "Commit 3 files to main"
	CanCommit                         bool
	LastCommit                        *LastCommit
}
type LastCommit struct {
	Summary, When string
	Undoable      bool
}
type Current struct {
	Repo, RepoLabel, Worktree, WorktreeName, Branch string
	Detached                                        bool
}
type Model struct {
	Current   Current
	Action    ActionModel
	Repos     []RepoRow
	Worktrees []WorktreeRow
	Branches  []BranchRow
	Changes   []ChangeRow
	ChangedTotal, StagedTotal int
	Filter    string
	Diff      DiffModel
	Commit    CommitModel
	StashCount int
	Notice    string // one-line transient notice (guard refusals, not-yet-wired)
}
```
- The fixture `session-model-mission.json` is `{"t":"model","model":{...}}` populated with: 2 repos, 2 worktrees, 3 branches (one guarded), 3 changes (all/none/partial one each), a 6-line text diff (1 hunk line, adds selected), pull action with ahead 3 behind 2, commit with LastCommit undoable, stash 1, notice "".

- [ ] **Step 1: Write the fixture and a failing decode test**: `SetModel` on the fixture bytes populates every top field (spot-assert one leaf per struct: `m.Branches[2].GuardedBy != ""`, `m.Diff.Lines[0].Kind == "hunk"`, `m.Changes[2].Include == "partial"`, `m.Commit.LastCommit.Undoable`, etc.). Assert unknown JSON fields are ignored (forward compat) by decoding the fixture with an injected extra key.
- [ ] **Step 2: Implement** the structs + `decode(raw) (Model, error)`; SetModel replaces wholesale and clamps the cursor indices (selection preserved by path/name where possible, board's SetModel precedent).
- [ ] **Step 3: Extend both protocol fixture tests** (TS + Go) to include `session-model-mission.json` (TS: it parses as a model line; Go: round-trip).
- [ ] **Step 4: Run** `go test ./internal/views/mission/... ./internal/protocol/...` from ui/, `bun test lib/ui`. Green.
- [ ] **Step 5: Commit** `rt-ui: mission wire model and golden fixture`.

---

### Task 4: Top bar rendering + adaptive action segment (Go)

**Files:**
- Create: `ui/internal/views/mission/topbar.go`
- Test: `ui/internal/views/mission/render_test.go` (topbar section)

**Contract (boards: Main.png, ActionStates.png, InteractionStates.png):**
- Four segments: repo (locked width = sidebar width constant `sidebarWidth = 46` cells), worktree, branch, action; two-line anatomy (label line in Dimmer 10-ish, value line bold Text) with a chevron glyph; dividers in Rule; open segment paints Surface, hovered paints HoverBg (hover state arrives in Task 8).
- Branch segment states: normal (name), detached (`On a1b2c3d`, value in Peach, label `Detached HEAD`, foldout disabled), checking-out (spinner frames + percent when driver sends it via Notice; v1 renders detached + normal only, checking-out lands with Task 8 polish).
- Action segment: icon per Kind (theme glyphs/lucide-equivalent runes: fetch ⟳ via SpinnerFrames when Busy, pull ↓ Mint, push ↑ Cyan, force-push ⇈ Coral, publish ↑ Lav), Title bold, Meta in Dimmer; ahead/behind pills right-aligned (`3↑` Cyan, `2↓` Mint) rendered only when nonzero, matching GHD's badge rule (tags folded into ahead is a driver concern).
- Pure functions: `renderTopBar(m Model, width int, hover zoneID, open zoneID) string` built from smaller `renderSegment(...)` helpers; no state on the struct.

- [ ] **Step 1: Failing render tests**: golden-ish substring assertions (the board tests' style): pull state contains "Pull origin" and both pills; detached contains "On " prefix and no chevron; widths: repo segment renders exactly `sidebarWidth` cells (measure with lipgloss.Width).
- [ ] **Step 2: Implement** topbar.go with theme roles only.
- [ ] **Step 3: Run** `go test ./internal/views/mission/...`. Green. `go vet ./...`.
- [ ] **Step 4: Commit** `rt-ui: mission top bar with the adaptive action segment`.

---

### Task 5: Changes pane + commit box + keybar (Go, keys only)

**Files:**
- Create: `ui/internal/views/mission/changes.go`
- Modify: `ui/internal/views/mission/mission.go` (key routing, focus model, commit inputs)
- Test: `render_test.go` (changes/commit sections), `mission_test.go` (key behaviors)

**Contract (boards: Main.png, InteractionStates.png; GHD parity):**
- Sidebar (width `sidebarWidth`): tabs (Changes bold + Pink underline bar + count in PinkSoft; History Dimmer + `v2` meta), filter row (`❯ filter` box, `/` focuses), master row (`N changed files · M staged`, tri-state glyph ◉/○/◪ mapping all/none/mixed), rows: cursor bar ▌ (SelBg row), tri-state checkbox glyph per Include, path (fill, middle-truncated), status letter M/A/D/R/C/! in Peach/Mint/Coral/Blue/Mint/Coral(alert) per boards, `partial` meta in Faint on partial rows.
- Stash strip (`Stashed changes · N ❯`, BgSubtle) when StashCount > 0.
- Commit box: summary input (Surface + Panel border; placeholder from model), description (2-line box), button full-width Pink (`ButtonLabel`), disabled state Panel+Dimmer when !CanCommit; amending banner line (`Amending last commit · esc stops`) in Peach when Amending. Undo strip (WarnBg): `Committed <When> · <Summary>` + `Undo` chip when LastCommit != nil && Undoable.
- Keys (view emits, driver mutates): `space` toggles include on cursor row → `mission:stage` payload `{path, mode:"toggle-file"}`; `enter` in list focuses diff; `c` focuses summary; typing in inputs is local; `ctrl-enter` (and `c` from list when CanCommit) emits `mission:commit` payload `{summary, description, amend}`; `u` emits `mission:undo`; `a` toggles amend locally and re-emits nothing (button label comes back from driver on next push; the view shows the Amending banner from local state until then); `f` emits `mission:action`; `b`/`w`/`r` open modals (Task 7); `/` filter (local text, emits `mission:select` payload `{filter}` debounced on enter); `q` quit.
- Focus model: `focusList`, `focusDiff`, `focusSummary`, `focusDescription`; tab cycles; esc backs out to list.

- [ ] **Step 1: Failing tests**: (a) render: partial row shows ◪ and `partial`; disabled commit button renders Panel bg; undo strip appears with fixture model; (b) behavior: `space` on cursor row emits `mission:stage` with the row's path (capture through a stub Emitter writing to a buffer, board-test harness style); `ctrl-enter` with summary text emits `mission:commit` with the typed summary; `q` emits quit + Quit reason.
- [ ] **Step 2: Implement** changes.go + routing. textinput from bubbles for summary/description (huh not needed).
- [ ] **Step 3: Run** ui tests + vet. Green.
- [ ] **Step 4: Commit** `rt-ui: mission changes pane, commit box, and keybar`.

---

### Task 6: Diff pane with Chroma highlighting + selection gutter (Go)

**Files:**
- Modify: `ui/go.mod` (+`github.com/alecthomas/chroma/v2 v2.x` latest stable), `go.sum`
- Create: `ui/internal/views/mission/diff.go`, `ui/internal/views/mission/highlight.go`
- Test: `render_test.go` (diff), `highlight_test.go`

**Contract (boards: Main.png, DiffStates.png, InteractionStates.png):**
- Header row: path bold TextSoft, Stats Dimmer, right hint `space stages line · s stages hunk` Dimmer, BgSubtle fill.
- Lines: gutter = stage bar cell (▌ Pink when Selected; empty otherwise; hover preview in Task 8) + old no + new no (Faint, right-aligned 4 cells each) + mark/text: hunk lines full-width Surface with Lav text (the `@@` header IS the hunk toggle); add lines Mint, del Coral, context TextSoft. Chroma tokenizes CONTEXT and ADD line text when Lang != "" (del lines stay flat Coral); token colors map to the theme ramp via a fixed chroma->theme style table in highlight.go (build a `chroma.Style` from theme tokens; never emit non-theme hex).
- Kinds: binary → centered message `This binary file has changed.`; oversized → `Diff too large to display by default` + `enter shows it anyway` hint (emits `mission:select {showOversized:true}`); none → `select a file` Faint.
- Keys when diff focused: up/down move line cursor; `space` emits `mission:stage` payload `{path, mode:"line", selIdx}`; `s` on any line emits `{path, mode:"hunk", selIdx}` (driver expands to the hunk range); `d` emits `mission:discard` same payloads (driver confirms via Notice round-trip in v1: first press sets Notice "press d again to discard", second within the model round-trip discards; encode this in the driver, not the view).
- Scrolling: viewport math in diff.go (board tail precedent), 1-cell Panel thumb.

- [ ] **Step 1: Failing tests**: highlight_test: a TS snippet under Lang "typescript" yields ANSI containing at least two distinct theme accent sequences and NO hex outside the theme table (assert against a compiled allowlist of the style's colors); render: hunk line paints Surface + Lav; selected add line shows the Pink bar; binary kind renders its exact message; behavior: `space` on an add line emits selIdx.
- [ ] **Step 2: Implement** (chroma lexer by Lang name, fallback plain; style built once).
- [ ] **Step 3: Run** ui tests + vet + `bun run ui:build` (binary size check: note the delta in the report; chroma adds ~2-3MB, acceptable, flag if >6MB).
- [ ] **Step 4: Commit** `rt-ui: mission diff pane with chroma highlighting and stage gutter`.

---

### Task 7: Modals: repo / branch / worktree foldouts (Go)

**Files:**
- Create: `ui/internal/views/mission/modal.go`
- Modify: `mission.go` (open/close routing)
- Test: `render_test.go` (modal composition), `mission_test.go` (behavior)

**Contract (boards: RepoPicker.png, BranchModal.png, WorktreeModal.png; picker conventions):**
- One modal engine, three configs. Composition: parent view dims (re-render body through a dim filter: replace fg colors with Dim/Dimmer via lipgloss style, the picker's parent-dim convention), modal Surface + Panel border anchored under its segment (x from segment origin, clamped).
- Rows ranked by `ui/internal/views/picker`'s `match.Rank` (import the package; it is the sanctioned headless matcher), grouped contiguously (`GroupContiguous`): repos by Group; branches recent/other/guarded (guarded rows Dimmer + lock glyph + never selectable as checkout targets); worktrees with current ◉ Mint, on-deck rows `ready` Dimmer.
- Badges per boards (●n Peach, n↓ Mint, n↑ Cyan, ✓ Mint clean).
- Action rows (Lav, ActionHighlight bg): branch `New branch from <current>…` emits `mission:checkout {new:true, from}` (driver v1: Notice "use rt worktree provision"; creation lands v2 — parity note stays on the board); worktree `Provision new worktree…` same pattern; repo modal has no action row.
- Keys: type-to-filter, up/down, enter emits (`mission:repo {repo}` / `mission:checkout {branch}` / `mission:worktree {path}`), esc closes; modal keybar per boards.
- Detached HEAD: branch segment cannot open (bell Notice).

- [ ] **Step 1: Failing tests**: guarded branch row is skipped by cursor movement and enter on it emits nothing; repo enter emits `mission:repo` with the row id; esc restores the un-dimmed parent (render before/after differ then match); filter narrows via match.Rank ordering (assert a known ranking case).
- [ ] **Step 2: Implement** modal.go; keep the engine generic (rows + groups + actions in, selection out).
- [ ] **Step 3: Run** ui tests + vet.
- [ ] **Step 4: Commit** `rt-ui: mission modals over a dimmed parent in the picker idiom`.

---

### Task 8: Mouse routing + hover states (Go)

**Files:**
- Modify: `mission.go` (tea.MouseMsg routing, zone hit-testing), `topbar.go`/`changes.go`/`diff.go`/`modal.go` (hover paint params)
- Test: `mission_test.go` (mouse behaviors), `render_test.go` (hover paints)

**Contract (boards: Mouse.png, InteractionStates.png):**
- Zone map computed at render time (y ranges per region, row index math): segments, action segment, tabs, filter, master row, file rows + their checkbox cells, stash strip, commit inputs/button, undo chip, diff lines + gutter cells + hunk rows, modal rows, keybar.
- Motion: hover zone tracked; hovered row paints HoverBg (never moves the cursor); hovered gutter cell previews the bar in the faint pink (the boards' #8A4560 is `theme.ActionHighlight(theme.Pink)`-derived; expose a `theme` helper if one does not exist rather than inlining).
- Click: segment opens its modal (action segment click emits `mission:action`); file row click moves cursor; checkbox cell click emits `mission:stage {path, mode:"toggle-file"}`; double-click a row focuses diff; hunk row click emits hunk stage; gutter click emits line stage; tab click switches (History → Notice "History lands in v2"); undo chip click emits `mission:undo`; commit button click emits commit when CanCommit; modal row click selects, click outside modal closes; stash strip click → Notice.
- Wheel: scrolls the hovered pane (list or diff or modal).
- Right-click: file row → context modal reuse (v1: Notice "menu lands with polish"; encode as Notice, do not build a context menu in this chunk).

- [ ] **Step 1: Failing tests**: synthesize `tea.MouseMsg` (motion at a file row y → that row renders HoverBg while cursor row keeps SelBg; click checkbox cell emits toggle-file with the right path; wheel over diff scrolls it; click outside modal closes it).
- [ ] **Step 2: Implement** zones + routing.
- [ ] **Step 3: Run** ui tests + vet + `bun run ui:test` full.
- [ ] **Step 4: Commit** `rt-ui: mission mouse routing and hover states`.

---

### Task 9: Headless git action core (TS)

**Files:**
- Create: `lib/mission/git-actions.ts`
- Test: `lib/mission/__tests__/git-actions.test.ts`

**Interfaces:**
```ts
export type ActionKind =
  | "fetch" | "pull" | "pull-rebase" | "push" | "force-push"
  | "publish-branch" | "publish-repo" | "detached" | "busy";

export interface ActionState {
  kind: ActionKind;
  title: string;   // exact GHD strings: "Fetch origin", "Pull origin", "Pull origin with rebase", "Push origin", "Force push origin", "Publish branch", "Publish repository"
  meta: string;    // "Last fetched 3 minutes ago" | "Never fetched" | state-specific per the boards
  ahead: number; behind: number;
}

export function deriveAction(input: {
  badge: GitWorktreeBadge; remoteName: string | null; detached: boolean;
  unborn: boolean; pullRebase: boolean; forcePushRecommended: boolean; busy: boolean;
}): ActionState;

export interface ActionResult { ok: boolean; detail: string; }

export function runAction(cwd: string, kind: ActionKind, opts: { remote?: string; branch: string | null }): Promise<ActionResult>;
```
- `deriveAction` copies GHD's selection order exactly (Global "Design decisions"). `runAction` uses `Bun.spawn(["git", ...], { stdout: "pipe", stderr: "pipe" })` with argv only: fetch → `fetch --quiet <remote>`; pull → `pull [--rebase] <remote>`; push → `push <remote>`; force-push → `push --force-with-lease <remote>`; publish-branch → `push -u <remote> <branch>`; publish-repo → resolve `{ ok:false, detail:"publishing a repository is not wired yet" }`; detached/busy → refuse. Non-zero exit → `{ok:false, detail: lastStderrLine}`. Never `stdio: "inherit"`; never `@{u}`.

- [ ] **Step 1: Failing tests** with real sandbox repos (mirror packages/git-core's test-support pattern locally with mkdtemp + a bare remote): publish-branch then push then pull round-trip against the bare remote; force-push after an amend; fetch stamps FETCH_HEAD; deriveAction table test covering all nine kinds incl. the diverged→pull rule and the with-rebase title.
- [ ] **Step 2: Implement.** No console output anywhere in this module.
- [ ] **Step 3: Run** `bun test lib/mission` + `bunx tsc --noEmit`. Green.
- [ ] **Step 4: Commit** `mission: headless adaptive git action core`.

---

### Task 10: Wire-model builder (TS)

**Files:**
- Create: `lib/mission/model.ts` (exports the TS mirror of every Go wire struct as interfaces + `buildModel`)
- Test: `lib/mission/__tests__/model.test.ts`

**Interfaces:**
```ts
export interface MissionState { /* driver-owned mutable state */
  currentRepo: string; currentWorktree: string;
  selectedPath: string | null; filter: string;
  amending: boolean; summary: string; description: string;
  forcePushRecommended: boolean; busyAction: boolean;
  notice: string; showOversized: Set<string>;
  selections: Map<string, DiffSelection>; // per path, git-core selection state
}

export function buildModel(input: {
  state: MissionState;
  rows: RepoStatusRow[];                    // daemon feed
  snapshot: RepoSnapshot;                   // git-core, current worktree
  branches: BranchInfo[]; guards: Map<string, string>;
  worktrees: WorktreeRow[];                 // from rt worktree list mapping
  stagingDiff: StagingDiff | null;          // for selectedPath
  stashes: number; lastCommit: { summary: string; when: string; undoable: boolean } | null;
  action: ActionState;
}): MissionWireModel;
```
- Encodes every derivation the Go side must not do: `Include` tri-state from ChangedFile staged/unstaged flags + selection state; DiffLine list from StagingDiff hunks with SelIdx = the vendored selection line index and Selected from `state.selections` (default: `DiffSelection.fromInitialSelection(All)` when file fully included); ButtonLabel per GHD rule (`Commit N files to X` / `Commit to X` / `Amend last commit`); Placeholder per GHD (`Summary (required)` or `Create/Delete/Update <file>` single-file rule); oversized cutoff = 3000 diff lines unless `showOversized`.
- The golden fixture from Task 3 must be **producible**: a test constructs inputs and asserts `JSON.parse(JSON.stringify(buildModel(...)))` deep-equals the fixture file's `model` (this is the cross-language handshake).

- [ ] **Step 1: Failing tests**: the fixture-equality test above + tri-state table + button-label table + placeholder table + oversized gate.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `bun test lib/mission` + tsc. Green.
- [ ] **Step 4: Commit** `mission: wire model builder with the golden fixture handshake`.

---

### Task 11: The driver (TS intent loop)

**Files:**
- Create: `lib/mission/driver.ts`
- Test: `lib/mission/__tests__/driver.test.ts`

**Interfaces:**
```ts
export interface MissionDeps {
  openSession: typeof openSession;
  client: (dir: string) => GitClient;        // createGitClient
  daemonQuery: typeof daemonQuery;
  subscribe: typeof subscribeToDaemon;
  runAction: typeof runAction;
  commit: typeof commitStaged; amend: typeof amendStaged;
  guard: typeof checkBranchGuard;            // + runners/defaultBranch wiring inside
  now: () => Date;
}
export class MissionDriver {
  constructor(deps: MissionDeps, start: { repo: string; worktree: string });
  run(): Promise<void>;   // opens the session, seeds the model, loops intents
}
```
- Intent handling (each ends with a rebuilt model push):
  - `mission:action` → deps.runAction with derived kind; busy model push first; result → Notice on failure; fetch/pull/push refresh snapshot + badges; after amend/undo earlier in session, force-push recommended flag feeds deriveAction.
  - `mission:stage` modes: `toggle-file` (flip include: apply `withSelectAll()`/`withSelectNone()` then `stageSelection`/reset via `git add`/`reset` through git-core's whole-file paths: use snapshot-level include by staging all lines of the file's StagingDiff selection); `line` → `selections` updated `withToggleLineSelection(selIdx)` then `stageSelection(diff, selection)`; `hunk` → expand selIdx to its hunk's range via the StagingDiff hunks, `withRangeSelection`.
  - `mission:discard` → two-step confirm via Notice (first request arms `state.confirmDiscard`, second within 5s executes `discardSelection`).
  - `mission:commit` → guard current branch (checkBranchGuard) only when amend; commitStaged/amendStaged; clear inputs; refresh; LastCommit updated (undoable = !pushed, derived from snapshot ahead>0).
  - `mission:undo` → `client.undoLastCommit()`; typed refusal → Notice `refused: <reason>`.
  - `mission:checkout` → guard; refuse with Notice or `client.checkoutBranch`.
  - `mission:worktree` / `mission:repo` → switch current pointers, re-seed snapshot feeds.
  - `mission:select` → filter/showOversized/selectedPath updates.
  - `quit` → close.
- Subscriptions: `subscribe(ev => ev.type === "git-status" && refreshBadges())`; SessionEnd `died`/`error` throws `SessionDied`-alike for the command to report (runner contract).

- [ ] **Step 1: Failing tests** with a fully faked deps object + a scripted fake session (an async-iterable of intents + captured pushes; mirror lib/runner's runner.test.ts harness): staging line toggle round-trips into stageSelection with the right DiffSelection; commit intent calls commitStaged with typed summary and pushes a cleared commit box; guard refusal lands in Notice; action busy push precedes result push; git-status frame triggers a badge refresh push.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `bun test lib/mission` + tsc. Green.
- [ ] **Step 4: Commit** `mission: the driver intent loop`.

---

### Task 12: `rt mission` command, tree leaf, e2e gate pin

**Files:**
- Create: `commands/mission.ts`
- Modify: `lib/command-tree-def.ts` (top-level `mission` leaf), `lib/module-registry.ts` (thunk)
- Create: `e2e/tests/mission.test.ts`

**Contract:**
- Leaf: top-level `mission: { description: "Mission control: repos, changes, diff, and commit in one board", module: "./commands/mission.ts", fn: "missionCommand", context: "repo", requiresTTY: true, fullscreen: true, args: [] }` (no positional, no omitBehavior).
- `missionCommand`: `interactive()` double-gate with the exact stderr line `rt mission needs an interactive terminal (it drives a live board from the one you are in)` exit 1 (runner wording pattern); resolves the current repo/worktree (currentRepoIdentity + cwd), errors plainly outside a registered repo; builds real deps; `new MissionDriver(deps, start).run()`; SessionDied handling + SIGINT/TERM/HUP teardown per the runner block, verbatim shape.
- e2e pins the non-TTY path: spawning `rt mission` with no TTY exits 1 and stderr contains the exact gate line (both the tree-level and function-level gates are exercised by RT_BATCH-unset non-TTY spawn).

- [ ] **Step 1: Failing e2e** (harness `rt(["mission"], { home })`, remember: opts are `{ home, env }`).
- [ ] **Step 2: Implement** command + leaf + thunk.
- [ ] **Step 3: Run** the e2e file (60s timeout flag), `bun run picker:check`, `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts`.
- [ ] **Step 4: Commit** `rt mission: command, gate, and registry wiring`.

---

### Task 13: Live wiring polish: seed flow, worktree rows, notice UX

**Files:**
- Modify: `lib/mission/driver.ts`, `lib/mission/model.ts` (worktree list mapping via `rt worktree list` data: use `daemonQuery("worktree:list", { repoName })` like mr.ts, mapping to WorktreeRow with badges joined from repos:status), `commands/mission.ts`
- Test: extend `lib/mission/__tests__/driver.test.ts` + `model.test.ts`

- [ ] **Step 1: Failing tests**: worktree rows join badges by path; switching worktree re-seeds and pushes a model whose Current matches; Notice clears on the next successful intent; the initial seed pushes within one buildModel call (no double-push).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `bun test lib/mission`. Green.
- [ ] **Step 4: Commit** `mission: live seed and worktree wiring polish`.

---

### Task 14: Gate pass

- [ ] **Step 1:** `bun run test` (isolate any failure; compare against clean main before blaming the branch).
- [ ] **Step 2:** `bun run test:e2e`.
- [ ] **Step 3:** `bunx tsc --noEmit` (root); from `ui/`: `go vet ./... && go test ./...`; `bun run ui:build` succeeds; note the rt-ui binary size delta from chroma in the report.
- [ ] **Step 4:** `bun run picker:check`; `bun run docs:gen` + `bun run docs:check` (the new `rt mission` leaf needs its generated reference page committed).
- [ ] **Step 5:** `bash scripts/repo-purity.sh`; branch-diff greps for ticket ids and em/en dashes on added lines (must be empty).
- [ ] **Step 6:** Manual visual pass BY THE CONTROLLER (not a subagent): run `rt mission` in a real terminal, capture screenshots, compare surface-by-surface against `docs/design/mission/*.png`, and either fix or ratify each deviation by updating the boards in the same change. This is the design contract's review clause.
- [ ] **Step 7:** Commit anything outstanding (docs regeneration).

---

## Explicit non-goals (ticket + boards: honor them)

- History tab data (tab renders dimmed, v2).
- Repository publishing (state renders; action notices "not wired").
- Stash restore/discard flows (strip is display-only).
- Image diffs, drag-and-drop cherry-pick, clone/create/publish repo flows.
- Context menus on rows (right-click notices; v2 polish).
- No daemon changes of any kind in this chunk.
