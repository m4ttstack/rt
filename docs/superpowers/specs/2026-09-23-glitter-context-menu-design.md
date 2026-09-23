# glitter: context menu and ctrl-k (design)

Status: approved by the owner 2026-09-23.

## Goal

Right-click on a file or commit row in `rt glitter` opens a menu of that row's
actions, and ctrl-k opens the same menu for whatever has focus. The rows are
GitHub Desktop's own context menus (macOS labels, order, and enablement,
verbatim), and the machinery is `rt nav`'s menu lifted out of the picker so
the picker and glitter share one implementation.

Governing rule for glitter features: port GitHub Desktop's atomic git methods
first (verbatim arguments), then its store behavior, then the UI.

## GitHub Desktop sources (clone at ~/Documents/GitHub/github-desktop, 9dfe6e60)

- Changes file row: `app/src/ui/changes/filter-changes-list.tsx`, `getDefaultContextMenu` (657-803) and `getDiscardChangesMenuItemLabel` (522-533).
- History file row: `app/src/ui/history/selected-commits.tsx`, `onContextMenu` (371-454).
- Commit row: `app/src/ui/history/commit-list.tsx`, the single-commit menu (720-865).
- Labels: `app/src/ui/lib/context-menu.ts` (`CopyFilePathLabel`, `CopyRelativeFilePathLabel`, `DefaultEditorLabel`, `RevealInFileManagerLabel`, `OpenWithDefaultProgramLabel`, `isSafeFileExtension`).
- Discard: `app/src/lib/stores/git-store.ts`, `discardChanges` (1545-1650); dialog copy in `app/src/ui/discard-changes/discard-changes-dialog.tsx`.
- Ignore: `app/src/lib/git/gitignore.ts`, `saveGitIgnore`, `appendIgnoreRule`, `appendIgnoreFile`, `escapeGitSpecialCharacters`, `formatGitIgnoreContents` (95-200).
- Create tag dialog copy: `app/src/ui/create-tag/create-tag-dialog.tsx`.

## 1. The shared menu

`rt nav`'s menu lives in `ui/internal/views/picker/modal.go` and `actions.go`:
a registry menu (`deriveMenu` orders item rows, a rule, then global rows), a
bordered box composited over a dimmed parent, anchored at the pointer for a
right-click and centered for ctrl-k, with its own filter, cursor, hover,
click zones, and live key accelerators.

- Export the menu engine from the `picker` package (the precedent is
  `picker.Viewport`/`ThumbSpan`/`ThumbCell`/`Rank`, which mission already
  imports from there; a separate package would need `Rank` and create an
  import cycle). The picker's registry menu and TS-driven modal become
  callers of the exported engine with no behavior change.
- glitter's foldouts (`ui/internal/views/mission/modal.go`) keep their own
  engine (grouped rows, badges, the action row, naming) but delete their
  copy of `dimForeground` and its ramp and call the shared one.
- New abilities, available to both callers:
  - **Sections.** A menu is a list of sections with a rule between each
    (GitHub Desktop's file menu has four). The picker's item/global split
    becomes two sections.
  - **Disabled rows.** Painted Faint, skipped by the cursor and by filtering
    order, inert to clicks and hover. GitHub Desktop greys rows rather than
    hiding them, so a menu keeps its shape.
  - **Name step.** A row can ask for a name: choosing it turns the menu's
    filter line into a name field (the foldouts' ctrl-n pattern), enter
    submits, esc returns to the rows. The title changes to the step's title.
  - **Question step.** A row can ask a follow-up: the same box swaps to a
    title and a short list of choices; choosing one runs it, esc returns to
    the rows. Used for Discard's confirm and as the stand-in for GitHub
    Desktop's Ignore Folder submenu.
- One line list per frame feeds both the render and the hit test (the rule
  that has held for every rt-ui surface); every line is clipped before
  `Width`.

## 2. Opening and closing

- **Right-click** on a Changes file row (label or checkbox), a History commit
  row, or a History file row moves the cursor to that row first (GitHub
  Desktop and nav both do), then opens the menu with its top-left at the
  pointer, sliding left and up only as far as needed to fit the frame.
  - Changes: moving the cursor selects the file, exactly as a left-click on
    the row does.
  - History: right-click on a commit inside the current range selection
    keeps the range and opens the board-wide section only (multi-commit
    actions arrive with the commit-actions follow-up). Right-click outside
    the range selects that single commit first.
- **ctrl-k** opens the same menu, centered (as nav's does), for the focused
  region: the Changes list or the Changes diff (that file), the History
  commit list (the cursor commit, or the board-wide section for a range),
  the History file column or History diff (that file). With nothing to act
  on, the menu is the board-wide section alone, titled "Actions".
- The menu's title is the row's label (file name or commit summary), clipped
  as nav clips it.
- Esc or a click outside closes it (the foldouts' behavior). ↑/↓ and enter
  navigate and choose; typing filters; a row's key hint is a live
  accelerator while the menu is open (nav's rule: a plain character always
  filters, so only chords and special keys fire).
- ctrl-k is unbound in glitter today; the keybar gains "⌃k menu" on both tabs
  (placed after the tab switch so it survives narrow widths).
- Early check (build step 1): confirm right-click and ctrl-k actually reach
  the mission view under herdr and in a plain terminal before building on
  them. Today a right-click on a file row shows "menu lands with polish",
  which proves delivery in code only.

## 3. The menus

Labels are GitHub Desktop's macOS labels, verbatim. "Editor" below is the
name `rt code` resolves for this repo (see section 4); when none resolves,
the label is GitHub Desktop's own fallback, "Open in External Editor".

### Changes file row

| Row | Enabled when |
|---|---|
| Discard Changes… | always |
| *rule* | |
| Ignore File (Add to .gitignore) | the file's basename is not `.gitignore` |
| Ignore Folder (Add to .gitignore)… | shown only when the path has a parent folder; enabled as the row above |
| Ignore All .ext Files (Add to .gitignore) | shown only when the path has an extension |
| *rule* | |
| Copy File Path | always |
| Copy Relative File Path | always |
| *rule* | |
| Reveal in Finder | the file is not deleted |
| Open in *Editor* | the file is not deleted |
| Open with Default Program | the file is not deleted |

- `.ext` follows Node's `path.extname` semantics, which GitHub Desktop uses:
  a basename that starts with its only dot (`.gitignore`, `.env`) has no
  extension. Go's `filepath.Ext` disagrees on exactly that case, so the Go
  label must not use it bare.
- `isSafeFileExtension` returns true on macOS, so Open with Default Program
  has no extension gate here.
- Ignore Folder's question step lists every ancestor folder, deepest first,
  each as GitHub Desktop builds it (`/a/b/c`, `/a/b`, `/a`).
- Discard's question step: title "Discard all changes to *file*?" (GitHub
  Desktop's dialog text), choices "Discard Changes" and "Cancel".

### History file row

| Row | Enabled when |
|---|---|
| Reveal in Finder | always |
| Open in *Editor* | always |
| Open with Default Program | always |
| *rule* | |
| Copy File Path | always |
| Copy Relative File Path | always |

When the file does not exist on disk the whole menu is one disabled row,
"File Does Not Exist on Disk" (GitHub Desktop), plus the board-wide section.
The driver supplies existence per file (section 5).

### Commit row (single commit)

| Row | Enabled when |
|---|---|
| Undo Commit… | shown only on the newest commit, and only when `u` would act (the model's `undoable`) |
| *rule* | |
| Create Branch from Commit | always |
| Create Tag… | always |
| *rule* | |
| Copy SHA | always |

- Undo Commit… runs exactly what `u` runs.
- Create Branch from Commit closes the menu and opens the branch foldout
  already in naming mode, its action row reading "New branch from
  *shortSha*…". Enter sends the existing `mission:checkout` new-branch
  payload with `from` set to the full sha (the payload and the driver's
  `createBranch(name, { from, checkout: true })` already support this).
- Create Tag… is a name step titled "Create a Tag" with placeholder "Name"
  (GitHub Desktop's dialog copy).
- Reset, Checkout, Reorder, Revert, Cherry-pick, Copy Tag, Delete Tag, View
  on GitHub, and the multi-commit menu are the commit-actions follow-up.

### Board-wide section

Below a rule in every menu, and the whole menu when nothing is focused. Each
row shows its key and runs exactly what the key runs.

- Changes tab: Commit `c`; the `f` row labeled with the action segment's
  current title from the model (Fetch origin, Pull origin, Pull origin with
  rebase, Push origin, Publish branch, with the real remote name); Switch
  Branch… `b`;
  Worktrees… `w`; Repositories… `r`; Filter `/`; Undo Last Commit `u` (shown
  only when `undoable`); Show History `2`.
- History tab: the `f` row; Switch Branch… `b`; Worktrees… `w`;
  Repositories… `r`; Filter `/`; Expand `e`; Show Changes `1`.
- Both tabs, keyless: Open Repository in *Editor*; Reveal Repository in
  Finder.

## 4. What runs

- Rows that mirror a key run that key's Go handler; nothing new goes on the
  wire for them.
- Every other row emits one new intent, `mission:menu-action`, payload
  `{ action, path?, sha?, name? }`. The driver dispatches on `action`:

| action | payload | effect |
|---|---|---|
| `copy-path` | path | absolute path to the clipboard (`pbcopy`), notice "Copied" |
| `copy-relative-path` | path | repo-relative path, normalized, to the clipboard, notice "Copied" |
| `copy-sha` | sha | full sha to the clipboard, notice "Copied" |
| `reveal` | path | `open -R <abs>` |
| `reveal-repo` | none | `open <worktree root>` |
| `open-default` | path | `open <abs>` |
| `open-editor` | path | `rt code`'s resolved editor on the file |
| `open-repo-editor` | none | `rt code`'s resolved editor on the worktree root |
| `ignore-file` | path | git-core `appendIgnoreFile(path)` |
| `ignore-folder` | path (`/a/b`) | git-core `appendIgnoreFile(path)`, as GitHub Desktop passes the folder label |
| `ignore-extension` | path | git-core `appendIgnoreRule("*" + extname(path))` |
| `discard-file` | path | git-core `discardChanges([file])` |
| `create-tag` | sha, name | git-core `createTag(name, { sha })` |

- Paths in payloads are repo-relative, as every other mission intent carries
  them; the driver joins them to the current worktree root.
- Reveal, open-default, and clipboard copy move out of `commands/nav.ts` into
  one shared module (`lib/file-actions.ts`) that nav and the driver both
  call; nav's behavior and tests do not change.
- The editor comes from `commands/code.ts`: `resolveEditorSync` for the
  current repo, `editorLabelFor` for the label, and its launcher for the
  target (exported as needed). No interactive picker runs inside glitter;
  when nothing resolves, the row reads "Open in External Editor" and
  choosing it sets the notice "No editor set: run rt code once to pick one".
- After ignore, discard, and create-tag the driver refreshes and pushes, as
  every mutating intent does. Failures surface as the notice with git's (or
  the Trash's) message. Discard re-reads git status before acting. In a
  multi-file discard, a Trash failure on a later file still finishes the
  files already moved to the Trash, so the discard as a whole can be
  partially applied; any path a not-yet-trashed file still owns is left as
  it was, even when an already-trashed file shares it. glitter's menu only
  ever discards one file.
- After discard, the file's commit-intent selection is cleared (it no longer
  has changes; the staging model's selection map drops it).

## 5. Wire changes

- Mission model: `editorLabel: string` ("" when none resolves).
- History file rows: `onDisk: boolean`, computed by the driver when it builds
  the file list for the selected commit or range.
- New intent `mission:menu-action` (section 4). No other intent changes.
- Golden fixtures in `ui/fixtures/` gain the new fields; both languages'
  decode tests read them.

## 6. git-core ports (verbatim from GitHub Desktop)

- `appendIgnoreRule(patterns)`, `appendIgnoreFile(paths)`,
  `escapeGitSpecialCharacters` (escapes `[ ] ! * # ?`), with
  `formatGitIgnoreContents` honoring `core.autocrlf` for line endings and
  `saveGitIgnore` refusing a symlinked `.gitignore` (`O_NOFOLLOW`) and
  creating the file with `O_EXCL` when absent. A tracked file stays tracked.
- `discardChanges(files)`: for each non-deleted file, move it to the Trash
  first (`/usr/bin/trash`); renamed and copied files reset both their new and
  old paths and check out the old one; then `git reset --mixed HEAD --` only
  the paths the index actually changed, and `git checkout-index` the paths
  that exist in the index. If a Trash move fails, the reset and
  checkout-index steps still run for the files already trashed (excluding
  any path a not-yet-trashed file still owns), then the Trash error
  surfaces; the failing file and every later one stay untouched. (GitHub
  Desktop then offers a permanent delete; glitter does not.)
- Submodule handling follows GitHub Desktop's (skip the Trash for a
  submodule path, reset submodule paths separately).
- New client methods on `GitClient` for all three, with tests against real
  temporary repositories.

## 7. Differences from GitHub Desktop (for the design README's ratified list)

- Menus filter by typing and carry key accelerators (nav's menu).
- ctrl-k opens the menu for the focused row and always carries a board-wide
  section that lists every key.
- Ignore Folder is a follow-up list in the same box, not a submenu.
- A failed move to the Trash does not offer a permanent delete.
- View on GitHub is not offered yet.

## 8. Design boards

Before any UI code: a Context Menu board in `docs/design/mission/mission.pen`
with exported PNGs, shown to the owner for sign-off. States: a Changes file
menu anchored at a pointer near the right edge (slid left); a commit menu;
ctrl-k centered with only the board-wide section; disabled rows; the Discard
question step; the Create Tag name step; the History "File Does Not Exist on
Disk" menu; hover versus cursor rows.

## 9. Testing

- Go: row sets from row facts (deleted, `.gitignore`, no extension, dotfile,
  no parent folder, newest commit with and without `undoable`, range
  selection, file not on disk); section rules; disabled rows skipped by
  cursor, filter, hover, and click; placement clamped at every frame edge;
  render and hit test walking the same painted frame; keyboard navigation,
  esc, click-outside, accelerators; name and question steps (enter, esc
  back to rows); the picker's existing suites (including the replay tests)
  unchanged and green after the lift; a width sweep with the menu open.
- TS: the driver's `mission:menu-action` dispatch for every action with
  fake deps (clipboard, open, editor, git-core); nav's tests unchanged after
  the lift; `extname` parity cases.
- git-core: ignore escaping, CRLF with `core.autocrlf=true`, a missing
  `.gitignore`, a symlinked `.gitignore` refused; discard of modified, new
  (untracked), staged-new, renamed, and deleted files; a failing Trash on a
  single file leaves the tree and index untouched; a failing Trash on a later
  file restores the earlier trashed files to HEAD and leaves the failing one
  (and any path it still owns) as it was.
- pty: one test through the real binary opens the menu with ctrl-k and
  closes it with esc. Right-click is covered at the view level until the pty
  harness can send mouse events.
- Visual: every board state captured from a real glitter frame and compared
  to the board before hand-off.

## 10. Build order

1. Confirm right-click and ctrl-k delivery (section 2's early check).
2. Lift the menu engine out of the picker, no behavior change; foldouts use
   the shared dimming.
3. Menu abilities: sections, disabled rows, name step, question step.
4. git-core: ignore and discard ports.
5. TS: `lib/file-actions.ts` lift, `mission:menu-action` dispatch,
   `editorLabel`, History `onDisk`.
6. glitter: the action table, opening and closing, the three row menus, the
   board-wide section, Create Branch from Commit hand-off, keybar entry.
7. Docs: design README section, ratified differences, geometry rows.

## Out of scope

Multi-commit menus and every commit action not listed above; View on GitHub;
the diff pane's own line menu; a Changes list background menu (Discard All,
Stash All); permanent delete on a Trash failure.
