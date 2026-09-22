# glitter History Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make glitter's History tab real: a paged commit list for the current branch, a GitHub Desktop style commit header, the commit's changed-file list, and a read-only per-file diff, with contiguous range selection.

**Architecture:** Port GitHub Desktop's history git methods into `packages/git-core` (pure parsers vendored verbatim under `vendor/ghd/`, git-invoking wrappers in `history.ts`). A `HistoryStore` in `lib/mission/history.ts` ports GHD's `app-store` sequencing (lazy load, tip check, local-first paging, stale guards). The driver owns the active tab and pushes a `history` block plus a read-only `diff` on the existing wire model. The Go view renders the History sidebar and right pane in a new `history.go`, reusing `diff.go`'s renderer.

**Tech Stack:** Bun + TypeScript (git-core, driver), Go + Bubble Tea v2 + lipgloss v2 (rt-ui), termwright (pty gate).

**Spec:** `docs/superpowers/specs/2026-09-22-glitter-history-tab-design.md`

**GHD source of truth:** `~/Documents/GitHub/github-desktop` at commit `9dfe6e60`. Paths written `app/src/...` are relative to that clone. Read the named function before porting it.

## Global Constraints

- The rt repo is PUBLIC. Never write a Linear ticket id (the letters R, T, a hyphen, then digits) or an employer name into source, tests, comments, fixtures, or commit messages. Run `bash scripts/repo-purity.sh` before every commit.
- Never use em dashes or en dashes anywhere (code, comments, docs, commit messages). Use "..." or rephrase.
- Comments state only constraints the code cannot show (parity anchors, ordering traps, invariants). No narration, no reviewer-facing justification, no decision history, no task numbers.
- Every color is a `theme.go` token (`ui/internal/theme/theme.go`). Never an inline hex or `lipgloss.Color("...")`.
- Lift, don't duplicate: scrolling regions use `picker.Viewport`/`picker.ThumbSpan`/`picker.ThumbCell` (`ui/internal/views/picker/scroll.go`); text clipping uses `clip`/`clipOn` (`topbar.go`); path truncation uses `middleTruncate` (`changes.go`); chips use `pill` (`topbar.go`).
- `clip` is for uncolored text; `clipOn` only for already-ANSI-composed strings. lipgloss `Width()` WRAPS rather than truncates: anything wider than its box adds a row and desyncs hit-testing. Clip before `Width()`.
- Any new render row must be mirrored in the hit-test walk for the same region, or every click below it lands on the wrong target.
- After any change under `ui/`, run `bun run ui:build`. Never `git add ui/dist/rt-ui` (gitignored, hook-maintained).
- A built binary is only ever run under an isolated HOME (`env -i HOME=<tmp> PATH=$PATH ...`).
- Worktree sessions refuse compound shell commands: run plain single commands (no `&&`, heredocs, `cd x && ...`, or `git -C`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Test commands: `bun test packages/git-core`, `bun test lib/mission`, `bunx tsc --noEmit`, and from `ui/`: `go test ./internal/views/mission/ ./internal/protocol/`.

## Rulings made while planning

Each resolves a gap between the spec's wording and the code as it exists. Task 1 carries them into the spec text.

1. **`mission:history-select` carries `{ shas: string[] }`** (list order, newest first), not `(sha, extend)`. The Go view owns the cursor and range anchor (view-local state per the spec), so it sends the resulting selection whole.
2. **The selection debounce is Go-side.** `selectTick`/`selectDebounceInterval` in `mission.go` already debounce the Changes cursor; History reuses them with its own generation counter. The driver has no `selectGen`.
3. **The keybar is per tab, not per focus.** The Changes keybar is a static strip (`renderKeybar`); History gets its own strip.
4. **`e` toggles the header's expanded state.** GHD's expander is a tabbable button; a terminal needs a key. Ratified deviation, recorded in the README.
5. **Shift+click range selection only works where the terminal forwards shift-modified clicks.** Ghostty and Terminal.app reserve shift+click for native text selection while mouse reporting is on. Shift+↑/↓ is the dependable path. Recorded in the README.
6. **Oversized and binary gating reuse rt's existing checks** (`classifyDiffText`, `OVERSIZED_LINE_CUTOFF` in `model.ts`), matching the Changes pane. GHD's byte-size thresholds are not ported.
7. **The 100 KiB summary/body cap counts characters**, since rt reads git output as strings; GHD counts bytes of a Buffer.
8. **GHD's "commits not reachable" link in the range header is not ported.** A range header reads "Showing changes from N commits".
9. **The header carries a `byline` field** (collapsed meta line) beside `authors` (the expanded one-per-line list, each `Name <email>`, per GHD's `renderExpandedAuthor`).

## Review Focus

The five inputs most likely to bite a real user that no task would otherwise exercise. Each line's test is added to the task named.

1. **Unusual commit messages:** empty summary, a 300-character summary, emoji and CJK, a body that is only trailers. Rows and header lines must stay one terminal row each (no wrap, no hit desync). Test in Task 7 (`TestCommitRowNeverWraps`) and Task 8 (`TestHeaderLinesNeverWrap`).
2. **Ranges that include the root commit, and merge commits:** the range methods must retry against the null tree, and a merge diffs against its first parent. Tests in Task 3.
3. **Long histories:** scrolling to the end of 250 commits must request each next page exactly once and never duplicate a commit. Tests in Task 4 (store) and Task 7 (view emits `mission:history-more` once per page).
4. **A new tip while History is open** (a commit from another terminal): the list reloads and keeps the selected commit when it is still present. Test in Task 6.
5. **Detached HEAD, unborn repo, branch without upstream:** no crash; unpushed markers come from `--not --remotes`; an unborn repo shows "No history". Tests in Task 2 (git-core), Task 4 (store), Task 8 (view).

## File Structure

| File | Responsibility |
|---|---|
| `packages/git-core/src/vendor/ghd/log-parse.ts` (new) | Verbatim GHD ports: log format parser, identity, trailers, co-authors, raw+numstat parser, status mapping. Pure functions, no git. |
| `packages/git-core/src/vendor/ghd/fatal-error.ts` | Gains GHD's `forceUnwrap`. |
| `packages/git-core/src/vendor/ghd/README.md` | Vendor table rows for the above. |
| `packages/git-core/src/history.ts` (new) | Git-invoking ports: `getCommits`, `getLocalCommits`, `getChangedFiles`, `getCommitRangeChangedFiles`, `getCommitDiff`, `getCommitRangeDiff`. |
| `packages/git-core/src/types.ts`, `client.ts`, `index.ts` | `Commit` type, re-exported history types, six new `GitClient` methods, `AppFileStatusKind` export. |
| `lib/mission/history.ts` (new) | `HistoryStore`: GHD `app-store` sequencing over a `GitClient`. |
| `lib/mission/history-model.ts` (new) | Pure wire builders: byline, authors, commit rows, header, file rows. |
| `lib/ui/protocol.ts` | History wire types, `tab`, `diff.readOnly`, four intent names. |
| `lib/mission/model.ts` | `buildModel` gains `tab`, `history`, `historyDiff`; `buildDiffModel` gains `readOnly`. |
| `lib/mission/driver.ts` | Tab state, four intents, tip sync on every refresh path, history reset on worktree switch. |
| `ui/internal/views/mission/model.go` | Go mirror of the new wire types. |
| `ui/internal/views/mission/history.go` (new) | History sidebar, commit rows, header, file column, pane composition, history key/mouse helpers. |
| `ui/internal/views/mission/mission.go` | Focus kind, state fields, Update routing, layout/hit/hover/wheel branches for History. |
| `ui/internal/views/mission/changes.go` | Two-state tab strip, per-tab keybar. |
| `ui/internal/views/mission/diff.go` | `ReadOnly` handling, parameterized `diffHit` width, history empty states. |
| `ui/fixtures/session-model-mission.json`, `session-model-mission-history.json` (new) | Cross-language golden fixtures. |
| `e2e/pty/glitter.test.ts` | History round trip through the real binary. |
| `docs/design/mission/README.md`, `mission.pen`, `History.png` | Board, deviations, deferred list. |

---

### Task 1: History board and doc rulings (controller-owned, gated on Matt)

The controller does this task itself; it is visual work and is never dispatched. Matt signs off the board before Task 7 is dispatched. Tasks 2 through 6 do not depend on it and may run while the board is reviewed.

**Files:**
- Modify: `docs/design/mission/mission.pen` (via the pencil MCP tools only; `.pen` files are encrypted)
- Create: `docs/design/mission/History.png` (export of the new board)
- Modify: `docs/design/mission/README.md`
- Modify: `docs/superpowers/specs/2026-09-22-glitter-history-tab-design.md`

- [ ] **Step 1: Draw the History board** in `mission.pen` beside `Main`: the History tab active, a two-line commit list with a cursor row, a range-selected pair, a tag pill and an unpushed ↑; the right pane with a collapsed header (summary, 2 description lines, meta line), the rule with its ┬, "3 changed files" and file rows, and a read-only diff (no stage bar). A second frame shows the expanded header. Use only theme roles already on the boards.
- [ ] **Step 2: Export `History.png`** and view it in both schemes before showing Matt. Say plainly anything that reads wrong.
- [ ] **Step 3: README edits.** In "Boards", add a `History.png` bullet. In "Ratified deviations", replace "The History tab is deferred; the tab renders dimmed." with three bullets: `1`/`2` switch tabs (GHD binds ⌘1/⌘2, which a terminal cannot receive); `e` toggles the commit header's expanded state (GHD's expander is a tabbable button); shift+click extends a range only where the terminal forwards shift-modified clicks (Ghostty and Terminal.app keep shift+click for text selection), shift+↑/↓ always works. In "Deferred to v2", remove the History bullet and add: **Branch compare** (GHD's "Select Branch to Compare" box and merge call-to-action; no code yet), **Hide whitespace** (no diff options on either tab yet), **Commit actions** (revert, cherry-pick, reset, branch or tag from commit, copy sha; they arrive with row context menus).
- [ ] **Step 4: Spec edits** for rulings 1, 2, 3, and 9: the intent line reads `mission:history-select` (`shas`, newest first); the Stale guard bullet names the Go-side `selectTick` debounce instead of `selectGen`; the Keys section says the keybar is per tab; the header wire list gains `byline`.
- [ ] **Step 5: File the deferred tickets** on the glitter v2 milestone in Linear (Branch compare, Hide whitespace), PM-shaped (Problem, Fix, Acceptance). Ticket ids stay in Linear only.
- [ ] **Step 6: Show Matt the board** (publish or open the PNG) and wait for sign-off. Record the sign-off in the SDD ledger.
- [ ] **Step 7: Commit**

```
git add docs/design/mission docs/superpowers/specs/2026-09-22-glitter-history-tab-design.md
git commit -m "docs: History board, ratified deviations, deferred list"
```

---

### Task 2: Vendor GHD's log parsers and add `commits()` / `localCommits()`

**Files:**
- Create: `packages/git-core/src/vendor/ghd/log-parse.ts`
- Modify: `packages/git-core/src/vendor/ghd/fatal-error.ts`, `packages/git-core/src/vendor/ghd/README.md`
- Create: `packages/git-core/src/history.ts`
- Modify: `packages/git-core/src/types.ts`, `packages/git-core/src/client.ts`, `packages/git-core/src/index.ts`
- Modify: `lib/mission/__tests__/driver.test.ts` (fake client gains the new methods so `tsc` stays green)
- Test: `packages/git-core/src/__tests__/log-parse.test.ts`, `packages/git-core/src/__tests__/history-commits.test.ts`

**Interfaces:**
- Produces (git-core): `Commit`, `CommitIdentity`, `GitAuthor`, `Trailer`, `ChangesetData`, `CommittedFileChange`, `CommittedFileStatus`, `SubmoduleStatus` types; `AppFileStatusKind` enum export; `GitClient.commits(range?, limit?, skip?, additionalArgs?)`, `GitClient.localCommits(branch, skip?)`; `COMMIT_BATCH_SIZE = 100`. The four changeset/diff methods are declared here and implemented in Task 3 (this task wires them to throw `not implemented` so the interface is complete).

- [ ] **Step 1: Add `forceUnwrap` to the vendored fatal-error.** Append to `packages/git-core/src/vendor/ghd/fatal-error.ts`:

```ts
/**
 * Unwrap a value that, according to the type system, could be null or
 * undefined, but which we know is not. If the value _is_ null or undefined,
 * this will throw with the given message.
 */
export function forceUnwrap<T>(message: string, x: T | null | undefined): T {
  if (x == null) {
    throw new Error(message)
  }
  return x
}
```

- [ ] **Step 2: Write the failing parser tests.** Create `packages/git-core/src/__tests__/log-parse.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  createLogParser,
  extractCoAuthors,
  isCoAuthoredByTrailer,
  parseGitAuthor,
  parseIdentity,
  parseRawLogWithNumstat,
  parseRawUnfoldedTrailers,
} from "../vendor/ghd/log-parse.ts";
import { AppFileStatusKind } from "../vendor/ghd/types.ts";

describe("vendored GHD log parsers", () => {
  it("createLogParser splits NUL-terminated records into named fields", () => {
    const { formatArgs, parse } = createLogParser({ sha: "%H", summary: "%s" });
    expect(formatArgs).toEqual(["-z", "--format=%H%x00%s"]);
    expect(parse("aaa\0first\0bbb\0second\0")).toEqual([
      { sha: "aaa", summary: "first" },
      { sha: "bbb", summary: "second" },
    ]);
    expect(parse("")).toEqual([]);
  });

  it("parseIdentity reads git's raw date and timezone", () => {
    const id = parseIdentity("Pat Doe <pat@example.com> 1700000000 -0530");
    expect(id.name).toBe("Pat Doe");
    expect(id.email).toBe("pat@example.com");
    expect(id.date.getTime()).toBe(1700000000 * 1000);
    expect(id.tzOffset).toBe(-330);
    expect(() => parseIdentity("garbage")).toThrow();
  });

  it("parses unfolded trailers and picks co-authors case-insensitively", () => {
    const trailers = parseRawUnfoldedTrailers("Co-authored-by: Sam <sam@example.com>\nSigned-off-by: Pat <pat@example.com>\n", ":");
    expect(trailers).toEqual([
      { token: "Co-authored-by", value: "Sam <sam@example.com>" },
      { token: "Signed-off-by", value: "Pat <pat@example.com>" },
    ]);
    expect(trailers.filter(isCoAuthoredByTrailer).length).toBe(1);
    expect(extractCoAuthors(trailers)).toEqual([{ name: "Sam", email: "sam@example.com" }]);
    expect(parseGitAuthor("no brackets")).toBeNull();
  });

  it("parseRawLogWithNumstat reads plain, renamed, and submodule entries", () => {
    const stdout = [
      ":100644 100644 5716ca5 db3c77d M", "a.txt",
      ":100644 100644 0835e4f 28096ea R087", "old.md", "new.md",
      ":000000 160000 0000000 28096ea A", "sub",
      "3\t1\ta.txt",
      "2\t2\t", "old.md", "new.md",
      "1\t0\tsub",
      "",
    ].join("\0");
    const data = parseRawLogWithNumstat(stdout, "abc", "abc^");
    expect(data.linesAdded).toBe(6);
    expect(data.linesDeleted).toBe(3);
    expect(data.files.map((f) => f.path)).toEqual(["a.txt", "new.md", "sub"]);
    expect(data.files[0]!.status).toEqual({ kind: AppFileStatusKind.Modified, submoduleStatus: undefined });
    expect(data.files[1]!.status).toEqual({
      kind: AppFileStatusKind.Renamed,
      oldPath: "old.md",
      submoduleStatus: undefined,
      renameIncludesModifications: true,
    });
    expect(data.files[2]!.status.submoduleStatus).toEqual({ commitChanged: false, untrackedChanges: false, modifiedChanges: false });
    expect(data.files[0]!.commitish).toBe("abc");
    expect(data.files[0]!.parentCommitish).toBe("abc^");
  });

  it("a binary numstat entry ('-') counts as zero lines", () => {
    const stdout = [":100644 100644 aaa bbb M", "img.png", "-\t-\timg.png", ""].join("\0");
    const data = parseRawLogWithNumstat(stdout, "s", "s^");
    expect(data.linesAdded).toBe(0);
    expect(data.linesDeleted).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails.** `bun test packages/git-core/src/__tests__/log-parse.test.ts` → FAIL (module `log-parse.ts` not found).

- [ ] **Step 4: Create `packages/git-core/src/vendor/ghd/log-parse.ts`.** Keep GHD's formatting (no semicolons, single quotes) like the other vendored files. Port each function from the named GHD source, adding only the `!`/`forceUnwrap` needed for `noUncheckedIndexedAccess`:

```ts
import { AppFileStatusKind } from './types'
import { forceUnwrap } from './fatal-error'

// File mode 160000 is used by git specifically for submodules:
// https://github.com/git/git/blob/v2.37.3/cache.h#L62-L69
const SubmoduleFileMode = '160000'

export type SubmoduleStatus = {
  readonly commitChanged: boolean
  readonly modifiedChanges: boolean
  readonly untrackedChanges: boolean
}

export type PlainFileStatus = {
  kind:
    | AppFileStatusKind.New
    | AppFileStatusKind.Modified
    | AppFileStatusKind.Deleted
  submoduleStatus?: SubmoduleStatus
}

export type CopiedOrRenamedFileStatus = {
  kind: AppFileStatusKind.Copied | AppFileStatusKind.Renamed
  oldPath: string
  renameIncludesModifications: boolean
  submoduleStatus?: SubmoduleStatus
}

export type UntrackedFileStatus = {
  kind: AppFileStatusKind.Untracked
  submoduleStatus?: SubmoduleStatus
}

export type CommittedFileStatus =
  | PlainFileStatus
  | CopiedOrRenamedFileStatus
  | UntrackedFileStatus

/** GHD's CommittedFileChange class, as a plain record. */
export interface CommittedFileChange {
  readonly path: string
  readonly status: CommittedFileStatus
  readonly commitish: string
  readonly parentCommitish: string
}

export interface IChangesetData {
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly linesAdded: number
  readonly linesDeleted: number
}

export interface ITrailer {
  readonly token: string
  readonly value: string
}

/** GHD's CommitIdentity class, as a plain record. */
export interface CommitIdentity {
  readonly name: string
  readonly email: string
  readonly date: Date
  readonly tzOffset: number
}

/** GHD's GitAuthor class, as a plain record. */
export interface GitAuthor {
  readonly name: string
  readonly email: string
}

export function createLogParser<T extends Record<string, string>>(fields: T) {
  const keys: Array<keyof T> = Object.keys(fields)
  const format = Object.values(fields).join('%x00')
  const formatArgs = ['-z', `--format=${format}`]

  const parse = (value: string) => {
    const records = value.split('\0')
    const entries = new Array<{ [K in keyof T]: string }>()

    for (let i = 0; i < records.length - keys.length; i += keys.length) {
      const entry = {} as { [K in keyof T]: string }
      keys.forEach((key, ix) => (entry[key] = records[i + ix]!))
      entries.push(entry)
    }

    return entries
  }

  return { formatArgs, parse }
}

export function parseIdentity(identity: string): CommitIdentity {
  const m = identity.match(/^(.*?) <(.*?)> (\d+) (\+|-)?(\d{2})(\d{2})/)
  if (!m) {
    throw new Error(`Couldn't parse identity ${identity}`)
  }

  const name = m[1]!
  const email = m[2]!
  const date = new Date(parseInt(m[3]!, 10) * 1000)

  if (isNaN(date.valueOf())) {
    throw new Error(`Couldn't parse identity ${identity}, invalid date`)
  }

  const tzSign = m[4] === '-' ? '-' : '+'
  const tzMinutes = parseInt(m[5]!, 10) * 60 + parseInt(m[6]!, 10)
  const tzOffset = tzMinutes * (tzSign === '-' ? -1 : 1)

  return { name, email, date, tzOffset }
}

export function parseSingleUnfoldedTrailer(
  line: string,
  separators: string
): ITrailer | null {
  for (const separator of separators) {
    const ix = line.indexOf(separator)
    if (ix > 0) {
      return {
        token: line.substring(0, ix).trim(),
        value: line.substring(ix + 1).trim(),
      }
    }
  }

  return null
}

export function parseRawUnfoldedTrailers(trailers: string, separators: string) {
  const lines = trailers.split('\n')
  const parsedTrailers = new Array<ITrailer>()

  for (const line of lines) {
    const trailer = parseSingleUnfoldedTrailer(line, separators)

    if (trailer) {
      parsedTrailers.push(trailer)
    }
  }

  return parsedTrailers
}

export function isCoAuthoredByTrailer(trailer: ITrailer) {
  return trailer.token.toLowerCase() === 'co-authored-by'
}

export function parseGitAuthor(nameAddr: string): GitAuthor | null {
  const m = nameAddr.match(/^(.*?)\s+<(.*?)>/)
  return m === null ? null : { name: m[1]!, email: m[2]! }
}

export function extractCoAuthors(trailers: ReadonlyArray<ITrailer>) {
  const coAuthors = new Array<GitAuthor>()

  for (const trailer of trailers) {
    if (isCoAuthoredByTrailer(trailer)) {
      const author = parseGitAuthor(trailer.value)
      if (author) {
        coAuthors.push(author)
      }
    }
  }

  return coAuthors
}

function mapSubmoduleStatusFileModes(
  status: string,
  srcMode: string,
  dstMode: string
): SubmoduleStatus | undefined {
  return srcMode === SubmoduleFileMode &&
    dstMode === SubmoduleFileMode &&
    status === 'M'
    ? {
        commitChanged: true,
        untrackedChanges: false,
        modifiedChanges: false,
      }
    : (srcMode === SubmoduleFileMode && status === 'D') ||
      (dstMode === SubmoduleFileMode && status === 'A')
    ? {
        commitChanged: false,
        untrackedChanges: false,
        modifiedChanges: false,
      }
    : undefined
}

export function mapStatus(
  rawStatus: string,
  oldPath: string | undefined,
  srcMode: string,
  dstMode: string
): CommittedFileStatus {
  const status = rawStatus.trim()
  const submoduleStatus = mapSubmoduleStatusFileModes(status, srcMode, dstMode)

  if (status === 'M') {
    return { kind: AppFileStatusKind.Modified, submoduleStatus }
  } // modified
  if (status === 'A') {
    return { kind: AppFileStatusKind.New, submoduleStatus }
  } // added
  if (status === '?') {
    return { kind: AppFileStatusKind.Untracked, submoduleStatus }
  } // untracked
  if (status === 'D') {
    return { kind: AppFileStatusKind.Deleted, submoduleStatus }
  } // deleted
  if (status === 'R' && oldPath != null) {
    return {
      kind: AppFileStatusKind.Renamed,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  } // renamed
  if (status === 'C' && oldPath != null) {
    return {
      kind: AppFileStatusKind.Copied,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  } // copied

  // git log -M --name-status will return a RXXX - where XXX is a percentage
  if (status.match(/R[0-9]+/) && oldPath != null) {
    return {
      kind: AppFileStatusKind.Renamed,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: status !== 'R100',
    }
  }

  // git log -C --name-status will return a CXXX - where XXX is a percentage
  if (status.match(/C[0-9]+/) && oldPath != null) {
    return {
      kind: AppFileStatusKind.Copied,
      oldPath,
      submoduleStatus,
      renameIncludesModifications: false,
    }
  }

  return { kind: AppFileStatusKind.Modified, submoduleStatus }
}

const isCopyOrRename = (
  status: CommittedFileStatus
): status is CopiedOrRenamedFileStatus =>
  status.kind === AppFileStatusKind.Copied ||
  status.kind === AppFileStatusKind.Renamed

export function parseRawLogWithNumstat(
  stdout: string,
  sha: string,
  parentCommitish: string
): IChangesetData {
  const files = new Array<CommittedFileChange>()
  let linesAdded = 0
  let linesDeleted = 0
  let numStatCount = 0
  const lines = stdout.split('\0')

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!
    if (line.startsWith(':')) {
      const lineComponents = line.split(' ')
      const srcMode = forceUnwrap(
        'Invalid log output (srcMode)',
        lineComponents[0]?.replace(':', '')
      )
      const dstMode = forceUnwrap(
        'Invalid log output (dstMode)',
        lineComponents[1]
      )
      const status = forceUnwrap(
        'Invalid log output (status)',
        lineComponents.at(-1)
      )
      const oldPath = /^R|C/.test(status)
        ? forceUnwrap('Missing old path', lines.at(++i))
        : undefined

      const path = forceUnwrap('Missing path', lines.at(++i))

      files.push({
        path,
        status: mapStatus(status, oldPath, srcMode, dstMode),
        commitish: sha,
        parentCommitish,
      })
    } else {
      const match = /^(\d+|-)\t(\d+|-)\t/.exec(line)
      const [, added, deleted] = forceUnwrap('Invalid numstat line', match)
      linesAdded += added === '-' ? 0 : parseInt(added!, 10)
      linesDeleted += deleted === '-' ? 0 : parseInt(deleted!, 10)

      // If this entry denotes a rename or copy the old and new paths are on
      // two separate fields (separated by \0). Otherwise they're on the same
      // line as the added and deleted lines.
      const file = forceUnwrap('Numstat entry without a raw entry', files[numStatCount])
      if (isCopyOrRename(file.status)) {
        i += 2
      }
      numStatCount++
    }
  }

  return { files, linesAdded, linesDeleted }
}
```

- [ ] **Step 5: Run the parser tests.** `bun test packages/git-core/src/__tests__/log-parse.test.ts` → PASS. If a case fails, fix the port against the GHD source, not the test.

- [ ] **Step 6: Add the vendor README rows.** In `packages/git-core/src/vendor/ghd/README.md`'s "Vendor Files" table add:

| `log-parse.ts` | `app/src/lib/git/log.ts` (`mapSubmoduleStatusFileModes`, `mapStatus`, `parseRawLogWithNumstat`), `app/src/lib/git/git-delimiter-parser.ts` (`createLogParser`), `app/src/models/commit-identity.ts` (`parseIdentity`), `app/src/lib/git/interpret-trailers.ts` (`parseSingleUnfoldedTrailer`, `parseRawUnfoldedTrailers`, `isCoAuthoredByTrailer`), `app/src/models/git-author.ts` (`parse`), `app/src/models/commit.ts` (`extractCoAuthors`), `app/src/models/status.ts` (status types) |

and to "Edits Made to Vendored Files":

| `log-parse.ts` | Classes (`CommitIdentity`, `GitAuthor`, `CommittedFileChange`) become plain records; `createLogParser` takes strings only (no Buffer path); `!`/`forceUnwrap` added for noUncheckedIndexedAccess | rt reads git output as strings; repo compiler settings |
| `fatal-error.ts` | Added `forceUnwrap`, throwing a plain Error instead of calling `fatalError` | Needed by `parseRawLogWithNumstat`; no Electron fatal-error machinery |

- [ ] **Step 7: Add the types.** In `packages/git-core/src/types.ts`, add near `LogEntry`:

```ts
import type {
  CommitIdentity,
  GitAuthor,
  ITrailer,
  IChangesetData,
  CommittedFileChange,
  CommittedFileStatus,
  SubmoduleStatus,
} from "./vendor/ghd/log-parse.ts";

export type { CommitIdentity, GitAuthor, CommittedFileChange, CommittedFileStatus, SubmoduleStatus };
export type Trailer = ITrailer;
export type ChangesetData = IChangesetData;

/** GitHub Desktop's Commit model (app/src/models/commit.ts), as a plain record. */
export interface Commit {
  sha: string;
  shortSha: string;
  summary: string;
  body: string;
  author: CommitIdentity;
  committer: CommitIdentity;
  parentSHAs: string[];
  trailers: Trailer[];
  tags: string[];
  coAuthors: GitAuthor[];
  authoredByCommitter: boolean;
  isMergeCommit: boolean;
}
```

and to `GitClient`:

```ts
  /** GHD getCommits: newest first; an unborn HEAD yields []. */
  commits(range?: string, limit?: number, skip?: number, additionalArgs?: ReadonlyArray<string>): Promise<Commit[]>;
  /** GHD loadLocalCommits: commits HEAD has that no remote does (the unpushed set). Null branch (detached/unborn) yields []. */
  localCommits(branch: { name: string; upstream: string | null } | null, skip?: number): Promise<Commit[]>;
  changedFiles(sha: string): Promise<ChangesetData>;
  /** shas oldest first (GHD's orderShasByHistory order). */
  commitRangeChangedFiles(shas: ReadonlyArray<string>): Promise<ChangesetData>;
  commitDiff(file: CommittedFileChange, sha: string): Promise<StagingDiff>;
  /** shas oldest first. */
  commitRangeDiff(file: CommittedFileChange, shas: ReadonlyArray<string>): Promise<StagingDiff>;
```

In `packages/git-core/src/index.ts` add `export { AppFileStatusKind } from "./vendor/ghd/types.ts";`.

- [ ] **Step 8: Write the failing git tests.** Create `packages/git-core/src/__tests__/history-commits.test.ts` (ports of GHD's `test/unit/git/log-test.ts` getCommits cases and `log-revision-exclusions-test.ts`, onto sandboxes):

```ts
import { describe, expect, it } from "bun:test";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient } from "../index.ts";

async function commit(sb: Awaited<ReturnType<typeof makeSandbox>>, file: string, content: string, message: string): Promise<string> {
  await sb.write(file, content);
  await sb.commitAll(message);
  return (await sb.git(["rev-parse", "HEAD"])).trim();
}

describe("commits()", () => {
  it("loads history newest first with short shas, parents, and identities", async () => {
    const sb = await makeSandbox();
    try {
      const first = await commit(sb, "a.txt", "1\n", "first");
      await commit(sb, "a.txt", "2\n", "second");
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits.map((c) => c.summary)).toEqual(["second", "first"]);
      expect(commits[1]!.sha).toBe(first);
      expect(commits[1]!.shortSha).toBe(first.slice(0, commits[1]!.shortSha.length));
      expect(commits[1]!.parentSHAs).toEqual([]);
      expect(commits[0]!.parentSHAs).toEqual([first]);
      expect(commits[0]!.author.email).toBe("test@example.com");
      expect(commits[0]!.authoredByCommitter).toBe(true);
      expect(commits[0]!.isMergeCommit).toBe(false);
    } finally {
      await sb.cleanup();
    }
  });

  it("parses tags, including a tag whose name contains a comma", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "first");
      await commit(sb, "a.txt", "2\n", "second");
      await sb.git(["tag", "important"]);
      await sb.git(["tag", "rc,one", "HEAD~1"]);
      await sb.git(["tag", "tentative", "HEAD~1"]);
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits[0]!.tags).toEqual(["important"]);
      expect([...commits[1]!.tags].sort()).toEqual(["rc,one", "tentative"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("ignores log.showSignature", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "first");
      await sb.git(["config", "log.showSignature", "true"]);
      expect((await createGitClient(sb.dir).commits("HEAD", 100)).length).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("an unborn HEAD yields an empty history", async () => {
    const sb = await makeSandbox();
    try {
      expect(await createGitClient(sb.dir).commits("HEAD", 100)).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("limit and skip page through history", async () => {
    const sb = await makeSandbox();
    try {
      for (const n of [1, 2, 3]) await commit(sb, "a.txt", `${n}\n`, `c${n}`);
      const client = createGitClient(sb.dir);
      expect((await client.commits("HEAD", 1, 1)).map((c) => c.summary)).toEqual(["c2"]);
      expect((await client.commits("HEAD", 100, 3)).length).toBe(0);
    } finally {
      await sb.cleanup();
    }
  });

  it("reads co-author trailers and flags a merge commit", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await sb.write("f.txt", "f\n");
      await sb.git(["add", "-A"]);
      await sb.git(["commit", "-m", "feature work", "-m", "Co-authored-by: Sam <sam@example.com>"]);
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main work");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge feature"]);
      const commits = await createGitClient(sb.dir).commits("HEAD", 100);
      expect(commits[0]!.isMergeCommit).toBe(true);
      const feature = commits.find((c) => c.summary === "feature work")!;
      expect(feature.coAuthors).toEqual([{ name: "Sam", email: "sam@example.com" }]);
    } finally {
      await sb.cleanup();
    }
  });

  // Port of GHD's log-revision-exclusions-test.ts.
  it("preserves revision inclusion when additional arguments exclude remotes", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "file.txt", "shared\n", "shared");
      await sb.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await sb.git(["update-ref", "refs/remotes/--remote/base", "HEAD"]);
      const first = await commit(sb, "file.txt", "first\n", "local first");
      const second = await commit(sb, "file.txt", "second\n", "local second");
      await sb.git(["update-ref", "refs/heads/--local", "HEAD"]);
      const client = createGitClient(sb.dir);

      for (const revision of ["HEAD", "--local", "--remote/base..HEAD"]) {
        for (const additionalArgs of [
          ["--not", "--remotes"],
          ["--not", "--remotes=origin"],
          ["--not", "--remotes=origin", "--not", "--tags"],
        ]) {
          const commits = await client.commits(revision, undefined, undefined, additionalArgs);
          expect(commits.map((c) => ({ sha: c.sha, summary: c.summary }))).toEqual([
            { sha: second, summary: "local second" },
            { sha: first, summary: "local first" },
          ]);
        }
        const paginated = await client.commits(revision, 1, 1, ["--grep=local", "--not", "--remotes=origin"]);
        expect(paginated.map((c) => c.sha)).toEqual([first]);
      }
    } finally {
      await sb.cleanup();
    }
  });
});

describe("localCommits()", () => {
  it("with an upstream, returns upstream..branch", async () => {
    const sb = await makeSandbox();
    try {
      await sb.addBareRemote();
      await commit(sb, "a.txt", "1\n", "pushed");
      await sb.git(["push", "-u", "origin", "main"]);
      await commit(sb, "a.txt", "2\n", "local one");
      await commit(sb, "a.txt", "3\n", "local two");
      const local = await createGitClient(sb.dir).localCommits({ name: "main", upstream: "origin/main" });
      expect(local.map((c) => c.summary)).toEqual(["local two", "local one"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("without an upstream, returns commits no remote has", async () => {
    const sb = await makeSandbox();
    try {
      await sb.addBareRemote();
      await commit(sb, "a.txt", "1\n", "pushed");
      await sb.git(["push", "origin", "main"]);
      await sb.git(["checkout", "-b", "topic"]);
      await commit(sb, "a.txt", "2\n", "unpublished");
      const local = await createGitClient(sb.dir).localCommits({ name: "topic", upstream: null });
      expect(local.map((c) => c.summary)).toEqual(["unpublished"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a null branch (detached or unborn) yields []", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "1\n", "only");
      expect(await createGitClient(sb.dir).localCommits(null)).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });
});
```

- [ ] **Step 9: Run to verify failure.** `bun test packages/git-core/src/__tests__/history-commits.test.ts` → FAIL (`client.commits` is not a function).

- [ ] **Step 10: Create `packages/git-core/src/history.ts`** with the two log readers (Task 3 adds the rest to this file):

```ts
import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import {
  createLogParser,
  extractCoAuthors,
  parseIdentity,
  parseRawUnfoldedTrailers,
} from "./vendor/ghd/log-parse.ts";
import type { Commit } from "./types.ts";

/** GHD's CommitBatchSize (app/src/lib/stores/git-store.ts). */
export const COMMIT_BATCH_SIZE = 100;

const MAX_MESSAGE_CHARS = 100 * 1024;

/** Port of GHD getCommits (app/src/lib/git/log.ts), argument for argument. */
export async function getCommits(
  ctx: ClientContext,
  revisionRange?: string,
  limit?: number,
  skip?: number,
  additionalArgs: ReadonlyArray<string> = [],
): Promise<Commit[]> {
  const { formatArgs, parse } = createLogParser({
    sha: "%H",
    shortSha: "%h",
    summary: "%s",
    body: "%b",
    author: "%an <%ae> %ad",
    committer: "%cn <%ce> %cd",
    parents: "%P",
    trailers: "%(trailers:unfold,only)",
    refs: "%D",
  });

  const args = ["log", "--date=raw"];
  if (limit !== undefined) args.push(`--max-count=${limit}`);
  if (skip !== undefined) args.push(`--skip=${skip}`);
  args.push(...formatArgs, "--no-show-signature", "--no-color", ...additionalArgs);

  // The explicit revision must not inherit an exclusion toggle left active by
  // additionalArgs such as --not --remotes.
  if (revisionRange !== undefined) {
    const isExcludingRevisions = additionalArgs.filter((arg) => arg === "--not").length % 2 === 1;
    if (isExcludingRevisions) args.push("--not");
    args.push("--end-of-options", revisionRange);
  }
  args.push("--");

  // Exit 128 is an unborn HEAD; its stdout is empty, which parses to [].
  const stdout = await rawGit(ctx.dir, args, { okCodes: [128] });

  return parse(stdout).map((commit) => {
    // %D is "HEAD -> main, tag: a, tag: b,c, origin/main": split on ", " so a
    // tag name containing a comma survives.
    const tags = commit.refs.split(", ").flatMap((ref) => (ref.startsWith("tag: ") ? [ref.substring(5)] : []));
    const trailers = parseRawUnfoldedTrailers(commit.trailers, ":");
    const author = parseIdentity(commit.author);
    const committer = parseIdentity(commit.committer);
    const parentSHAs = commit.parents.length > 0 ? commit.parents.split(" ") : [];
    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      summary: commit.summary.slice(0, MAX_MESSAGE_CHARS),
      body: commit.body.slice(0, MAX_MESSAGE_CHARS),
      author,
      committer,
      parentSHAs,
      trailers,
      tags,
      coAuthors: extractCoAuthors(trailers),
      authoredByCommitter: author.name === committer.name && author.email === committer.email,
      isMergeCommit: parentSHAs.length > 1,
    };
  });
}

/** Port of GHD GitStore.loadLocalCommits (app/src/lib/stores/git-store.ts). */
export async function getLocalCommits(
  ctx: ClientContext,
  branch: { name: string; upstream: string | null } | null,
  skip?: number,
): Promise<Commit[]> {
  if (branch === null) return [];
  if (branch.upstream) {
    return getCommits(ctx, `${branch.upstream}..${branch.name}`, COMMIT_BATCH_SIZE, skip);
  }
  return getCommits(ctx, "HEAD", COMMIT_BATCH_SIZE, skip, ["--not", "--remotes"]);
}
```

- [ ] **Step 11: Wire the client.** In `packages/git-core/src/client.ts` import `{ getCommits, getLocalCommits }` from `./history.ts` and add to the returned object:

```ts
    commits: (range, limit, skip, additionalArgs) => getCommits(ctx, range, limit, skip, additionalArgs),
    localCommits: (branch, skip) => getLocalCommits(ctx, branch, skip),
    changedFiles: () => Promise.reject(new Error("changedFiles: not implemented")),
    commitRangeChangedFiles: () => Promise.reject(new Error("commitRangeChangedFiles: not implemented")),
    commitDiff: () => Promise.reject(new Error("commitDiff: not implemented")),
    commitRangeDiff: () => Promise.reject(new Error("commitRangeDiff: not implemented")),
```

In `packages/git-core/src/index.ts` add `export { COMMIT_BATCH_SIZE } from "./history.ts";`.

In `lib/mission/__tests__/driver.test.ts`'s `makeFakeClient`, add the same six members returning empty results (`async () => []` for the two commit readers, `async () => ({ files: [], linesAdded: 0, linesDeleted: 0 })` for the changesets, `async (file) => ({ path: file.path, kind: "text", untracked: false, hunks: [] })` for the diffs). Task 6 replaces these with recording fakes.

- [ ] **Step 12: Run the git-core suite and typecheck.** `bun test packages/git-core` → PASS. `bunx tsc --noEmit` → clean.

- [ ] **Step 13: Commit**

```
git add packages/git-core lib/mission/__tests__/driver.test.ts
git commit -m "git-core: port GitHub Desktop's log parsers, commits() and localCommits()"
```

---

### Task 3: Changed files and commit diffs

**Files:**
- Modify: `packages/git-core/src/history.ts`, `packages/git-core/src/client.ts`
- Test: `packages/git-core/src/__tests__/history-changes.test.ts`

**Interfaces:**
- Consumes: Task 2's `parseRawLogWithNumstat`, `CommittedFileChange`, `StagingDiff`.
- Produces: `getChangedFiles`, `getCommitRangeChangedFiles`, `getCommitDiff`, `getCommitRangeDiff`, and the four `GitClient` methods wired for real. `commitDiff`/`commitRangeDiff` return `StagingDiff` with `untracked: false`; `kind` is `"text" | "binary" | "submodule"`.

- [ ] **Step 1: Write the failing tests.** Create `packages/git-core/src/__tests__/history-changes.test.ts` (ports of GHD `log-test.ts` getChangedFiles cases, plus the diff and range cases):

```ts
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSandbox } from "../../test-support/sandbox.ts";
import { createGitClient, AppFileStatusKind } from "../index.ts";

type Sb = Awaited<ReturnType<typeof makeSandbox>>;

async function commit(sb: Sb, file: string, content: string, message: string): Promise<string> {
  await sb.write(file, content);
  await sb.commitAll(message);
  return (await sb.git(["rev-parse", "HEAD"])).trim();
}

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("changedFiles()", () => {
  it("lists the root commit's files as new", async () => {
    const sb = await makeSandbox();
    try {
      const root = await commit(sb, "README.md", "hi\n", "first");
      const data = await createGitClient(sb.dir).changedFiles(root);
      expect(data.files.map((f) => f.path)).toEqual(["README.md"]);
      expect(data.files[0]!.status.kind).toBe(AppFileStatusKind.New);
      expect(data.linesAdded).toBe(1);
    } finally {
      await sb.cleanup();
    }
  });

  it("detects a pure rename and a rename with edits", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "OLD.md", TEN_LINES, "add");
      await sb.git(["mv", "OLD.md", "NEW.md"]);
      await sb.git(["commit", "-m", "pure rename"]);
      const pure = (await sb.git(["rev-parse", "HEAD"])).trim();
      await sb.git(["mv", "NEW.md", "NEWER.md"]);
      await sb.write("NEWER.md", TEN_LINES + "one more\n");
      await sb.commitAll("rename with edit");
      const edited = (await sb.git(["rev-parse", "HEAD"])).trim();
      const client = createGitClient(sb.dir);
      expect((await client.changedFiles(pure)).files[0]!.status).toEqual({
        kind: AppFileStatusKind.Renamed,
        oldPath: "OLD.md",
        submoduleStatus: undefined,
        renameIncludesModifications: false,
      });
      expect((await client.changedFiles(edited)).files[0]!.status).toEqual({
        kind: AppFileStatusKind.Renamed,
        oldPath: "NEW.md",
        submoduleStatus: undefined,
        renameIncludesModifications: true,
      });
    } finally {
      await sb.cleanup();
    }
  });

  it("detects a copy when the source also changed", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "initial.md", TEN_LINES, "add");
      await sb.git(["config", "diff.renames", "copies"]);
      await sb.write("duplicate.md", TEN_LINES);
      await sb.write("initial.md", TEN_LINES + "edit\n");
      await sb.commitAll("copy");
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      const dup = data.files.find((f) => f.path === "duplicate.md")!;
      expect(dup.status.kind).toBe(AppFileStatusKind.Copied);
    } finally {
      await sb.cleanup();
    }
  });

  it("a merge commit lists only what it changed relative to its first parent", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "base.txt", "b\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await commit(sb, "f.txt", "f\n", "feature");
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge"]);
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      expect(data.files.map((f) => f.path)).toEqual(["f.txt"]);
    } finally {
      await sb.cleanup();
    }
  });

  it("marks a submodule entry", async () => {
    const sub = await makeSandbox();
    const sb = await makeSandbox();
    try {
      await commit(sub, "s.txt", "s\n", "sub root");
      await commit(sb, "a.txt", "a\n", "root");
      await sb.git(["-c", "protocol.file.allow=always", "submodule", "add", sub.dir, "foo/submodule"]);
      await sb.git(["commit", "-m", "add submodule"]);
      const data = await createGitClient(sb.dir).changedFiles("HEAD");
      const entry = data.files.find((f) => f.path === "foo/submodule")!;
      expect(entry.status.submoduleStatus).toBeDefined();
    } finally {
      await sb.cleanup();
      await sub.cleanup();
    }
  });
});

describe("commitDiff()", () => {
  it("returns the commit's hunks for one file", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "one\ntwo\n", "add");
      const sha = await commit(sb, "a.txt", "one\nTWO\n", "edit");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles(sha)).files[0]!;
      const diff = await client.commitDiff(file, sha);
      expect(diff.kind).toBe("text");
      expect(diff.untracked).toBe(false);
      const text = diff.hunks.flatMap((h) => h.lines.map((l) => l.text));
      expect(text).toContain("-two");
      expect(text).toContain("+TWO");
    } finally {
      await sb.cleanup();
    }
  });

  it("follows a rename through its old path", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "OLD.md", TEN_LINES, "add");
      await sb.git(["mv", "OLD.md", "NEW.md"]);
      await sb.write("NEW.md", TEN_LINES + "tail\n");
      await sb.commitAll("rename");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+tail");
    } finally {
      await sb.cleanup();
    }
  });

  it("reports a binary file as binary with no hunks", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "img.bin", "a\0b\0c", "binary");
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.kind).toBe("binary");
      expect(diff.hunks).toEqual([]);
    } finally {
      await sb.cleanup();
    }
  });

  it("a merge commit's file diffs against the first parent", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "base.txt", "b\n", "base");
      await sb.git(["checkout", "-b", "feature"]);
      await commit(sb, "f.txt", "from feature\n", "feature");
      await sb.git(["checkout", "main"]);
      await commit(sb, "m.txt", "m\n", "main");
      await sb.git(["merge", "--no-ff", "feature", "-m", "merge"]);
      const client = createGitClient(sb.dir);
      const file = (await client.changedFiles("HEAD")).files[0]!;
      const diff = await client.commitDiff(file, "HEAD");
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+from feature");
    } finally {
      await sb.cleanup();
    }
  });
});

describe("range methods", () => {
  it("combine a contiguous range, oldest first", async () => {
    const sb = await makeSandbox();
    try {
      await commit(sb, "a.txt", "0\n", "root");
      const c2 = await commit(sb, "b.txt", "b\n", "two");
      const c3 = await commit(sb, "a.txt", "3\n", "three");
      const client = createGitClient(sb.dir);
      const data = await client.commitRangeChangedFiles([c2, c3]);
      expect(data.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
      const aFile = data.files.find((f) => f.path === "a.txt")!;
      const diff = await client.commitRangeDiff(aFile, [c2, c3]);
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+3");
    } finally {
      await sb.cleanup();
    }
  });

  it("retry against the null tree when the range starts at the root commit", async () => {
    const sb = await makeSandbox();
    try {
      const c1 = await commit(sb, "a.txt", "1\n", "root");
      const c2 = await commit(sb, "b.txt", "2\n", "two");
      const client = createGitClient(sb.dir);
      const data = await client.commitRangeChangedFiles([c1, c2]);
      expect(data.files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
      const aFile = data.files.find((f) => f.path === "a.txt")!;
      const diff = await client.commitRangeDiff(aFile, [c1, c2]);
      expect(diff.hunks.flatMap((h) => h.lines.map((l) => l.text))).toContain("+1");
    } finally {
      await sb.cleanup();
    }
  });
});
```

(`mkdtemp`, `rm`, `tmpdir`, `join` are imported only if the implementer needs a scratch directory; remove unused imports before committing.)

- [ ] **Step 2: Run to verify failure.** `bun test packages/git-core/src/__tests__/history-changes.test.ts` → FAIL (`changedFiles: not implemented`).

- [ ] **Step 3: Implement in `history.ts`.** Add imports (`AppFileStatusKind` from `./vendor/ghd/types.ts`, `DiffParser` from `./vendor/ghd/diff-parser.ts`, `classifyDiffText` from `./diff-classify.ts`, `parseRawLogWithNumstat` and `CommittedFileChange` from `./vendor/ghd/log-parse.ts`, `ChangesetData`/`StagingDiff` types) and:

```ts
/** git's empty tree object: the parent to diff a root commit against. */
const NULL_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function oldPathArgs(file: CommittedFileChange): string[] {
  return file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied
    ? [file.status.oldPath]
    : [];
}

function isBadRevision(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /bad revision|unknown revision/.test(message);
}

/** GHD buildDiff + diffFromRawDiffOutput: the patch is the last NUL-separated piece of --patch-with-raw -z output. */
function buildCommitDiff(stdout: string, file: CommittedFileChange): StagingDiff {
  if (file.status.submoduleStatus !== undefined) {
    return { path: file.path, kind: "submodule", untracked: false, hunks: [] };
  }
  const patch = stdout.split("\0").at(-1) ?? "";
  const kind = classifyDiffText(patch);
  if (kind !== "text") return { path: file.path, kind, untracked: false, hunks: [] };
  const hunks = patch.trim() === "" ? [] : new DiffParser().parse(patch).hunks;
  return { path: file.path, kind: "text", untracked: false, hunks };
}

/** Port of GHD getChangedFiles (app/src/lib/git/log.ts). */
export async function getChangedFiles(ctx: ClientContext, sha: string): Promise<ChangesetData> {
  const stdout = await rawGit(ctx.dir, [
    "log", sha, "-C", "-M", "-m", "-1", "--no-show-signature", "--first-parent",
    "--raw", "--format=format:", "--numstat", "-z", "--",
  ]);
  return parseRawLogWithNumstat(stdout, sha, `${sha}^`);
}

/** Port of GHD getCommitRangeChangedFiles (app/src/lib/git/diff.ts); shas oldest first. */
export async function getCommitRangeChangedFiles(
  ctx: ClientContext,
  shas: ReadonlyArray<string>,
  useNullTreeSHA = false,
): Promise<ChangesetData> {
  if (shas.length === 0) throw new Error("No commits to diff...");
  const oldestCommitRef = useNullTreeSHA ? NULL_TREE_SHA : `${shas[0]}^`;
  const latestCommitRef = shas.at(-1) ?? "";
  try {
    const stdout = await rawGit(ctx.dir, ["diff", oldestCommitRef, latestCommitRef, "-C", "-M", "-z", "--raw", "--numstat", "--"]);
    return parseRawLogWithNumstat(stdout, latestCommitRef, oldestCommitRef);
  } catch (err) {
    if (!useNullTreeSHA && isBadRevision(err)) return getCommitRangeChangedFiles(ctx, shas, true);
    throw err;
  }
}

/** Port of GHD getCommitDiff (app/src/lib/git/diff.ts). */
export async function getCommitDiff(ctx: ClientContext, file: CommittedFileChange, commitish: string): Promise<StagingDiff> {
  const stdout = await rawGit(ctx.dir, [
    "log", commitish, "-m", "-1", "--first-parent", "--patch-with-raw", "--format=", "-z", "--no-color",
    "--", file.path, ...oldPathArgs(file),
  ]);
  return buildCommitDiff(stdout, file);
}

/** Port of GHD getCommitRangeDiff (app/src/lib/git/diff.ts); commits oldest first. */
export async function getCommitRangeDiff(
  ctx: ClientContext,
  file: CommittedFileChange,
  commits: ReadonlyArray<string>,
  useNullTreeSHA = false,
): Promise<StagingDiff> {
  if (commits.length === 0) throw new Error("No commits to diff...");
  const oldestCommitRef = useNullTreeSHA ? NULL_TREE_SHA : `${commits[0]}^`;
  const latestCommit = commits.at(-1) ?? "";
  try {
    const stdout = await rawGit(ctx.dir, [
      "diff", oldestCommitRef, latestCommit, "--patch-with-raw", "--format=", "-z", "--no-color",
      "--", file.path, ...oldPathArgs(file),
    ]);
    return buildCommitDiff(stdout, file);
  } catch (err) {
    if (!useNullTreeSHA && isBadRevision(err)) return getCommitRangeDiff(ctx, file, commits, true);
    throw err;
  }
}
```

Replace the four rejecting stubs in `client.ts` with:

```ts
    changedFiles: (sha) => getChangedFiles(ctx, sha),
    commitRangeChangedFiles: (shas) => getCommitRangeChangedFiles(ctx, shas),
    commitDiff: (file, sha) => getCommitDiff(ctx, file, sha),
    commitRangeDiff: (file, shas) => getCommitRangeDiff(ctx, file, shas),
```

If the copy test fails because git's `-C` does not see the copy with this fixture, adjust the FIXTURE (for example make the source edit larger) until `git log HEAD -C -M --raw -1` in the sandbox shows a `C` status, never the assertion.

- [ ] **Step 4: Run.** `bun test packages/git-core` → PASS. `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```
git add packages/git-core
git commit -m "git-core: port GitHub Desktop's changed-files and commit diff readers"
```

---

### Task 4: `HistoryStore`, the ported store sequencing

**Files:**
- Create: `lib/mission/history.ts`
- Test: `lib/mission/__tests__/history.test.ts`

**Interfaces:**
- Consumes: `GitClient.commits/localCommits/changedFiles/commitRangeChangedFiles/commitDiff/commitRangeDiff`, `COMMIT_BATCH_SIZE`.
- Produces: `class HistoryStore` with public readonly-by-convention fields `commits: Commit[]`, `localShas: Set<string>`, `tip: string | null`, `loaded: boolean`, `hasMore: boolean`, `selection: string[]` (newest first), `changeset: ChangesetData | null`, `selectedFile: CommittedFileChange | null`, `diff: StagingDiff | null`; methods `syncTip(client, branch)`, `loadNextBatch(client, branch)`, `select(client, shas)`, `selectFile(client, path)`, `isContiguous()`, `orderedSelection()`, `showOversized(path)`, `isOversizedShown(path)`, `reset()`. `type HistoryBranch = { name: string; upstream: string | null } | null`.

- [ ] **Step 1: Write the failing tests.** Create `lib/mission/__tests__/history.test.ts`. The fake client records calls and can hold a promise open to exercise the stale guard:

```ts
import { describe, expect, test } from "bun:test";
import type { ChangesetData, Commit, CommittedFileChange, GitClient, StagingDiff } from "../../../packages/git-core/src/index.ts";
import { AppFileStatusKind } from "../../../packages/git-core/src/index.ts";
import { HistoryStore } from "../history.ts";

function fakeCommit(sha: string, summary = sha): Commit {
  const id = { name: "Pat", email: "pat@example.com", date: new Date("2026-09-20T00:00:00Z"), tzOffset: 0 };
  return { sha, shortSha: sha.slice(0, 7), summary, body: "", author: id, committer: id, parentSHAs: [], trailers: [], tags: [], coAuthors: [], authoredByCommitter: true, isMergeCommit: false };
}

function file(path: string, commitish = "x"): CommittedFileChange {
  return { path, status: { kind: AppFileStatusKind.Modified }, commitish, parentCommitish: `${commitish}^` };
}

function shas(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);
}

type HistoryClient = Pick<GitClient, "commits" | "localCommits" | "changedFiles" | "commitRangeChangedFiles" | "commitDiff" | "commitRangeDiff">;

function fakeClient(opts: { history: string[]; local?: string[]; files?: Record<string, string[]> }) {
  const calls = { commits: [] as Array<{ range?: string; limit?: number; skip?: number }>, local: [] as Array<number | undefined>, changed: [] as string[], range: [] as string[][], diff: [] as string[] };
  const byShas = (list: string[], limit = list.length, skip = 0) => list.slice(skip, skip + limit).map((s) => fakeCommit(s));
  const client: HistoryClient = {
    commits: async (range, limit, skip) => {
      calls.commits.push({ range, limit, skip });
      return byShas(opts.history, limit, skip);
    },
    localCommits: async (branch, skip) => {
      calls.local.push(skip);
      return branch ? byShas(opts.local ?? [], 100, skip ?? 0) : [];
    },
    changedFiles: async (sha) => {
      calls.changed.push(sha);
      return { files: (opts.files?.[sha] ?? ["a.ts"]).map((p) => file(p, sha)), linesAdded: 1, linesDeleted: 0 };
    },
    commitRangeChangedFiles: async (list) => {
      calls.range.push([...list]);
      return { files: [file("range.ts")], linesAdded: 2, linesDeleted: 1 };
    },
    commitDiff: async (f, sha) => {
      calls.diff.push(`${sha}:${f.path}`);
      return { path: f.path, kind: "text", untracked: false, hunks: [] };
    },
    commitRangeDiff: async (f, list) => {
      calls.diff.push(`${list.join("..")}:${f.path}`);
      return { path: f.path, kind: "text", untracked: false, hunks: [] };
    },
  };
  return { client: client as unknown as GitClient, calls };
}

const BRANCH = { name: "main", upstream: "origin/main" };

describe("HistoryStore", () => {
  test("first sync loads a batch, selects the first commit and its first file", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3), files: { c000: ["x.ts", "y.ts"] } });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.commits.map((c) => c.sha)).toEqual(["c000", "c001", "c002"]);
    expect(store.selection).toEqual(["c000"]);
    expect(store.selectedFile?.path).toBe("x.ts");
    expect(calls.diff).toEqual(["c000:x.ts"]);
    expect(store.hasMore).toBe(false);
  });

  test("an unchanged tip does not reload", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const before = calls.commits.filter((c) => c.limit === 100).length;
    expect(await store.syncTip(client, BRANCH)).toBe(false);
    expect(calls.commits.filter((c) => c.limit === 100).length).toBe(before);
  });

  test("a new tip reloads and keeps a selection that is still present", async () => {
    const history = shas("c", 3);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001"]);
    history.unshift("new");
    expect(await store.syncTip(client, BRANCH)).toBe(true);
    expect(store.commits[0]!.sha).toBe("new");
    expect(store.selection).toEqual(["c001"]);
  });

  test("a new tip that drops the selected commit selects the first", async () => {
    const history = shas("c", 3);
    const { client } = fakeClient({ history });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c002"]);
    history.splice(0, history.length, "z1", "z2");
    await store.syncTip(client, BRANCH);
    expect(store.selection).toEqual(["z1"]);
  });

  test("an unborn repo loads an empty history with nothing selected", async () => {
    const { client } = fakeClient({ history: [] });
    const store = new HistoryStore();
    await store.syncTip(client, null);
    expect(store.loaded).toBe(true);
    expect(store.commits).toEqual([]);
    expect(store.selection).toEqual([]);
    expect(store.changeset).toBeNull();
  });

  test("paging 250 commits requests each page once and never duplicates", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 250) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.hasMore).toBe(true);
    await store.loadNextBatch(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    expect(store.commits.length).toBe(250);
    expect(new Set(store.commits.map((c) => c.sha)).size).toBe(250);
    expect(store.hasMore).toBe(false);
    expect(calls.commits.filter((c) => c.skip === 100).length).toBe(1);
    expect(calls.commits.filter((c) => c.skip === 200).length).toBe(1);
  });

  test("paging pulls from local commits first while the last loaded commit is local", async () => {
    const history = shas("c", 150);
    const { client, calls } = fakeClient({ history, local: history.slice(0, 120) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.loadNextBatch(client, BRANCH);
    expect(calls.local).toContain(100);
    expect(store.commits.length).toBeGreaterThan(100);
    expect(new Set(store.commits.map((c) => c.sha)).size).toBe(store.commits.length);
  });

  test("a contiguous range loads the range changeset oldest first", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 4) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    await store.select(client, ["c001", "c002"]);
    expect(store.isContiguous()).toBe(true);
    expect(calls.range).toEqual([["c002", "c001"]]);
    expect(store.changeset?.files[0]!.path).toBe("range.ts");
  });

  test("a non-contiguous selection loads nothing", async () => {
    const { client, calls } = fakeClient({ history: shas("c", 4) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    const before = calls.changed.length;
    await store.select(client, ["c000", "c002"]);
    expect(store.isContiguous()).toBe(false);
    expect(store.changeset).toBeNull();
    expect(calls.changed.length).toBe(before);
  });

  test("a slow changeset for a superseded selection is dropped", async () => {
    const { client } = fakeClient({ history: shas("c", 3) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: ChangesetData) => void;
    const slow = new Promise<ChangesetData>((r) => { release = r; });
    const original = client.changedFiles;
    client.changedFiles = (sha) => (sha === "c001" ? slow : original(sha));
    const first = store.select(client, ["c001"]);
    await store.select(client, ["c002"]);
    release({ files: [file("stale.ts")], linesAdded: 0, linesDeleted: 0 });
    await first;
    expect(store.selection).toEqual(["c002"]);
    expect(store.changeset?.files[0]!.path).toBe("a.ts");
  });

  test("a slow diff for a superseded file is dropped", async () => {
    const { client } = fakeClient({ history: shas("c", 1), files: { c000: ["a.ts", "b.ts"] } });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    let release!: (v: StagingDiff) => void;
    const slow = new Promise<StagingDiff>((r) => { release = r; });
    const original = client.commitDiff;
    client.commitDiff = (f, sha) => (f.path === "a.ts" ? slow : original(f, sha));
    const first = store.selectFile(client, "a.ts");
    await store.selectFile(client, "b.ts");
    release({ path: "a.ts", kind: "text", untracked: false, hunks: [] });
    await first;
    expect(store.diff?.path).toBe("b.ts");
  });

  test("reset forgets everything so the next sync reloads", async () => {
    const { client } = fakeClient({ history: shas("c", 2) });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    store.reset();
    expect(store.loaded).toBe(false);
    expect(store.commits).toEqual([]);
    expect(await store.syncTip(client, BRANCH)).toBe(true);
  });

  test("the local set marks unpushed commits", async () => {
    const { client } = fakeClient({ history: shas("c", 3), local: ["c000"] });
    const store = new HistoryStore();
    await store.syncTip(client, BRANCH);
    expect(store.localShas.has("c000")).toBe(true);
    expect(store.localShas.has("c001")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test lib/mission/__tests__/history.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/mission/history.ts`:**

```ts
import {
  COMMIT_BATCH_SIZE,
  type ChangesetData,
  type Commit,
  type CommittedFileChange,
  type GitClient,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";

export type HistoryBranch = { name: string; upstream: string | null } | null;

/**
 * GitHub Desktop's history sequencing (app/src/lib/stores/app-store.ts:
 * the compare-state load, updateOrSelectFirstCommit, _loadNextCommitBatch,
 * _loadChangedFilesForCurrentSelection, _changeFileSelection) over one
 * worktree's client. Selection is newest first, in list order.
 */
export class HistoryStore {
  commits: Commit[] = [];
  localShas = new Set<string>();
  tip: string | null = null;
  loaded = false;
  hasMore = false;
  selection: string[] = [];
  changeset: ChangesetData | null = null;
  selectedFile: CommittedFileChange | null = null;
  diff: StagingDiff | null = null;
  private oversizedShown = new Set<string>();

  reset(): void {
    this.commits = [];
    this.localShas = new Set();
    this.tip = null;
    this.loaded = false;
    this.hasMore = false;
    this.selection = [];
    this.changeset = null;
    this.selectedFile = null;
    this.diff = null;
    this.oversizedShown = new Set();
  }

  /** Loads the first batch when nothing is loaded or HEAD moved; returns whether anything changed. */
  async syncTip(client: GitClient, branch: HistoryBranch): Promise<boolean> {
    const head = (await client.commits("HEAD", 1))[0]?.sha ?? null;
    if (this.loaded && head === this.tip) return false;
    const [batch, local] = await Promise.all([client.commits("HEAD", COMMIT_BATCH_SIZE, 0), client.localCommits(branch)]);
    this.commits = batch;
    this.localShas = new Set(local.map((c) => c.sha));
    this.tip = head;
    this.loaded = true;
    this.hasMore = batch.length === COMMIT_BATCH_SIZE;
    await this.updateOrSelectFirstCommit(client);
    return true;
  }

  private async updateOrSelectFirstCommit(client: GitClient): Promise<void> {
    const present = new Set(this.commits.map((c) => c.sha));
    if (this.selection.length > 0 && this.selection.every((sha) => present.has(sha))) return;
    const first = this.commits[0];
    await this.select(client, first ? [first.sha] : []);
  }

  async loadNextBatch(client: GitClient, branch: HistoryBranch): Promise<void> {
    if (!this.hasMore) return;
    let newCommits: Commit[] = [];
    const last = this.commits.at(-1);
    if (last && this.localShas.has(last.sha)) {
      const local = await client.localCommits(branch, this.commits.length);
      newCommits = local.filter((c) => !this.localShas.has(c.sha));
      for (const c of newCommits) this.localShas.add(c.sha);
    }
    if (newCommits.length === 0) {
      newCommits = await client.commits("HEAD", COMMIT_BATCH_SIZE, this.commits.length);
    }
    const known = new Set(this.commits.map((c) => c.sha));
    const fresh = newCommits.filter((c) => !known.has(c.sha));
    this.commits = [...this.commits, ...fresh];
    this.hasMore = fresh.length > 0;
  }

  isContiguous(): boolean {
    const idx = this.selection.map((sha) => this.commits.findIndex((c) => c.sha === sha)).sort((a, b) => a - b);
    if (idx.some((i) => i < 0)) return false;
    return idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  }

  /** The selection oldest first, as GHD's orderShasByHistory hands the range methods. */
  orderedSelection(): string[] {
    const index = new Map(this.commits.map((c, i) => [c.sha, i]));
    return [...this.selection].sort((a, b) => (index.get(b) ?? 0) - (index.get(a) ?? 0));
  }

  async select(client: GitClient, shas: string[]): Promise<void> {
    this.selection = [...shas];
    this.changeset = null;
    this.selectedFile = null;
    this.diff = null;
    if (shas.length === 0 || (shas.length > 1 && !this.isContiguous())) return;
    const key = shas.join(",");
    const data = shas.length > 1 ? await client.commitRangeChangedFiles(this.orderedSelection()) : await client.changedFiles(shas[0]!);
    if (this.selection.join(",") !== key) return;
    this.changeset = data;
    const first = data.files[0];
    if (first) await this.selectFile(client, first.path);
  }

  async selectFile(client: GitClient, path: string): Promise<void> {
    const file = this.changeset?.files.find((f) => f.path === path) ?? null;
    this.selectedFile = file;
    this.diff = null;
    if (!file) return;
    const key = this.selection.join(",");
    if (this.selection.length === 0 || (this.selection.length > 1 && !this.isContiguous())) return;
    const diff =
      this.selection.length > 1
        ? await client.commitRangeDiff(file, this.orderedSelection())
        : await client.commitDiff(file, this.selection[0]!);
    if (this.selection.join(",") !== key || this.selectedFile?.path !== path) return;
    this.diff = diff;
  }

  showOversized(path: string): void {
    this.oversizedShown.add(`${this.selection.join(",")}:${path}`);
  }

  isOversizedShown(path: string): boolean {
    return this.oversizedShown.has(`${this.selection.join(",")}:${path}`);
  }
}
```

- [ ] **Step 4: Run.** `bun test lib/mission/__tests__/history.test.ts` → PASS; `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```
git add lib/mission/history.ts lib/mission/__tests__/history.test.ts
git commit -m "mission: HistoryStore ports GitHub Desktop's history sequencing"
```

---

### Task 5: Wire types, history model builders, and golden fixtures

**Files:**
- Modify: `lib/ui/protocol.ts`, `lib/mission/model.ts`
- Create: `lib/mission/history-model.ts`
- Modify: `ui/internal/views/mission/model.go`, `ui/internal/views/mission/model_test.go`
- Modify: `ui/fixtures/session-model-mission.json`; Create: `ui/fixtures/session-model-mission-history.json`
- Test: `lib/mission/__tests__/history-model.test.ts`, `lib/mission/__tests__/model.test.ts`

**Interfaces:**
- Consumes: `HistoryStore` (Task 4), `Commit`, `AppFileStatusKind`.
- Produces (TS): `MissionHistoryCommitRow`, `MissionHistoryHeader`, `MissionHistoryFileRow`, `MissionHistoryModel`, `MissionModel.tab`, `MissionModel.history`, `MissionDiffModel.readOnly`; `commitAuthors(commit)`, `formatByline(authors)`, `formatExpandedAuthor(author)`, `buildHistoryModel(store, opts)`, `EMPTY_HISTORY_MODEL`; `buildModel` input gains `tab?`, `history?`, `historyDiff?`.
- Produces (Go): `HistoryCommitRow`, `HistoryHeader`, `HistoryFileRow`, `HistoryModel`; `Model.Tab`, `Model.History`, `DiffModel.ReadOnly`.

- [ ] **Step 1: Protocol types.** In `lib/ui/protocol.ts`, after `MissionDiffModel` add `readOnly` to it and define:

```ts
export interface MissionDiffModel {
  path: string;
  status: string;
  kind: "text" | "binary" | "oversized" | "none";
  stats: string;
  /** Chroma lexer hint, e.g. "typescript"; "" = plain. */
  lang: string;
  lines: MissionDiffLine[];
  /** A committed diff (History): no stage gutter, nothing toggles. */
  readOnly: boolean;
}

export interface MissionHistoryCommitRow {
  sha: string;
  shortSha: string;
  summary: string;
  /** GHD's commit-attribution: "A", "A, B", or "N people". */
  byline: string;
  /** Driver-computed relative author date. */
  when: string;
  tags: string[];
  unpushed: boolean;
  /** The driver's selection; the view adopts it when its own cursor falls off the list. */
  selected: boolean;
}

export interface MissionHistoryHeader {
  summary: string;
  body: string;
  byline: string;
  /** Expanded author list, "Name <email>" (GHD renderExpandedAuthor). */
  authors: string[];
  sha: string;
  shortSha: string;
  linesAdded: number;
  linesDeleted: number;
  tags: string[];
  /** Selected commit count; above 1 the header reads "Showing changes from N commits". */
  rangeCount: number;
  contiguous: boolean;
}

export interface MissionHistoryFileRow {
  path: string;
  origPath: string;
  status: MissionChangeRow["status"];
}

export interface MissionHistoryModel {
  commits: MissionHistoryCommitRow[];
  hasMore: boolean;
  loading: boolean;
  header: MissionHistoryHeader | null;
  files: MissionHistoryFileRow[];
  selectedFile: string;
}
```

Add to `MissionModel`: `tab: "changes" | "history";` and `history: MissionHistoryModel;`. Add `"mission:tab"`, `"mission:history-select"`, `"mission:history-file"`, `"mission:history-more"` to `SESSION_INTENT_NAMES`. Re-export the new types from `lib/mission/model.ts`'s `export type { ... }` block.

- [ ] **Step 2: Write the failing history-model tests.** Create `lib/mission/__tests__/history-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { Commit } from "../../../packages/git-core/src/index.ts";
import { AppFileStatusKind } from "../../../packages/git-core/src/index.ts";
import { HistoryStore } from "../history.ts";
import { buildHistoryModel, commitAuthors, formatByline, formatExpandedAuthor } from "../history-model.ts";

const NOW = new Date("2026-09-22T12:00:00Z");

function ident(name: string, email: string) {
  return { name, email, date: new Date("2026-09-22T09:00:00Z"), tzOffset: 0 };
}

function commit(over: Partial<Commit> = {}): Commit {
  const author = ident("Pat", "pat@example.com");
  return { sha: "a".repeat(40), shortSha: "aaaaaaa", summary: "fix it", body: "", author, committer: author, parentSHAs: [], trailers: [], tags: [], coAuthors: [], authoredByCommitter: true, isMergeCommit: false, ...over };
}

describe("commitAuthors (GHD getAvatarUsersForCommit without avatars)", () => {
  test("author alone when the committer is the author", () => {
    expect(commitAuthors(commit())).toEqual([{ name: "Pat", email: "pat@example.com" }]);
  });
  test("co-authors follow the author; a distinct committer comes last", () => {
    const c = commit({ coAuthors: [{ name: "Sam", email: "sam@example.com" }], committer: ident("Lee", "lee@example.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat", "Sam", "Lee"]);
  });
  test("the web-flow committer is never listed", () => {
    const c = commit({ committer: ident("GitHub", "noreply@github.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat"]);
  });
  test("a committer who is also a co-author is not repeated", () => {
    const c = commit({ coAuthors: [{ name: "Lee", email: "lee@example.com" }], committer: ident("Lee", "lee@example.com"), authoredByCommitter: false });
    expect(commitAuthors(c).map((a) => a.name)).toEqual(["Pat", "Lee"]);
  });
});

describe("formatByline and formatExpandedAuthor (GHD commit-attribution)", () => {
  test("one, two, and many", () => {
    expect(formatByline([{ name: "A", email: "a@x" }])).toBe("A");
    expect(formatByline([{ name: "A", email: "a@x" }, { name: "B", email: "b@x" }])).toBe("A, B");
    expect(formatByline([{ name: "A", email: "a@x" }, { name: "B", email: "b@x" }, { name: "C", email: "c@x" }])).toBe("3 people");
  });
  test("expanded form falls back to the email when there is no name", () => {
    expect(formatExpandedAuthor({ name: "A", email: "a@x" })).toBe("A <a@x>");
    expect(formatExpandedAuthor({ name: "", email: "a@x" })).toBe("a@x");
  });
});

describe("buildHistoryModel", () => {
  test("rows carry byline, relative time, tags, unpushed, selected", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1", shortSha: "s1", tags: ["v1"] }), commit({ sha: "s2", shortSha: "s2", summary: "" })];
    store.localShas = new Set(["s1"]);
    store.selection = ["s1"];
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.commits[0]).toEqual({ sha: "s1", shortSha: "s1", summary: "fix it", byline: "Pat", when: "3 hours ago", tags: ["v1"], unpushed: true, selected: true });
    expect(model.commits[1]!.unpushed).toBe(false);
    expect(model.commits[1]!.summary).toBe("");
  });

  test("a single selection's header", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1", shortSha: "s1", body: "why\n", tags: ["v1"] })];
    store.selection = ["s1"];
    store.changeset = {
      files: [{ path: "n.ts", status: { kind: AppFileStatusKind.Renamed, oldPath: "o.ts", renameIncludesModifications: true }, commitish: "s1", parentCommitish: "s1^" }],
      linesAdded: 5,
      linesDeleted: 2,
    };
    store.selectedFile = store.changeset.files[0]!;
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.header).toEqual({ summary: "fix it", body: "why", byline: "Pat", authors: ["Pat <pat@example.com>"], sha: "s1", shortSha: "s1", linesAdded: 5, linesDeleted: 2, tags: ["v1"], rangeCount: 1, contiguous: true });
    expect(model.files).toEqual([{ path: "n.ts", origPath: "o.ts", status: "renamed" }]);
    expect(model.selectedFile).toBe("n.ts");
  });

  test("a range header counts commits and unions authors", () => {
    const store = new HistoryStore();
    store.commits = [commit({ sha: "s1" }), commit({ sha: "s2", author: ident("Sam", "sam@example.com"), committer: ident("Sam", "sam@example.com") })];
    store.selection = ["s1", "s2"];
    const model = buildHistoryModel(store, { now: NOW, loading: false });
    expect(model.header?.rangeCount).toBe(2);
    expect(model.header?.contiguous).toBe(true);
    expect(model.header?.byline).toBe("Pat, Sam");
  });

  test("nothing selected means no header", () => {
    const model = buildHistoryModel(new HistoryStore(), { now: NOW, loading: true });
    expect(model.header).toBeNull();
    expect(model.loading).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure.** `bun test lib/mission/__tests__/history-model.test.ts` → FAIL.

- [ ] **Step 4: Implement `lib/mission/history-model.ts`:**

```ts
import { AppFileStatusKind, type Commit, type CommittedFileChange, type GitAuthor } from "../../packages/git-core/src/index.ts";
import { formatRelativeTime } from "../relative-time.ts";
import type { MissionChangeRow, MissionHistoryFileRow, MissionHistoryHeader, MissionHistoryModel } from "../ui/protocol.ts";
import type { HistoryStore } from "./history.ts";

export const EMPTY_HISTORY_MODEL: MissionHistoryModel = { commits: [], hasMore: false, loading: false, header: null, files: [], selectedFile: "" };

/** GHD's web-flow committer on github.com (app/src/lib/web-flow-committer.ts). */
function isWebFlowCommitter(commit: Commit): boolean {
  return commit.committer.name === "GitHub" && commit.committer.email === "noreply@github.com";
}

/** GHD getAvatarUsersForCommit (app/src/models/avatar.ts) without the avatars. */
export function commitAuthors(commit: Commit): GitAuthor[] {
  const users: GitAuthor[] = [{ name: commit.author.name, email: commit.author.email }, ...commit.coAuthors];
  const coAuthoredByCommitter = commit.coAuthors.some((a) => a.name === commit.committer.name && a.email === commit.committer.email);
  if (!commit.authoredByCommitter && !isWebFlowCommitter(commit) && !coAuthoredByCommitter) {
    users.push({ name: commit.committer.name, email: commit.committer.email });
  }
  const byIdentity = new Map(users.map((u) => [u.name + u.email, u]));
  return [...byIdentity.values()];
}

/** GHD CommitAttribution.renderAuthors (app/src/ui/lib/commit-attribution.tsx). */
export function formatByline(authors: GitAuthor[]): string {
  if (authors.length === 1) return authors[0]!.name;
  if (authors.length === 2) return `${authors[0]!.name}, ${authors[1]!.name}`;
  return `${authors.length} people`;
}

/** GHD renderExpandedAuthor (app/src/ui/history/expandable-commit-summary.tsx). */
export function formatExpandedAuthor(author: GitAuthor): string {
  return author.name ? `${author.name} <${author.email}>` : author.email;
}

function toWireStatus(file: CommittedFileChange): MissionChangeRow["status"] {
  switch (file.status.kind) {
    case AppFileStatusKind.New:
    case AppFileStatusKind.Untracked:
      return "new";
    case AppFileStatusKind.Deleted:
      return "deleted";
    case AppFileStatusKind.Renamed:
      return "renamed";
    case AppFileStatusKind.Copied:
      return "copied";
    default:
      return "modified";
  }
}

function fileRow(file: CommittedFileChange): MissionHistoryFileRow {
  const origPath = file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied ? file.status.oldPath : "";
  return { path: file.path, origPath, status: toWireStatus(file) };
}

function buildHeader(store: HistoryStore): MissionHistoryHeader | null {
  const selected = store.selection.map((sha) => store.commits.find((c) => c.sha === sha)).filter((c): c is Commit => c !== undefined);
  const first = selected[0];
  if (!first) return null;
  const authors = [...new Map(selected.flatMap(commitAuthors).map((a) => [a.email + a.name, a])).values()];
  return {
    summary: first.summary,
    body: first.body.trim(),
    byline: formatByline(authors),
    authors: authors.map(formatExpandedAuthor),
    sha: first.sha,
    shortSha: first.shortSha,
    linesAdded: store.changeset?.linesAdded ?? 0,
    linesDeleted: store.changeset?.linesDeleted ?? 0,
    tags: first.tags,
    rangeCount: selected.length,
    contiguous: store.isContiguous(),
  };
}

export function buildHistoryModel(store: HistoryStore, opts: { now: Date; loading: boolean }): MissionHistoryModel {
  const selected = new Set(store.selection);
  return {
    commits: store.commits.map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      summary: c.summary,
      byline: formatByline(commitAuthors(c)),
      when: formatRelativeTime(c.author.date.toISOString(), opts.now),
      tags: c.tags,
      unpushed: store.localShas.has(c.sha),
      selected: selected.has(c.sha),
    })),
    hasMore: store.hasMore,
    loading: opts.loading,
    header: buildHeader(store),
    files: (store.changeset?.files ?? []).map(fileRow),
    selectedFile: store.selectedFile?.path ?? "",
  };
}
```

If `formatRelativeTime` renders "3 hours ago" differently, change the test's expected string to what the function returns for a 3-hour gap (read `lib/relative-time.ts`), not the function.

- [ ] **Step 5: `buildModel` gains the tab.** In `lib/mission/model.ts`:
  - `buildDiffModel`'s input gains `readOnly: boolean`. Every return path sets `readOnly`. When `readOnly` is true, every add/del line is emitted with `selected: false, selIdx: -1`.
  - `buildModel`'s input gains `tab?: "changes" | "history"`, `history?: MissionHistoryModel`, and `historyDiff?: { path: string | null; status: string; diff: StagingDiff | null; oversizedOverride: boolean }`.
  - `const tab = input.tab ?? "changes";`. When `tab === "history"`, `diff = buildDiffModel({ path: historyDiff?.path ?? null, status: historyDiff?.status ?? "", stagingDiff: historyDiff?.diff ?? null, selection: DiffSelection.fromInitialSelection(DiffSelectionType.None), oversizedOverride: historyDiff?.oversizedOverride ?? false, readOnly: true })`; otherwise the existing call with `readOnly: false`.
  - The returned object gains `tab` and `history: input.history ?? EMPTY_HISTORY_MODEL`.

- [ ] **Step 6: Update the Changes golden fixture.** In `ui/fixtures/session-model-mission.json`, add `"readOnly": false` to `diff`, and `"tab": "changes"` plus `"history": {"commits": [], "hasMore": false, "loading": false, "header": null, "files": [], "selectedFile": ""}` to `model`. Run `bun test lib/mission/__tests__/model.test.ts` → PASS.

- [ ] **Step 7: Add the History golden fixture.** Append to `lib/mission/__tests__/model.test.ts` a test that builds a `HistoryStore` by hand (two commits, the first selected, a one-file changeset, a two-line diff) and `buildModel({ ..., tab: "history", history: buildHistoryModel(store, { now: NOW, loading: false }), historyDiff: { path: "src/parser.ts", status: "modified", diff, oversizedOverride: false } })`, then asserts `toEqual` against `readFixture("session-model-mission-history.json").model`. Generate the fixture once from the builder output (write `JSON.stringify({ t: "model", model }, null, 2)` to the fixture path in a scratch run), then review it by eye: `tab` is `history`, `diff.readOnly` is true, every line has `selected: false` and `selIdx: -1`.

- [ ] **Step 8: Go mirror.** In `ui/internal/views/mission/model.go`:

```go
type HistoryCommitRow struct {
	Sha      string   `json:"sha"`
	ShortSha string   `json:"shortSha"`
	Summary  string   `json:"summary"`
	Byline   string   `json:"byline"`
	When     string   `json:"when"`
	Tags     []string `json:"tags"`
	Unpushed bool     `json:"unpushed"`
	Selected bool     `json:"selected"`
}

type HistoryHeader struct {
	Summary      string   `json:"summary"`
	Body         string   `json:"body"`
	Byline       string   `json:"byline"`
	Authors      []string `json:"authors"`
	Sha          string   `json:"sha"`
	ShortSha     string   `json:"shortSha"`
	LinesAdded   int      `json:"linesAdded"`
	LinesDeleted int      `json:"linesDeleted"`
	Tags         []string `json:"tags"`
	RangeCount   int      `json:"rangeCount"`
	Contiguous   bool     `json:"contiguous"`
}

type HistoryFileRow struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Status   string `json:"status"`
}

type HistoryModel struct {
	Commits      []HistoryCommitRow `json:"commits"`
	HasMore      bool               `json:"hasMore"`
	Loading      bool               `json:"loading"`
	Header       *HistoryHeader     `json:"header"`
	Files        []HistoryFileRow   `json:"files"`
	SelectedFile string             `json:"selectedFile"`
}
```

Add `ReadOnly bool \`json:"readOnly"\`` to `DiffModel`, and `Tab string \`json:"tab"\`` plus `History HistoryModel \`json:"history"\`` to `Model`. In `model_test.go` add `TestDecodeHistoryFixture`: decode `session-model-mission-history.json` and assert `Tab == "history"`, `len(History.Commits) == 2`, `History.Header != nil`, `Diff.ReadOnly`.

- [ ] **Step 9: Run everything touched.** `bun test lib/mission` → PASS; `bunx tsc --noEmit` → clean; from `ui/`: `go test ./internal/views/mission/ ./internal/protocol/` → PASS.

- [ ] **Step 10: Commit**

```
git add lib/ui/protocol.ts lib/mission ui/internal/views/mission/model.go ui/internal/views/mission/model_test.go ui/fixtures
git commit -m "mission: History wire model, builders, and golden fixtures"
```

---

### Task 6: Driver wiring

**Files:**
- Modify: `lib/mission/driver.ts`
- Test: `lib/mission/__tests__/driver.test.ts`

**Interfaces:**
- Consumes: `HistoryStore` (Task 4), `buildHistoryModel`/`EMPTY_HISTORY_MODEL` (Task 5), `buildModel`'s `tab`/`history`/`historyDiff`.
- Produces: intents `mission:tab` `{ tab: "changes" | "history" }`, `mission:history-select` `{ shas: string[] }`, `mission:history-file` `{ path: string; showOversized?: boolean }`, `mission:history-more` (no payload).

- [ ] **Step 1: Recording fakes.** In `driver.test.ts`, extend `makeFakeClient`'s overrides and `FakeClientCalls` with `commits`, `localCommits`, `changedFiles`, `commitDiff` (record each call's arguments). Default `commits` returns two commits `h1`, `h2` (build them with a local `fakeCommit` helper like Task 4's) for `limit` 100 and `[h1]` for `limit` 1; default `changedFiles` returns one file `src/a.ts`; default `commitDiff` returns a one-hunk text diff for the file's path.

- [ ] **Step 2: Write the failing driver tests** in a new `describe("MissionDriver: History tab", ...)` block. Each drives intents through `FakeSession` like the existing tests (`session.send(...)`, `await flushMicrotasks()`, read `session.pushed.at(-1)`). Cases:

  1. **Changes-only sessions never read history:** open, quit; `calls.commits` is empty.
  2. **Opening the tab loads lazily:** send `{ t: "intent", name: "mission:tab", payload: { tab: "history" } }`; some pushed model has `tab: "history"` and `history.loading: true`; the last has `history.commits.map(c => c.sha)` equal to `["h1", "h2"]`, `history.header.sha` `"h1"`, `diff.readOnly` true, `diff.path` `"src/a.ts"`.
  3. **Selecting a commit loads its files:** after opening the tab, send `mission:history-select` `{ shas: ["h2"] }`; `calls.changedFiles` ends with `"h2"`; the last model's `history.header.sha` is `"h2"`.
  4. **Selecting a file loads its diff:** send `mission:history-file` `{ path: "src/a.ts" }`; `calls.commitDiff` records it.
  5. **Paging:** make the fake return exactly 100 commits for skip 0 and 5 for skip 100; send `mission:history-more`; the last model has 105 commits.
  6. **Tab state is kept:** open History, select `h2`, switch back with `mission:tab` `{ tab: "changes" }`; the model's `diff.readOnly` is false and `diff.path` is the Changes selection; switch to History again; the header sha is still `"h2"` and `calls.commits` shows no second batch load (limit 100) because the tip did not move.
  7. **A new tip while on History reloads and keeps the selection** (Review Focus 4): open History, select `h2`; change the fake so `commits("HEAD", 1)` returns a new `h0` and the batch is `[h0, h1, h2]`; fire a `git-status` event through the `subscribe` fake; after flushing, the last model's first row is `h0` and the header sha is still `"h2"`.
  8. **A worktree switch resets history:** open History; send `mission:worktree` `{ path: "/other" }` (whatever the existing worktree-switch tests use); the next History open loads a first batch again.
  9. **Oversized show-anyway:** with a diff over the cutoff, `diff.kind` is `"oversized"`; send `mission:history-file` `{ path, showOversized: true }`; the next model's `diff.kind` is `"text"`.

- [ ] **Step 3: Run to verify failure.** `bun test lib/mission/__tests__/driver.test.ts -t "History tab"` → FAIL.

- [ ] **Step 4: Implement in `driver.ts`:**
  - Import `HistoryStore` and `type HistoryBranch` from `./history.ts`, `buildHistoryModel` from `./history-model.ts`.
  - Payload interfaces: `TabPayload { tab: "changes" | "history" }`, `HistorySelectPayload { shas: string[] }`, `HistoryFilePayload { path: string; showOversized?: boolean }`.
  - `DriverState` gains `tab: "changes" | "history"` (initialized `"changes"`).
  - Fields: `private readonly history = new HistoryStore();` and `private historyLoading = false;`.
  - `private historyBranch(): HistoryBranch { return this.snapshot.branch ? { name: this.snapshot.branch, upstream: this.snapshot.upstream } : null; }`
  - `private async syncHistory(): Promise<void>`: return unless `this.state.tab === "history"`; `this.history.syncTip(this.deps.client(this.state.currentWorktree), this.historyBranch())`.
  - Call `await this.syncHistory()` at the end of `refresh()`, at the end of `refreshBadges()` (after its stale-worktree guard, so a switched worktree never syncs the old one), and at the end of `refreshSnapshotAndDiff()`.
  - `setCurrentWorktree(path, settling)` also calls `this.history.reset()`.
  - `model()` passes `tab: this.state.tab`, `history: buildHistoryModel(this.history, { now: this.deps.now(), loading: this.historyLoading })`, and `historyDiff: { path: this.history.selectedFile?.path ?? null, status: <wire status of the selected file, from the built history model's files row>, diff: this.history.diff, oversizedOverride: this.history.selectedFile ? this.history.isOversizedShown(this.history.selectedFile.path) : false }`.
  - `handle()` gains four cases:

```ts
      case "mission:tab":
        await this.handleTab(intent.payload as TabPayload | undefined);
        break;
      case "mission:history-select": {
        const payload = intent.payload as HistorySelectPayload | undefined;
        if (!Array.isArray(payload?.shas)) break;
        await this.history.select(this.deps.client(this.state.currentWorktree), payload.shas);
        this.push();
        break;
      }
      case "mission:history-file": {
        const payload = intent.payload as HistoryFilePayload | undefined;
        if (typeof payload?.path !== "string") break;
        if (payload.showOversized === true) this.history.showOversized(payload.path);
        else await this.history.selectFile(this.deps.client(this.state.currentWorktree), payload.path);
        this.push();
        break;
      }
      case "mission:history-more":
        await this.history.loadNextBatch(this.deps.client(this.state.currentWorktree), this.historyBranch());
        this.push();
        break;
```

```ts
  private async handleTab(payload: TabPayload | undefined): Promise<void> {
    if (payload?.tab !== "changes" && payload?.tab !== "history") return;
    this.state.tab = payload.tab;
    if (payload.tab === "history") {
      this.historyLoading = !this.history.loaded;
      this.push();
      try {
        await this.syncHistory();
      } finally {
        this.historyLoading = false;
      }
    }
    this.push();
  }
```

- [ ] **Step 5: Run.** `bun test lib/mission` → PASS; `bunx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```
git add lib/mission/driver.ts lib/mission/__tests__/driver.test.ts
git commit -m "mission: driver owns the History tab, its intents, and tip sync"
```

---

### Task 7: Go view, part 1: tab strip, History sidebar, keys, paging

**Gate:** Matt has signed off `History.png` (Task 1, Step 6). The board is the visual contract; where this task's code and the board disagree on a color role or spacing, the board wins.

**Files:**
- Create: `ui/internal/views/mission/history.go`
- Modify: `ui/internal/views/mission/mission.go`, `ui/internal/views/mission/changes.go`
- Test: `ui/internal/views/mission/history_test.go` (package `mission`), `ui/internal/views/mission/mission_test.go` (package `mission_test`, session-driven), existing tests in `render_test.go` that pin the old tab strip

**Interfaces:**
- Consumes: Go `Model.Tab`, `Model.History` (Task 5); intents from Task 6.
- Produces (for Task 8): `focusHistoryFiles` focus kind; Mission fields `historyCursor`, `historyAnchor`, `historyTop`, `historyGen`, `historyMoreFor`, `hoverCommit`, `hoverTab`, `historyFile`, `historyFilesTop`, `hoverHistoryFile`, `historyExpanded`, `hoverExpander`; `historyDebounceMsg{generation int; kind historyDebounceKind}`; `hitTab`, `hitCommitRow` hit kinds; `(m *Mission) historyTab() bool`.

- [ ] **Step 1: Write the failing render/Update tests** in a new `ui/internal/views/mission/history_test.go` (package `mission`, reusing `instantSelectTick`, `bgSGR`, `fgSGR` from the existing test files):

```go
package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func historyFixtureModel() Model {
	return Model{
		Tab:     "history",
		Current: Current{Repo: "repo-tools", Branch: "main"},
		History: HistoryModel{
			Commits: []HistoryCommitRow{
				{Sha: "s1", ShortSha: "s1", Summary: "Fix pty paint predicate", Byline: "Matt", When: "3 hours ago", Unpushed: true, Selected: true},
				{Sha: "s2", ShortSha: "s2", Summary: "Guard badges", Byline: "Matt", When: "5 hours ago", Tags: []string{"v0.9.1"}},
				{Sha: "s3", ShortSha: "s3", Summary: "", Byline: "Matt, Claude", When: "1 day ago"},
			},
			Header: &HistoryHeader{Summary: "Fix pty paint predicate", Byline: "Matt", Authors: []string{"Matt <m@x>"}, Sha: "s1full", ShortSha: "s1", LinesAdded: 12, LinesDeleted: 4, RangeCount: 1, Contiguous: true},
			Files:  []HistoryFileRow{{Path: "lib/mission/model.ts", Status: "modified"}},
			SelectedFile: "lib/mission/model.ts",
		},
		Diff: DiffModel{Path: "lib/mission/model.ts", Kind: "text", ReadOnly: true, Lines: []DiffLine{{Kind: "add", Text: "x", NewNo: 1, SelIdx: -1}}},
	}
}

func newHistoryTestMission() *Mission {
	m := New(nil)
	m.width, m.height = 130, 38
	_ = m.setModelValue(historyFixtureModel())
	return m
}
```

`setModelValue` is a small test seam added in Step 3 (marshal the Model and call `SetModel`), so the cursor clamps run exactly as they do for a real push.

Tests to write in this file (each a `func TestX(t *testing.T)`):

  1. `TestTabStripMarksHistoryActive`: `ansi.Strip(renderTabsRow(3, "history", false, sidebarWidth))` contains "Changes" and "History", no " v2"; the underline row's Pink run (`fgSGR(theme.Pink)`) is on the History half.
  2. `TestTabHoverOnlyOnInactiveHalf`: with `renderTabsRow(3, "history", true, sidebarWidth)`, the HoverBg (`bgSGR(theme.HoverBg)`) appears on the Changes half of the pad and label rows and never on the underline row.
  3. `TestHistorySidebarPaintsTwoLineRows`: `m.View().Content` (stripped) contains "Fix pty paint predicate", "Matt · 3 hours ago", "Guard badges", "v0.9.1", "Empty commit message", and "↑".
  4. `TestCommitRowNeverWraps` (Review Focus 1): for summaries `strings.Repeat("x", 300)`, "修正する修正する修正する修正する修正する修正する", and "", `renderCommitRow` returns two strings each with `lipgloss.Width == sidebarWidth-1` and no "\n".
  5. `TestDownMovesHistoryCursorAndDebouncesSelect`: `instantSelectTick(t)`; `m.Update(downKey())` moves `historyCursor` to "s2" and its cmd resolves to a `historyDebounceMsg`; feeding that back emits (cmd non-nil).
  6. `TestShiftDownExtendsRange`: `m.Update(tea.KeyPressMsg{Code: tea.KeyDown, Mod: tea.ModShift})` leaves `historyAnchor == "s1"`, `historyCursor == "s2"`, and `m.historySelectionShas()` returns `["s1","s2"]`; a plain down afterwards clears the anchor.
  7. `TestRangeRowsPaintSelBg`: after the shift+down, both commit rows' first lines carry `bgSGR(theme.SelBg)`.
  8. `TestPagingRequestsMoreOncePerPage` (Review Focus 3): a model with 30 commits and `HasMore: true`; move the cursor to index 25; the returned cmd batch includes a `mission:history-more` emission (assert by `m.historyMoreFor == 30`); moving again does not re-request (`historyMoreFor` unchanged and no second request); a new model with 40 commits allows the next request.
  9. `TestSetModelAdoptsDriverSelectionWhenCursorFallsOff`: set `historyCursor = "gone"`, push a model whose second row is `Selected`; the cursor becomes that row's sha and the anchor clears.
  10. `TestHitTestResolvesCommitRowsAndTab`: `findHitY(m, 2, hitCommitRow)` finds the first commit row at `layout().topH + historyFixedTopRows`; the row below it (the byline line) resolves to the same index; `m.hitTest(1, m.layout().topH+1)` is `hitTab` (the inactive Changes half).
  11. `TestMouseMotionSetsHoverCommitAndClears`: motion over row 1 sets `hoverCommit == 1`; motion over the divider clears it.
  12. `TestKeybarPerTab`: `ansi.Strip(renderKeybar(130, "history"))` contains "1 changes" and "⇧↑↓ range" and not "space stage"; `renderKeybar(130, "changes")` contains "2 history".

Update the existing `render_test.go` tests that pinned the old strip: calls become `renderTabsRow(3, "changes", <bool>, width)`, `hitTabHistory` becomes `hitTab`, `hoverTabHistory` becomes `hoverTab`, and the `renderKeybar(n)` calls gain `"changes"`. Delete `mission_test.go`'s "History lands in v2" wait and replace that test (Step 2).

- [ ] **Step 2: Write the failing session-driven tests** in `mission_test.go` (package `mission_test`, real binary, `openMission`/`sgrClick` helpers already there). Add a `historyModel` JSON const mirroring `historyFixtureModel()` (keys as in the wire), and:

  1. `TestPressTwoEmitsTabHistory`: `openMission(t, canCommitModel, "Commit 1 file to main")`; `s.Type("2")`; the next line contains `"name":"mission:tab"` and `"tab":"history"`.
  2. `TestHistoryDownEmitsDebouncedSelect`: open with `historyModel`, wait for "Fix pty paint predicate"; `s.Type("\x1b[B")`; within 2s a line contains `"name":"mission:history-select"` and `"shas":["s2"]`.
  3. `TestHistoryShiftDownEmitsRange`: `s.Type("\x1b[1;2B")` (shift+down); the line contains `"shas":["s1","s2"]`.
  4. `TestHistoryClickCommitRowEmitsImmediately`: click the second commit row (x=2, y = topH(4) + 4 + 2); the line contains `"shas":["s2"]`.
  5. `TestHistoryShiftClickEmitsRange`: `s.Type(sgrClick(4, 2, <second row y>))` (button 0 with the shift bit 4); the line contains `"shas":["s1","s2"]`.
  6. `TestHistoryPressOneEmitsTabChanges`: `s.Type("1")`; the line contains `"tab":"changes"`.

- [ ] **Step 3: Run to verify failure.** From `ui/`: `go test ./internal/views/mission/ -run 'Tab|History|CommitRow|Keybar'` → FAIL (compile errors on the missing names count as failing).

- [ ] **Step 4: Tab strip and keybar in `changes.go`.**

```go
// renderTabsRow paints the three-row tab strip per Main.png/History.png: a
// blank pad row, the Changes/History label row, and the underline row. Each
// tab owns HALF the width; the underline is Pink under the active half and
// Rule under the other. The pad and label rows of the INACTIVE half are its
// button (sidebarHit/historySidebarHit resolve exactly those cells to
// hitTab), so hoverInactive paints HoverBg there and nowhere else: the
// active tab is inert and never hovers, and the underline never takes hover.
func renderTabsRow(changedTotal int, activeTab string, hoverInactive bool, width int) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	half := width / 2
	otherHalf := width - half
	historyActive := activeTab == "history"

	changesOn, historyOn := on, on
	if hoverInactive {
		if historyActive {
			changesOn = on.Background(theme.HoverBg)
		} else {
			historyOn = on.Background(theme.HoverBg)
		}
	}
	label := func(style lipgloss.Style, text string, active bool) string {
		if active {
			return style.Foreground(theme.Text).Bold(true).Render(text)
		}
		return style.Foreground(theme.Dimmer).Render(text)
	}

	pad := changesOn.Width(half).Render("") + historyOn.Width(otherHalf).Render("")
	changesLabel := label(changesOn, "Changes", !historyActive) + changesOn.Foreground(theme.PinkSoft).Render(fmt.Sprintf(" %d", changedTotal))
	historyLabel := label(historyOn, "History", historyActive)
	top := changesOn.Width(half).Align(lipgloss.Center).Render(changesLabel) +
		historyOn.Width(otherHalf).Align(lipgloss.Center).Render(historyLabel)

	changesRule, historyRule := theme.Pink, theme.Rule
	if historyActive {
		changesRule, historyRule = theme.Rule, theme.Pink
	}
	underline := on.Foreground(changesRule).Render(strings.Repeat("─", half)) +
		on.Foreground(historyRule).Render(strings.Repeat("─", otherHalf))
	return pad + "\n" + top + "\n" + underline
}
```

`renderKeybar(width int, tab string)`: when `tab == "history"` the pairs are `{"↑↓", "commits"}, {"⇧↑↓", "range"}, {"enter", "files"}, {"e", "expand"}, {"1", "changes"}, {"f", "action"}, {"b", "branch"}, {"w", "worktree"}, {"r", "repo"}`; otherwise the existing pairs with `{"2", "history"}` appended. Callers pass `m.model.Tab`.

- [ ] **Step 5: Create `history.go`** with the sidebar half:

```go
// History tab: the commit list sidebar, the selected commit's header and
// file column, and their key/mouse routing. Parity reference: GitHub
// Desktop's app/src/ui/history (commit-list-item, expandable-commit-summary,
// selected-commits, committed-file-item). The read-only diff is diff.go's.
package mission

import (
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
	"rt-ui/internal/views/picker"
)

const (
	// tabs(3, pad+label+underline) + the tabs-gap blank band row(1).
	historyFixedTopRows = 4
	historyRowHeight    = 2
	// Rows from the end at which the next page is requested.
	historyPageThreshold = 10
	historyFilesMin      = 24
	historyFilesMax      = 40
)

type historyDebounceKind int

const (
	historyDebounceCommit historyDebounceKind = iota
	historyDebounceFile
)

type historyDebounceMsg struct {
	generation int
	kind       historyDebounceKind
}

type tabPayload struct {
	Tab string `json:"tab"`
}

type historySelectPayload struct {
	Shas []string `json:"shas"`
}

type historyFilePayload struct {
	Path          string `json:"path"`
	ShowOversized bool   `json:"showOversized,omitempty"`
}

func (m *Mission) historyTab() bool { return m.model.Tab == "history" }

func (m *Mission) emitTab(tab string) tea.Cmd {
	if m.model.Tab == tab || (tab == "changes" && m.model.Tab == "") {
		return nil
	}
	m.focus = focusList
	return m.em.Emit(protocol.Intent{Name: "mission:tab", Payload: mustPayload(tabPayload{Tab: tab})})
}

func (m *Mission) historyIndex(sha string) int {
	for i, c := range m.model.History.Commits {
		if c.Sha == sha {
			return i
		}
	}
	return -1
}

// clampHistory runs on every SetModel: the view's cursor survives a push
// while its sha is still listed; once it falls off (a reload, a worktree
// switch) the cursor adopts the driver's own selection.
func (m *Mission) clampHistory() {
	commits := m.model.History.Commits
	if len(commits) == 0 {
		m.historyCursor, m.historyAnchor = "", ""
	} else if m.historyIndex(m.historyCursor) < 0 {
		m.historyCursor = commits[0].Sha
		for _, c := range commits {
			if c.Selected {
				m.historyCursor = c.Sha
				break
			}
		}
		m.historyAnchor = ""
	}
	if m.historyAnchor != "" && m.historyIndex(m.historyAnchor) < 0 {
		m.historyAnchor = ""
	}
	files := m.model.History.Files
	found := false
	for _, f := range files {
		if f.Path == m.historyFile {
			found = true
			break
		}
	}
	if !found {
		m.historyFile = m.model.History.SelectedFile
	}
}

// historySelectionShas is the anchor..cursor span in list order (newest
// first), the payload mission:history-select carries.
func (m *Mission) historySelectionShas() []string {
	c := m.historyIndex(m.historyCursor)
	if c < 0 {
		return nil
	}
	a := m.historyIndex(m.historyAnchor)
	if a < 0 {
		a = c
	}
	lo, hi := min(a, c), max(a, c)
	shas := make([]string, 0, hi-lo+1)
	for i := lo; i <= hi; i++ {
		shas = append(shas, m.model.History.Commits[i].Sha)
	}
	return shas
}

func (m *Mission) historyInSelection(idx int) bool {
	c := m.historyIndex(m.historyCursor)
	if c < 0 {
		return false
	}
	a := m.historyIndex(m.historyAnchor)
	if a < 0 {
		a = c
	}
	return idx >= min(a, c) && idx <= max(a, c)
}

func (m *Mission) emitHistorySelect() tea.Cmd {
	m.historyGen++
	return m.em.Emit(protocol.Intent{Name: "mission:history-select", Payload: mustPayload(historySelectPayload{Shas: m.historySelectionShas()})})
}

// maybeRequestMore asks for the next page once per page: historyMoreFor
// records the list length a request went out for, so every further move
// inside the threshold is silent until the page lands and grows the list.
func (m *Mission) maybeRequestMore() tea.Cmd {
	h := m.model.History
	n := len(h.Commits)
	if !h.HasMore || h.Loading || n == 0 || m.historyMoreFor == n {
		return nil
	}
	if m.historyIndex(m.historyCursor) < n-historyPageThreshold {
		return nil
	}
	m.historyMoreFor = n
	return m.em.Emit(protocol.Intent{Name: "mission:history-more"})
}

func (m *Mission) historyMove(delta int, extend bool) tea.Cmd {
	commits := m.model.History.Commits
	n := len(commits)
	if n == 0 {
		return nil
	}
	if extend {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	i := max(0, min(n-1, m.historyIndex(m.historyCursor)+delta))
	m.historyCursor = commits[i].Sha
	m.historyGen++
	gen := m.historyGen
	tick := selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return historyDebounceMsg{generation: gen, kind: historyDebounceCommit}
	})
	return tea.Batch(tick, m.maybeRequestMore())
}

func (m *Mission) historyListKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.historyMove(-1, false)
	case "down":
		return m, m.historyMove(1, false)
	case "shift+up":
		return m, m.historyMove(-1, true)
	case "shift+down":
		return m, m.historyMove(1, true)
	case "enter":
		if len(m.model.History.Files) > 0 {
			m.focus = focusHistoryFiles
		}
	case "e":
		m.historyExpanded = !m.historyExpanded
	case "1":
		return m, m.emitTab("changes")
	case "f":
		return m, m.em.Emit(protocol.Intent{Name: "mission:action"})
	case "b":
		return m.openBranchModal()
	case "w":
		return m.openWorktreeModal()
	case "r":
		return m.openRepoModal()
	case "q":
		return m.quit()
	}
	return m, nil
}

// renderHistorySidebar is the History tab's sidebar (History.png): the tab
// strip, the tabs-gap band, then the commit list to the bottom. No filter,
// commit box, or undo strip: GHD's History sidebar has none of them.
func (m *Mission) renderHistorySidebar(width, height int) string {
	listH := max(height-historyFixedTopRows, 0)
	return lipgloss.JoinVertical(lipgloss.Left,
		renderTabsRow(m.model.ChangedTotal, "history", m.hoverTab, width),
		blankRows(width, 1),
		m.renderCommitList(width, listH),
	)
}

func (m *Mission) renderCommitList(width, height int) string {
	commits := m.model.History.Commits
	n := len(commits)
	rowWidth := max(width-1, 0)
	blank := lipgloss.NewStyle().Width(rowWidth).Background(theme.Bg).Render("")
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	restOn := lipgloss.NewStyle().Background(theme.Bg)
	if n == 0 {
		lines := make([]string, height)
		for i := range lines {
			lines[i] = blank + restOn.Render(" ")
		}
		if height > 0 && m.model.History.Loading {
			lines[0] = lipgloss.NewStyle().Width(rowWidth).Background(theme.Bg).Foreground(theme.Faint).Render(clip("  Loading history…", rowWidth)) + restOn.Render(" ")
		}
		return strings.Join(lines, "\n")
	}
	capRows := height / historyRowHeight
	cursorIdx := max(m.historyIndex(m.historyCursor), 0)
	top, vis := picker.Viewport(cursorIdx, m.historyTop, n, capRows, capRows, 0)
	m.historyTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, n)

	lines := make([]string, 0, height)
	for i := 0; i < capRows; i++ {
		idx := top + i
		a, b := blank, blank
		if i < vis && idx < n {
			a, b = renderCommitRow(commits[idx], rowWidth, commits[idx].Sha == m.historyCursor, m.historyInSelection(idx), idx == m.hoverCommit)
		}
		cell := picker.ThumbCell(i, thumbTop, thumbH, thumbOn, restOn)
		lines = append(lines, a+cell, b+cell)
	}
	for len(lines) < height {
		lines = append(lines, blank+restOn.Render(" "))
	}
	return strings.Join(lines, "\n")
}

// renderCommitRow is GHD's commit-list-item as two terminal rows: the
// summary with its tag/unpushed indicators flush right, then byline · time.
// Both rows are exactly width cells: anything wider would wrap and desync
// historySidebarHit's two-rows-per-commit arithmetic.
func renderCommitRow(c HistoryCommitRow, width int, cursor, selected, hover bool) (string, string) {
	on := lipgloss.NewStyle().Background(theme.Bg)
	switch {
	case selected || cursor:
		on = on.Background(theme.SelBg)
	case hover:
		on = on.Background(theme.HoverBg)
	}
	prefix := "  "
	if cursor {
		prefix = theme.GlyphBar + " "
	}
	prefixStyled := on.Render("  ")
	if cursor {
		prefixStyled = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
	}

	var right string
	if len(c.Tags) > 0 {
		right = pill(c.Tags[0], theme.Lav)
		if len(c.Tags) > 1 {
			right += on.Foreground(theme.Faint).Render("+")
		}
	}
	if c.Unpushed {
		if right != "" {
			right += on.Render(" ")
		}
		right += on.Foreground(theme.Cyan).Render("↑")
	}
	rightW := lipgloss.Width(right)
	gap := 0
	if rightW > 0 {
		gap = 1
	}
	summaryW := width - lipgloss.Width(prefix) - gap - rightW - 1
	if summaryW < 1 {
		right, rightW, gap = "", 0, 0
		summaryW = max(width-lipgloss.Width(prefix)-1, 0)
	}
	summaryStyle := on.Foreground(theme.Text)
	summary := c.Summary
	if summary == "" {
		summary = "Empty commit message"
		summaryStyle = on.Foreground(theme.Faint)
	}
	line1 := prefixStyled + summaryStyle.Width(summaryW).Render(clip(summary, summaryW))
	if gap > 0 {
		line1 += on.Render(" ")
	}
	line1 += right + on.Render(" ")

	meta := c.Byline
	if c.When != "" {
		meta += " · " + c.When
	}
	metaW := max(width-2, 0)
	line2 := on.Render("  ") + on.Foreground(theme.Dim).Width(metaW).Render(clip(meta, metaW))
	return line1, line2
}

// historySidebarHit walks renderHistorySidebar's row sequence in lockstep.
func (m *Mission) historySidebarHit(x, y, listRegionH int) hit {
	if y < 2 {
		if x < sidebarWidth/2 {
			return hit{kind: hitTab, idx: 0}
		}
		return hit{}
	}
	if y < historyFixedTopRows {
		return hit{}
	}
	row := y - historyFixedTopRows
	if row >= listRegionH {
		return hit{}
	}
	idx := m.historyTop + row/historyRowHeight
	if row/historyRowHeight >= listRegionH/historyRowHeight || idx >= len(m.model.History.Commits) {
		return hit{}
	}
	return hit{kind: hitCommitRow, idx: idx}
}

func (m *Mission) clickCommitRow(idx int, shift bool) (tea.Model, tea.Cmd) {
	commits := m.model.History.Commits
	if idx < 0 || idx >= len(commits) {
		return m, nil
	}
	if shift {
		if m.historyAnchor == "" {
			m.historyAnchor = m.historyCursor
		}
	} else {
		m.historyAnchor = ""
	}
	m.historyCursor = commits[idx].Sha
	m.focus = focusList
	return m, tea.Batch(m.emitHistorySelect(), m.maybeRequestMore())
}
```

Add a test seam at the bottom of `history_test.go`'s package (in `history.go` is wrong; keep it in the test file):

```go
func (m *Mission) setModelValue(model Model) error {
	raw, err := json.Marshal(model)
	if err != nil {
		return err
	}
	return m.SetModel(raw)
}
```

(import `encoding/json` in `history_test.go`).

- [ ] **Step 6: Wire it into `mission.go`:**
  - Add `focusHistoryFiles` to the `focusKind` const block (after `focusModal`).
  - Add fields to `Mission`: `historyCursor, historyAnchor string`, `historyTop, historyGen, historyMoreFor int`, `hoverCommit int`, `hoverTab bool`, `historyFile string`, `historyFilesTop int`, `hoverHistoryFile int`, `historyExpanded, hoverExpander bool`, and `lastTab string` plus `tabDiff map[string]diffScroll` where `type diffScroll struct{ cursor, top int; path string }`. Rename `hoverTabHistory` to `hoverTab`. `New` sets `hoverCommit: -1, hoverHistoryFile: -1, historyMoreFor: -1, tabDiff: map[string]diffScroll{}`.
  - Rename `hitTabHistory` to `hitTab`; add `hitCommitRow`, `hitHistoryFile`, `hitHistoryExpander` to the `hitKind` consts.
  - `SetModel`: before `m.clampDiffCursor()`, if `m.model.Tab != m.lastTab` then stash `diffScroll{m.diffCursor, m.diffTop, m.diffPath}` under `m.lastTab`, restore the new tab's stash (if any) into `m.diffCursor/m.diffTop/m.diffPath`, set `m.lastTab = m.model.Tab`, `m.focus = focusList` unless a modal is open. Then call `m.clampHistory()` after `m.clampSelection()`.  - `Update`: add `case historyDebounceMsg:` that returns `m, nil` when `v.generation != m.historyGen`, else emits `m.emitHistorySelect()` for `historyDebounceCommit` or the file intent for `historyDebounceFile` (Task 8 adds `emitHistoryFile`; in this task handle only the commit kind). Route `focusList` keys to `historyListKey` when `m.historyTab()`; add `focusHistoryFiles` routing to `historyFilesKey` (Task 8; route to `historyListKey` for now).
  - `listKey` gains `case "2": return m, m.emitTab("history")`.
  - `renderSidebar(width, height)`: `if m.historyTab() { return m.renderHistorySidebar(width, height) }` first.
  - `sidebarFixedTop` passes `renderTabsRow(m.model.ChangedTotal, "changes", m.hoverTab, width)`.
  - `layout()`: when `m.historyTab()`, `sidebarTopH = historyFixedTopRows`, `sidebarDockedH = 0`, `natural = historyFixedTopRows`, `listRegionH = bodyH - natural`, `sidebarFillerH = max(listRegionH - len(commits)*historyRowHeight, 0)`.
  - `View()` passes `renderKeybar(m.width, m.model.Tab)`; `layout()` measures the same call.
  - `hitTest` sidebar branch: `if m.historyTab() { return m.historySidebarHit(x, bodyY, l.listRegionH) }`.
  - `tabsHit(width, x)` returns `hit{kind: hitTab, idx: 1}` for the right half on the Changes tab.
  - `mouseClick`: `case hitTab:` emits `m.emitTab("history")` when `h.idx == 1`, `m.emitTab("changes")` when `h.idx == 0`; `case hitCommitRow:` returns `m.clickCommitRow(h.idx, mouse.Mod&tea.ModShift != 0)`.
  - `mouseMotion`: clear `hoverCommit = -1`, `hoverTab = false` (and the Task 8 fields) at the top; `case hitCommitRow: m.hoverCommit = h.idx`; `case hitTab: m.hoverTab = true`.
  - `mouseWheel`: when `m.historyTab()` and `mouse.X < sidebarWidth`, `return m, m.historyMove(delta, false)`.

- [ ] **Step 7: Run.** From `ui/`: `go test ./internal/views/mission/` → PASS (all, including the updated old tests). Then from the repo root `bun run ui:build`, and from `ui/` run the session-driven tests again (they use the built binary via `testutil.Binary`).

- [ ] **Step 8: Commit**

```
git add ui/internal/views/mission
git commit -m "glitter: History tab strip, commit list, range selection, paging"
```

---

### Task 8: Go view, part 2: header, file column, read-only diff

**Files:**
- Modify: `ui/internal/views/mission/history.go`, `mission.go`, `diff.go`
- Test: `ui/internal/views/mission/history_test.go`, `mission_test.go`

**Interfaces:**
- Consumes: Task 7's fields, focus kind, hit kinds, debounce message.
- Produces: `historyHeaderLines(h HistoryHeader, expanded bool, width int) []string`, `historyFilesWidth(paneW int) int`, `(m *Mission) renderHistoryPane(width, height int) string`, `(m *Mission) historyPaneHit(x, y int) hit`, `(m *Mission) historyFilesKey`, `(m *Mission) emitHistoryFile() tea.Cmd`, `diffHit(diffX, y, paneW int)`.

- [ ] **Step 1: Write the failing tests** in `history_test.go`:

  1. `TestHeaderCollapsedShowsSummaryMetaAndExpander`: stripped `historyHeaderLines(*h, false, 80)` has first line containing "Fix pty paint predicate" and "⌄"; a line containing "Matt · s1 · +12 −4".
  2. `TestHeaderExpandedShowsFullShaAndAuthors`: expanded lines contain "s1full", "Matt <m@x>", "12 added lines", "4 removed lines", and "⌃".
  3. `TestHeaderClipsDescriptionToTwoLinesCollapsed`: body of 5 lines shows exactly lines 1 and 2 collapsed, all 5 expanded.
  4. `TestHeaderRangeReadsShowingChanges`: `RangeCount: 2` gives a first line "Showing changes from 2 commits", no expander, no meta line.
  5. `TestHeaderLinesNeverWrap` (Review Focus 1): a 300-char summary, a CJK body line, and 6 tags: every returned line has `lipgloss.Width == 80` and no "\n".
  6. `TestHeaderHidesZeroLineCounts`: `LinesAdded: 0, LinesDeleted: 0` omits "+0".
  7. `TestHistoryPaneSlates` (Review Focus 5): no commits and not loading renders "No history"; `Loading` with no commits renders "Loading history…"; `Header == nil` renders "No commit selected"; `RangeCount: 2, Contiguous: false` renders "Unable to display diff when multiple non-consecutive commits are selected."
  8. `TestHistoryFilesWidthClamps`: `historyFilesWidth(60) == 24`, `historyFilesWidth(90) == 30`, `historyFilesWidth(200) == 40`.
  9. `TestReadOnlyDiffHasNoStageAffordances`: `renderDiffHeader(DiffModel{Path: "a", ReadOnly: true}, 80)` does not contain "space stages"; `renderDiffLine` of a read-only add line with `gutterHover=true` never paints `fgSGR(theme.GutterHoverBar)`; `m.diffKey(space)` on a read-only diff returns a nil cmd.
  10. `TestHistoryPaneHitMapsHeaderFilesAndDiff`: using `newHistoryTestMission()`, the row at `topH` over the pane is `hitHistoryExpander`; the first file row resolves to `hitHistoryFile` idx 0; a point right of the files column and below the diff header resolves to `hitDiffLine`/`hitDiffGutter`.
  11. `TestEnterStepsFocusListFilesDiffAndEscBack`: enter moves `focusList → focusHistoryFiles → focusDiff`; esc steps back `focusDiff → focusHistoryFiles → focusList`.
  12. `TestExpandKeyTogglesHeader`: `e` flips `historyExpanded`, and the pane's first file row moves down by the added header lines (hit-test agrees with the render).

Session-driven (`mission_test.go`):

  13. `TestHistoryEnterEnterDownEmitsFileSelect`: with a two-file history model, `enter` (files focus), `down`; within 2s a line contains `"name":"mission:history-file"` and the second path.
  14. `TestHistoryOversizedEnterEmitsShowOversized`: model with `Diff.Kind: "oversized", ReadOnly: true`; focus the diff (`enter`, `enter`), press `enter`; the line contains `"mission:history-file"` and `"showOversized":true`.

- [ ] **Step 2: Run to verify failure.** From `ui/`: `go test ./internal/views/mission/ -run 'Header|HistoryPane|HistoryFiles|ReadOnly|FocusList|ExpandKey'` → FAIL.

- [ ] **Step 3: Implement the pane in `history.go`:**

```go
func historyFilesWidth(paneW int) int {
	return max(historyFilesMin, min(historyFilesMax, paneW/3))
}

// historyHeaderLines is GHD's expandable-commit-summary as terminal rows.
// historyPaneHit measures len() of this same slice, so the header's height
// is never computed twice.
func historyHeaderLines(h HistoryHeader, expanded bool, width int) []string {
	on := lipgloss.NewStyle().Background(theme.BgSubtle)
	row := func(content string) string {
		return on.Width(width).Render(clipOn(content, width, on))
	}
	plain := func(col color.Color, text string) string {
		inner := max(width-2, 0)
		return row(on.Render(" ") + on.Foreground(col).Render(clip(text, inner)))
	}

	var lines []string
	if h.RangeCount > 1 {
		lines = append(lines, plain(theme.Text, fmt.Sprintf("Showing changes from %d commits", h.RangeCount)))
		return lines
	}

	glyph := "⌄"
	if expanded {
		glyph = "⌃"
	}
	summary, summaryCol := h.Summary, theme.Text
	if summary == "" {
		summary, summaryCol = "Empty commit message", theme.Faint
	}
	summaryW := max(width-4, 0)
	lines = append(lines, row(on.Render(" ")+on.Foreground(summaryCol).Bold(true).Width(summaryW).Render(clip(summary, summaryW))+on.Foreground(theme.Dimmer).Render(" "+glyph)))

	if h.Body != "" {
		body := strings.Split(h.Body, "\n")
		if !expanded && len(body) > 2 {
			body = body[:2]
		}
		for _, b := range body {
			lines = append(lines, plain(theme.TextSoft, b))
		}
	}

	sep := on.Foreground(theme.Faint).Render(" · ")
	if expanded {
		for _, a := range h.Authors {
			lines = append(lines, plain(theme.Dim, a))
		}
		meta := on.Foreground(theme.Dim).Render(h.Sha)
		if h.LinesAdded != 0 || h.LinesDeleted != 0 {
			meta += sep + on.Foreground(theme.Mint).Render(fmt.Sprintf("%d added lines", h.LinesAdded)) +
				sep + on.Foreground(theme.Coral).Render(fmt.Sprintf("%d removed lines", h.LinesDeleted))
		}
		if len(h.Tags) > 0 {
			meta += sep + on.Foreground(theme.Lav).Render(strings.Join(h.Tags, ", "))
		}
		lines = append(lines, row(on.Render(" ")+meta))
		return lines
	}

	meta := on.Foreground(theme.Dim).Render(h.Byline) + sep + on.Foreground(theme.Dim).Render(h.ShortSha)
	if h.LinesAdded != 0 || h.LinesDeleted != 0 {
		meta += sep + on.Foreground(theme.Mint).Render(fmt.Sprintf("+%d", h.LinesAdded)) + on.Render(" ") + on.Foreground(theme.Coral).Render(fmt.Sprintf("−%d", h.LinesDeleted))
	}
	if len(h.Tags) > 0 {
		meta += sep + on.Foreground(theme.Lav).Render(strings.Join(h.Tags, ", "))
	}
	lines = append(lines, row(on.Render(" ")+meta))
	return lines
}

// historySlate is the single message the pane shows when there is nothing
// to split into header, files, and diff; "" means render the full pane.
func (m *Mission) historySlate() string {
	h := m.model.History
	switch {
	case len(h.Commits) == 0 && h.Loading:
		return "Loading history…"
	case len(h.Commits) == 0:
		return "No history"
	case h.Header == nil:
		return "No commit selected"
	case h.Header.RangeCount > 1 && !h.Header.Contiguous:
		return "Unable to display diff when multiple non-consecutive commits are selected."
	}
	return ""
}

func (m *Mission) renderHistoryPane(width, height int) string {
	if slate := m.historySlate(); slate != "" {
		return centeredMessage(width, height, theme.Faint, clip(slate, width))
	}
	header := historyHeaderLines(*m.model.History.Header, m.historyExpanded, width)
	filesW := historyFilesWidth(width)
	diffW := max(width-filesW-1, 0)
	bodyH := max(height-len(header)-1, 0)
	rule := lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render(strings.Repeat("─", filesW) + "┬" + strings.Repeat("─", diffW))
	divider := strings.TrimSuffix(strings.Repeat(lipgloss.NewStyle().Background(theme.Bg).Foreground(theme.Rule).Render("│")+"\n", bodyH), "\n")
	body := lipgloss.JoinHorizontal(lipgloss.Top, m.renderHistoryFiles(filesW, bodyH), divider, m.renderDiffPane(diffW, bodyH))
	return lipgloss.JoinVertical(lipgloss.Left, append(append(header, rule), body)...)
}

// renderHistoryFiles is GHD's file-list-header ("N changed files") over the
// committed-file-item rows, status letter trailing like the Changes rows.
func (m *Mission) renderHistoryFiles(width, height int) string {
	if height <= 0 {
		return ""
	}
	files := m.model.History.Files
	on := lipgloss.NewStyle().Background(theme.Bg)
	noun := "files"
	if len(files) == 1 {
		noun = "file"
	}
	lines := []string{on.Width(width).Foreground(theme.Dim).Render(clip(fmt.Sprintf(" %d changed %s", len(files), noun), width))}

	listH := height - 1
	rowW := max(width-1, 0)
	cursor := 0
	for i, f := range files {
		if f.Path == m.historyFile {
			cursor = i
		}
	}
	top, vis := picker.Viewport(cursor, m.historyFilesTop, len(files), listH, listH, 0)
	m.historyFilesTop = top
	thumbTop, thumbH := picker.ThumbSpan(top, vis, len(files))
	thumbOn := lipgloss.NewStyle().Background(theme.Panel)
	for i := 0; i < listH; i++ {
		idx := top + i
		line := on.Width(rowW).Render("")
		if i < vis && idx < len(files) {
			line = renderHistoryFileRow(files[idx], rowW, files[idx].Path == m.historyFile, idx == m.hoverHistoryFile, m.focus == focusHistoryFiles)
		}
		lines = append(lines, line+picker.ThumbCell(i, thumbTop, thumbH, thumbOn, on))
	}
	return strings.Join(lines, "\n")
}

func renderHistoryFileRow(f HistoryFileRow, width int, cursor, hover, focused bool) string {
	on := lipgloss.NewStyle().Background(theme.Bg)
	prefix := on.Render("  ")
	switch {
	case cursor:
		on = on.Background(theme.SelBg)
		prefix = on.Render("  ")
		if focused {
			prefix = on.Foreground(theme.Pink).Render(theme.GlyphBar) + on.Render(" ")
		}
	case hover:
		on = on.Background(theme.HoverBg)
		prefix = on.Render("  ")
	}
	letter, col := statusGlyph(f.Status)
	pathW := max(width-2-1-lipgloss.Width(letter), 1)
	return on.Width(width).Render(prefix + on.Foreground(theme.Text).Width(pathW).Render(middleTruncate(f.Path, pathW)) + on.Render(" ") + on.Foreground(col).Render(letter))
}

func (m *Mission) historyPaneHit(x, y int) hit {
	if m.historySlate() != "" {
		return hit{}
	}
	paneW := m.diffWidth()
	headerH := len(historyHeaderLines(*m.model.History.Header, m.historyExpanded, paneW))
	if y < headerH {
		if y == 0 && m.model.History.Header.RangeCount <= 1 {
			return hit{kind: hitHistoryExpander}
		}
		return hit{}
	}
	if y == headerH {
		return hit{}
	}
	bodyY := y - headerH - 1
	filesW := historyFilesWidth(paneW)
	switch {
	case x < filesW:
		if bodyY == 0 {
			return hit{}
		}
		idx := m.historyFilesTop + bodyY - 1
		if idx < len(m.model.History.Files) {
			return hit{kind: hitHistoryFile, idx: idx}
		}
		return hit{}
	case x == filesW:
		return hit{}
	default:
		return m.diffHit(x-filesW-1, bodyY, max(paneW-filesW-1, 0))
	}
}

func (m *Mission) historyFileIndex() int {
	for i, f := range m.model.History.Files {
		if f.Path == m.historyFile {
			return i
		}
	}
	return -1
}

func (m *Mission) emitHistoryFile() tea.Cmd {
	m.historyGen++
	return m.em.Emit(protocol.Intent{Name: "mission:history-file", Payload: mustPayload(historyFilePayload{Path: m.historyFile})})
}

func (m *Mission) historyFileMove(delta int) tea.Cmd {
	files := m.model.History.Files
	if len(files) == 0 {
		return nil
	}
	i := max(0, min(len(files)-1, m.historyFileIndex()+delta))
	m.historyFile = files[i].Path
	m.historyGen++
	gen := m.historyGen
	return selectTick(selectDebounceInterval, func(time.Time) tea.Msg {
		return historyDebounceMsg{generation: gen, kind: historyDebounceFile}
	})
}

func (m *Mission) historyFilesKey(v tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch v.String() {
	case "up":
		return m, m.historyFileMove(-1)
	case "down":
		return m, m.historyFileMove(1)
	case "enter":
		m.focus = focusDiff
	case "esc":
		m.focus = focusList
	case "e":
		m.historyExpanded = !m.historyExpanded
	case "1":
		return m, m.emitTab("changes")
	case "q":
		return m.quit()
	}
	return m, nil
}

func (m *Mission) clickHistoryFile(idx int) (tea.Model, tea.Cmd) {
	files := m.model.History.Files
	if idx < 0 || idx >= len(files) {
		return m, nil
	}
	m.historyFile = files[idx].Path
	m.focus = focusHistoryFiles
	return m, m.emitHistoryFile()
}
```

(`history.go` gains imports `fmt` and `image/color`.)

- [ ] **Step 4: `diff.go` changes:**
  - `diffKey`: `case "esc":` sets `focusHistoryFiles` when `m.historyTab()`, else `focusList`. `space`, `s`, `d` return `m, nil` when `m.model.Diff.ReadOnly`. `enter` on `"oversized"`: when `m.historyTab()` emit `mission:history-file` with `historyFilePayload{Path: m.model.Diff.Path, ShowOversized: true}`, else the existing `mission:select`.
  - `renderDiffPane`: in the `"none"` branch, when `m.historyTab()` return `centeredMessage(width, height, theme.Faint, "No file selected")` if `len(m.model.History.Files) > 0`, else a blank `centeredMessage(width, height, theme.Faint, "")`.
  - `renderDiffHeader`: the right-hand staging hint is `""` when `d.ReadOnly`.
  - `renderDiffLines`: pass `hover && m.hoverGutter && !m.model.Diff.ReadOnly` as `gutterHover`.
  - `diffHit` gains a `paneW int` parameter used in place of `m.diffWidth()`; the Changes caller passes `m.diffWidth()`. A read-only diff never resolves to `hitDiffGutter`: return `hitDiffLine` for every in-range row when `m.model.Diff.ReadOnly`.

- [ ] **Step 5: `mission.go` wiring:**
  - `View()`: the right pane is `m.renderHistoryPane(diffW, bodyHeight)` when `m.historyTab()`, else the existing `m.renderDiffPane(diffW, bodyHeight)`.
  - `hitTest`'s right-pane branch: `if m.historyTab() { return m.historyPaneHit(x-sidebarWidth-1, bodyY) }` before the existing `diffHit` call (which now passes `m.diffWidth()`).
  - `Update`: `historyDebounceMsg` with `historyDebounceFile` returns `m.emitHistoryFile()`; route `focusHistoryFiles` keys to `historyFilesKey`.
  - `mouseClick`: `case hitHistoryFile: return m.clickHistoryFile(h.idx)`; `case hitHistoryExpander: m.historyExpanded = !m.historyExpanded`. The existing `hitDiffGutter`/`hitDiffLine` cases keep working (a read-only diff never produces the gutter kind).
  - `mouseMotion`: clear `hoverHistoryFile = -1`, `hoverExpander = false`; set them for `hitHistoryFile` and `hitHistoryExpander`.
  - `mouseWheel` in History over the pane: compute `filesW := historyFilesWidth(m.diffWidth())`; when `mouse.X - sidebarWidth - 1 < filesW` return `m.historyFileMove(delta)`, else `m.moveDiffCursor(delta)`.

- [ ] **Step 6: Run.** From `ui/`: `go test ./internal/views/mission/` → PASS. `bun run ui:build`, then rerun the session-driven tests.

- [ ] **Step 7: Look at it.** Launch against this repo under an isolated HOME in a 130x38 tmux pane (`env -i HOME=<tmp> PATH=$PATH TERM=xterm-256color bun <worktree>/cli.ts glitter` with `RT_UI_BIN=<worktree>/ui/dist/rt-ui`), press `2`, capture the pane, and compare against `History.png`. Record anything that reads wrong in the task report; fix what the board contradicts.

- [ ] **Step 8: Commit**

```
git add ui/internal/views/mission
git commit -m "glitter: History header, changed-file column, read-only diff"
```

---

### Task 9: pty gate and doc sweep

**Files:**
- Modify: `e2e/pty/glitter.test.ts`
- Modify: `docs/design/mission/README.md` (terminal geometry table, if it lists sidebar rows)

- [ ] **Step 1: Add the failing pty test** to `e2e/pty/glitter.test.ts`'s `describe` block. History is read-only, so the waits are the assertions here; say so in one line:

```ts
  test("the History tab lists the sandbox's commit and shows its diff", async () => {
    // History changes no git state, so the screen is the only observable.
    const { session } = await openBoard();
    await session.press("2");
    await session.waitForText("seed the sandbox", PAINT_TIMEOUT);
    await session.waitForText("changed files", PAINT_TIMEOUT);
    await session.waitForText('"maxTokens": 2048', PAINT_TIMEOUT);
  });
```

(`config.json` sorts first in the seed commit's file list and its seeded content contains `"maxTokens": 2048`. If the first listed file differs, wait on a line from whichever file `git -C <sandbox> log -1 --raw` lists first; read it, do not guess.)

- [ ] **Step 2: Run it.** `bun test e2e/pty/glitter.test.ts` (the file builds `rt-ui` itself in `beforeAll`) → the new test PASSES along with the existing four.

- [ ] **Step 3: README geometry.** If `docs/design/mission/README.md` carries a "Terminal geometry" table for the sidebar, add the History column: tabs(3) + gap(1) + two rows per commit.

- [ ] **Step 4: Full verification.** `bun test packages/git-core`, `bun test lib/mission`, `bunx tsc --noEmit`, from `ui/` `go test ./...`, `bun test e2e/pty/glitter.test.ts`, `bash scripts/repo-purity.sh`. All green; report exact counts.

- [ ] **Step 5: Commit**

```
git add e2e/pty/glitter.test.ts docs/design/mission/README.md
git commit -m "e2e: glitter History tab through the pty gate"
```

---

## After the tasks

- Whole-branch review on the most capable model, against the spec and this plan, with the Review Focus list as its attention lens.
- Matt test-drives the built binary against `History.png` and GitHub Desktop before merge.
- PR body names the ported GHD functions and the rulings above.
