/**
 * The mission session's brain: owns the driver state, gathers everything
 * buildModel needs, and turns each incoming SessionIntent into git-core /
 * git-actions calls followed by a rebuilt model push. The Go view renders
 * pixels only; every decision (guard checks, selection math, confirm
 * timers) lives here.
 */
import { basename, extname, join, normalize } from "node:path";
import { createStackGuardRunners } from "../stack-guard.ts";
import {
  DiffSelection,
  DiffSelectionType,
  type BranchInfo,
  type ChangesetData,
  type FetchState,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";
import { DiffLineType } from "../../packages/git-core/src/vendor/ghd/diff-line.ts";
import type { GitWorktreeBadge, RepoStatusRow, WorktreeTreeRow } from "../../packages/rt-client/src/commands.ts";
import type { ResolvedEditor } from "../../commands/code.ts";
import type { BranchGuardVerdict, buildWorktreeGuardMap, checkBranchGuard } from "../branch-guard.ts";
import { toBadge } from "../git-badge.ts";
import type { DaemonEvent, DaemonSubscription, daemonQuery } from "../daemon-client.ts";
import type { FileActions } from "../file-actions.ts";
import { canon } from "../fs-canon.ts";
import type { getPullRebase, getRemoteDefaultBranch } from "../git-ops.ts";
import { formatRelativeTime } from "../relative-time.ts";
import { repoLabel } from "../repo-label.ts";
import { createRealProbes } from "../setup/probes.ts";
import type { SessionIntent } from "../ui/protocol.ts";
import type { SessionHandle } from "../ui/spawn.ts";
import type { listWorktreesAsync, WorktreeEntry } from "../worktree/git-async.ts";
import { deriveAction, type ActionKind, type ActionState, type RunnableAction } from "./git-actions.ts";
import { HistoryStore, type HistoryBranch } from "./history.ts";
import { buildHistoryModel, committedFileRow } from "./history-model.ts";
import { buildModel, joinWorktreeRows, mergeWorktreeTrees, reconcileSelectedPath, type MissionLastCommit, type MissionModel, type MissionState, type WorktreeRow } from "./model.ts";
import {
  canStash,
  checkoutAndBringChanges,
  checkoutAndLeaveChanges,
  createStashAndDropPreviousEntry,
  StashStore,
  untrackedPaths,
  type SwitchStrategy,
} from "./stash.ts";
import { SessionDied } from "../runner/runner.ts";

// The alias types below exist only so MissionDeps can spell `typeof <fn>`
// without pulling every dependency in as a runtime import: each module
// still supplies the real function to the driver at construction time.
type OpenSessionFn = (view: string, model: unknown) => Promise<SessionHandle>;
type DaemonQueryFn = typeof daemonQuery;
type SubscribeFn = (onEvent: (ev: DaemonEvent) => void, opts?: { onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void }) => DaemonSubscription;
type RunActionFn = (cwd: string, kind: RunnableAction, opts: { remote?: string; branch: string | null }) => Promise<{ ok: boolean; detail: string }>;
type PublishRepoFn = (cwd: string, opts: { name: string; private: boolean }) => Promise<{ ok: boolean; detail: string }>;
type CommitStagedFn = (cwd: string, message: string, opts?: { amend?: boolean; noVerify?: boolean; allowEmpty?: boolean; coAuthors?: string[] }) => string;
type AmendStagedFn = (cwd: string, opts?: { message?: string; noVerify?: boolean }) => string;
type GuardFn = typeof checkBranchGuard;
type ResolveDefaultBranchFn = typeof getRemoteDefaultBranch;
type ReadPullRebaseFn = typeof getPullRebase;
type BuildGuardsFn = typeof buildWorktreeGuardMap;
type ListGitWorktreesFn = typeof listWorktreesAsync;

export interface MissionDeps {
  openSession: OpenSessionFn;
  /** createGitClient, or a fake bound per test/worktree. */
  client: (dir: string) => GitClient;
  daemonQuery: DaemonQueryFn;
  subscribe: SubscribeFn;
  runAction: RunActionFn;
  publishRepo: PublishRepoFn;
  commit: CommitStagedFn;
  amend: AmendStagedFn;
  guard: GuardFn;
  now: () => Date;
  /**
   * Resolves the current worktree's remote default branch (e.g.
   * "origin/main"), or null when none resolves. Synchronous (two blocking
   * git subprocesses in the worst case), so the driver calls it only from
   * refresh() and caches the result -- CodeRabbit's PR #353 finding was
   * model() calling this directly, which every push() invokes, blocking the
   * UI thread on every filter keystroke and selection change.
   */
  resolveDefaultBranch: ResolveDefaultBranchFn;
  /** Sync, same caching contract as resolveDefaultBranch: read once per refresh(), never from model()/push(). */
  readPullRebase: ReadPullRebaseFn;
  /** Batch worktree-ownership lookup for the branch modal's lock badges (display only; checkBranchGuard remains the enforcement point). */
  buildGuards: BuildGuardsFn;
  /**
   * Async twin of resolveDefaultBranch/readPullRebase's caching contract:
   * read once per refresh(), never from model()/push(). Lists git's own
   * worktree truth so the foldout shows a tree a plain `git worktree add`
   * created outside rt's registry (see mergeWorktreeTrees). Null means
   * git's own listing failed; worktreeRows() then falls back to the
   * registry rows alone rather than emptying the list.
   */
  listGitWorktrees: ListGitWorktreesFn;
  fileActions: FileActions;
  /**
   * Sync and slow (prefs, a git subprocess, up to nine `which` probes): read
   * at start, on every worktree change, and on mission:refresh only, never
   * from refresh()/model()/push().
   */
  resolveEditor: (dir: string) => ResolvedEditor | null;
  /** Must never inherit stdio or prompt: the board owns the terminal. The driver never awaits it. */
  launchEditor: (command: string, target: string) => Promise<boolean>;
  /** Sync stat, called once per History changeset (the cache drops on every refresh and git-status sweep), never per push. */
  pathExists: (absPath: string) => boolean;
}

interface StagePayload {
  path: string;
  mode: "toggle-file" | "line" | "hunk";
  selIdx?: number;
}

interface CommitPayload {
  summary: string;
  description?: string;
  amend?: boolean;
}

interface CheckoutPayload {
  branch?: string;
  new?: boolean;
  from?: string;
  name?: string;
  strategy?: SwitchStrategy;
}

interface StashEntryPayload {
  sha: string;
}

interface PublishPayload {
  name?: string;
  private?: boolean;
}

interface StashSelectPayload {
  path?: string;
  showOversized?: boolean;
}

interface WorktreePayload {
  path?: string;
  new?: boolean;
  name?: string;
}

interface RepoPayload {
  repo: string;
}

interface SelectPayload {
  filter?: string;
  showOversized?: boolean;
  path?: string;
}

interface ConfirmDiscard {
  path: string;
  mode: StagePayload["mode"];
  selIdx: number | null;
  armedAt: number;
}

interface TabPayload {
  tab: "changes" | "history";
}

interface HistorySelectPayload {
  shas: string[];
}

interface HistoryFilePayload {
  path: string;
  showOversized?: boolean;
}

interface MenuActionPayload {
  action: string;
  path?: string;
  sha?: string;
  name?: string;
}

interface DriverState extends MissionState {
  confirmDiscard: ConfirmDiscard | null;
  tab: "changes" | "history";
}

/** What one git-status pass did; see refreshBadges. */
type SweepOutcome = "applied" | "overtaken" | "moved";

/** Second `mission:discard` for the same target must land within this window to execute; a late or mismatched one just re-arms. */
const DISCARD_CONFIRM_WINDOW_MS = 5000;

/** Matches the provision CLI's own ceiling: claiming a tree and checking out can legitimately take minutes. */
const PROVISION_TIMEOUT_MS = 6 * 60_000;

/** The daemon's typed refusals, in the words a board reader can act on. */
const PROVISION_REFUSALS: Record<string, string> = {
  "repo-unknown": "this repo is not registered with rt",
  busy: "another worktree operation is running; try again in a moment",
  "branch-unresolved": "a branch name is required to provision a worktree",
  "handoff-write-failed": "the tree was created but could not be claimed; check rt worktree list",
};

const EMPTY_SNAPSHOT: RepoSnapshot = {
  branch: null,
  detached: false,
  upstream: null,
  ahead: null,
  behind: null,
  files: [],
  clean: true,
};

/**
 * Locates the line a wire-model `selIdx` (an ordinal counted over add/del
 * lines only, flattened across hunks) refers to, and translates it into
 * git-core's own absolute numbering (`hunk.unifiedDiffStart` + array
 * position within that hunk's lines, hunk header counted as position 0).
 * Every DiffSelection handed to stageSelection/discardSelection is built
 * from the return value here, never from the raw wire index.
 */
export interface ResolvedSelIdx {
  /** Absolute index of the target line itself (line mode). */
  absoluteIndex: number;
  /** Absolute index of its hunk's first line, i.e. `hunk.unifiedDiffStart` (hunk mode). */
  hunkStart: number;
  /** Number of lines in that hunk, i.e. `hunk.lines.length` (hunk mode). */
  hunkLength: number;
}

export function resolveCompactedSelIdx(diff: StagingDiff, compactedIdx: number): ResolvedSelIdx {
  let counter = 0;
  for (const hunk of diff.hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!;
      if (line.type === DiffLineType.Add || line.type === DiffLineType.Delete) {
        if (counter === compactedIdx) {
          return { absoluteIndex: hunk.unifiedDiffStart + i, hunkStart: hunk.unifiedDiffStart, hunkLength: hunk.lines.length };
        }
        counter++;
      }
    }
  }
  throw new Error(`mission: selIdx ${compactedIdx} out of range for ${diff.path}`);
}

export class MissionDriver {
  private readonly state: DriverState;
  private session: SessionHandle | null = null;
  private rows: RepoStatusRow[] = [];
  private trees: WorktreeTreeRow[] = [];
  /** Cached by refresh(); null means git's own listing failed (see MissionDeps.listGitWorktrees). */
  private gitWorktrees: WorktreeEntry[] | null = null;
  /** Registry path -> realpath, computed in refresh() so model() never touches the filesystem. */
  private treeCanon = new Map<string, string>();
  private snapshot: RepoSnapshot = EMPTY_SNAPSHOT;
  /** Read alongside the snapshot in refresh() and refreshBadges(), so the two always describe the same worktree. */
  private fetchState: FetchState = { lastFetchedAt: null };
  private branches: BranchInfo[] = [];
  private lastCommit: MissionLastCommit | null = null;
  private stagingDiff: StagingDiff | null = null;
  private action: ActionState = { kind: "fetch", title: "Fetch origin", meta: "Never fetched", ahead: 0, behind: 0 };
  private refreshingBadges = false;
  /** Bumped as every refresh() starts; see refreshBadges for what it guards. */
  private refreshGen = 0;
  /** Short sha of HEAD's tip, shown as current.branch on a detached checkout. */
  private headShortSha = "";
  /** Cached by refresh() (initial load, and every repo/worktree/checkout
   *  transition, all of which call it) so model()/push() and guardBranch()
   *  never run resolveDefaultBranch's blocking git subprocesses themselves. */
  private defaultBranch: string | null = null;
  /** First configured remote's name, or null for a repo with none. Cached by
   *  refresh(), same contract as defaultBranch: recomputeAction() and
   *  handleAction() read the cache rather than awaiting client.remotes()
   *  themselves. */
  private remoteName: string | null = null;
  /** Cached by refresh(), same contract as defaultBranch/remoteName. */
  private pullRebase = false;
  /** Branch name -> lock reason, for the branch modal's guarded rows. Cached
   *  by refresh(); a display signal only (see buildWorktreeGuardMap's own
   *  doc comment) -- checkoutBranch enforcement always goes through
   *  guardBranch()/checkBranchGuard, never this map. */
  private guards: Map<string, string> = new Map();
  /** True only while provisionWorktree's daemonQuery await is in flight. The
   *  daemon runs the ready task before that reply lands, so a
   *  worktree:ready-settled event for the tree being provisioned can arrive
   *  before currentWorktree has switched to it -- this gate is what tells
   *  the subscription handler such an event is worth caching in
   *  pendingSettledEvents rather than discarding it as unrelated. */
  private provisioning = false;
  /** Path -> ok, for a worktree:ready-settled event that arrived while
   *  provisioning was true and didn't match the OLD currentWorktree.
   *  provisionWorktree consumes (and clears) its own path's entry once the
   *  daemon reply reveals what that path is; cleared at the start of every
   *  provision attempt so an unmatched entry from an earlier one never
   *  lingers. */
  private pendingSettledEvents: Map<string, boolean> = new Map();
  private readonly history = new HistoryStore();
  private readonly stash = new StashStore();
  private switchSeq = 0;
  private publishSeq = 0;
  /** Count, not a boolean: two syncHistory() calls can overlap (a tab-open racing a concurrent badge sync), and one completing/discarding itself must not clear the indicator while the other is still genuinely in flight. */
  private historySyncs = 0;
  /** See MissionDeps.resolveEditor for when this is re-read. */
  private editor: ResolvedEditor | null = null;
  /** Keyed by changeset identity so a push never stats the disk; every refresh drops it, since the tree may have changed under an unchanged changeset. */
  private onDiskCache: { changeset: ChangesetData | null; paths: Set<string> } = { changeset: null, paths: new Set() };

  constructor(private readonly deps: MissionDeps, start: { repo: string; worktree: string }) {
    this.state = {
      currentRepo: start.repo,
      currentWorktree: start.worktree,
      selectedPath: null,
      filter: "",
      amending: false,
      summary: "",
      description: "",
      forcePushRecommended: false,
      busyAction: false,
      notice: "",
      showOversized: new Set(),
      selections: new Map(),
      confirmDiscard: null,
      settling: false,
      switchPrompt: null,
      publishPrompt: null,
      tab: "changes",
    };
  }

  async run(): Promise<void> {
    this.resolveEditor();
    await this.refresh();
    const session = await this.deps.openSession("mission", this.model());
    this.session = session;
    const sub = this.deps.subscribe((ev) => {
      if (ev.type === "worktree:ready-settled") {
        const data = ev.data as { path?: string; ok?: boolean } | undefined;
        if (typeof data?.path !== "string") return;
        if (data.path === this.state.currentWorktree) {
          this.state.settling = false;
          if (data.ok === false) {
            this.state.notice = "a ready step failed; dependencies in this tree may be stale";
          }
          this.push();
          return;
        }
        // Doesn't match yet because the provision reply hasn't landed --
        // cache it for provisionWorktree to consume once it has.
        if (this.provisioning) this.pendingSettledEvents.set(data.path, data.ok !== false);
        return;
      }
      if (ev.type !== "git-status") return;
      void this.onGitStatus().catch((err) => {
        this.state.notice = `error: ${err instanceof Error ? err.message : String(err)}`;
        this.push();
      });
    });
    try {
      for await (const intent of session.intents) {
        if (intent.name === "quit") break;
        try {
          await this.handle(intent);
        } catch (err) {
          // A stale selIdx or a transient git failure must not tear down the
          // session -- report it as a notice and keep looping.
          this.state.notice = `error: ${err instanceof Error ? err.message : String(err)}`;
          this.push();
        }
      }
    } finally {
      sub.close();
      const end = await session.close();
      if (end.reason === "died" || end.reason === "error") throw new SessionDied(end.code);
    }
  }

  // Mirrors lib/runner/runner.ts's guarded(): skips a git-status frame that
  // arrives while the previous one's refresh is still in flight, rather than
  // letting a burst interleave overlapping model pushes.
  private async onGitStatus(): Promise<void> {
    if (this.refreshingBadges) return;
    this.refreshingBadges = true;
    try {
      let outcome: SweepOutcome;
      do outcome = await this.refreshBadges();
      while (outcome === "moved");
      if (outcome === "applied") this.push();
    } finally {
      this.refreshingBadges = false;
    }
  }

  private push(): void {
    this.session?.push(this.model());
  }

  private model(): MissionModel {
    const history = buildHistoryModel(this.history, {
      now: this.deps.now(),
      loading: this.historySyncs > 0 && !this.history.loaded,
      onDisk: this.onDisk(),
    });
    const selectedFile = this.history.selectedFile;
    const stashFile = this.stash.selectedFile;
    return buildModel({
      state: this.state,
      rows: this.rows,
      snapshot: this.snapshot,
      branches: this.branches,
      guards: this.guards,
      worktrees: this.worktreeRows(),
      currentBadge: this.currentBadge(),
      stagingDiff: this.stagingDiff,
      lastCommit: this.lastCommit,
      action: this.action,
      headShortSha: this.headShortSha,
      defaultBranch: this.defaultBranch,
      tab: this.state.tab,
      history,
      historyDiff: {
        path: selectedFile?.path ?? null,
        status: history.files.find((f) => f.path === selectedFile?.path)?.status ?? "",
        diff: this.history.diff,
        oversizedOverride: selectedFile ? this.history.isOversizedShown(selectedFile.path) : false,
      },
      editorLabel: this.editor?.label ?? "",
      stash: this.stash.entry
        ? { entry: this.stash.entry, files: this.stash.files, showing: this.stash.showing, selectedFile: stashFile?.path ?? "" }
        : null,
      stashDiff: {
        path: stashFile?.path ?? null,
        status: stashFile ? committedFileRow(stashFile, () => false).status : "",
        diff: this.stash.diff,
        oversizedOverride: stashFile ? this.stash.isOversizedShown(stashFile.path) : false,
      },
      canStash: canStash(this.snapshot),
    });
  }

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
    const { paths } = this.onDiskCache;
    return (path) => paths.has(path);
  }

  private clearOnDisk(): void {
    this.onDiskCache = { changeset: null, paths: new Set() };
  }

  private resolveEditor(): void {
    this.editor = this.deps.resolveEditor(this.state.currentWorktree);
  }

  private worktreeRows(): WorktreeRow[] {
    return joinWorktreeRows(mergeWorktreeTrees(this.trees, this.gitWorktrees, this.state.currentRepo, (path) => this.treeCanon.get(path) ?? path), this.currentRepoBadges());
  }

  private currentRepoBadges(): GitWorktreeBadge[] {
    return this.rows.find((r) => r.repo === this.state.currentRepo)?.worktrees ?? [];
  }

  /**
   * Built from this session's own live read, never the daemon's
   * repos:status cache: that cache is swept on a timer and lags every push,
   * commit, and fetch taken here. It stays the source for other worktrees.
   */
  private currentBadge(): GitWorktreeBadge {
    return toBadge(this.state.currentWorktree, this.snapshot, this.fetchState, this.deps.now().toISOString());
  }

  private historyBranch(): HistoryBranch {
    return this.snapshot.branch ? { name: this.snapshot.branch, upstream: this.snapshot.upstream } : null;
  }

  /** A no-op off the History tab: the store never fetches anything a session that stays on Changes will never render. */
  private async syncHistory(): Promise<void> {
    if (this.state.tab !== "history") return;
    this.historySyncs++;
    try {
      await this.history.syncTip(this.deps.client(this.state.currentWorktree), this.historyBranch());
    } finally {
      this.historySyncs--;
    }
  }

  private async guardBranch(branch: string): Promise<BranchGuardVerdict> {
    const cwd = this.state.currentWorktree;
    return this.deps.guard({
      cwd,
      branch,
      // The cache is always fresh here: cwd is this.state.currentWorktree,
      // and every path that changes it (handleCheckout/Worktree/Repo) awaits
      // refresh() -- which repopulates the cache -- before a guard check can
      // run against the new worktree.
      defaultBranch: this.defaultBranch,
      runners: createStackGuardRunners(createRealProbes()),
    });
  }

  /** Repos, snapshot, branches, the stash entry, and last commit -- everything but the diff for the current pane. */
  private async refresh(): Promise<void> {
    this.refreshGen++;
    const client = this.deps.client(this.state.currentWorktree);
    // Every call site that changes currentWorktree (handleCheckout/Worktree/
    // Repo) awaits refresh() before its own push(), so re-resolving here
    // keeps the cache in step with the worktree it describes -- see
    // model()/guardBranch()'s own comments on why they read the cache
    // instead of calling this themselves.
    this.defaultBranch = this.deps.resolveDefaultBranch(this.state.currentWorktree);
    this.pullRebase = this.deps.readPullRebase(this.state.currentWorktree);
    this.clearOnDisk();
    const [statusRes, treesRes, snapshot, fetchState, branches, remotes, guards, gitWorktrees, log] = await Promise.all([
      this.deps.daemonQuery("repos:status", {}),
      this.deps.daemonQuery("worktree:list", { repoName: this.state.currentRepo }),
      client.snapshot(),
      client.fetchState(),
      client.branches(),
      client.remotes(),
      this.deps.buildGuards(this.state.currentWorktree),
      this.deps.listGitWorktrees(this.state.currentWorktree),
      client.log({ maxCount: 1 }),
    ]);
    if (statusRes?.ok) this.rows = (statusRes.data?.repos as RepoStatusRow[] | undefined) ?? [];
    if (treesRes?.ok) this.trees = (treesRes.data?.trees as WorktreeTreeRow[] | undefined) ?? [];
    this.treeCanon = new Map(this.trees.map((tree) => [tree.path, canon(tree.path)]));
    this.snapshot = snapshot;
    this.fetchState = fetchState;
    this.remoteName = remotes[0]?.name ?? null;
    this.guards = guards;
    this.gitWorktrees = gitWorktrees;
    this.reconcileSelections();
    this.state.selectedPath = reconcileSelectedPath(snapshot.files, this.state.selectedPath, this.state.filter);
    this.branches = branches;
    const entry = log[0];
    this.headShortSha = entry ? entry.sha.slice(0, 7) : "";
    // Preformatted here, not in model.ts, matching action.meta and
    // MissionBranchRow.when's own convention: the driver formats once per
    // refresh, the view renders whatever string it gets verbatim -- a raw
    // ISO timestamp reaching the undo strip read as a real bug on a plain
    // (non-rt) repo, where nothing else was masking it.
    this.lastCommit = entry
      ? { summary: entry.subject, when: formatRelativeTime(entry.authorDate, this.deps.now()), undoable: (snapshot.ahead ?? 0) > 0 }
      : null;
    await this.stash.load(client, snapshot.branch);
    await this.refreshDiff(client);
    this.recomputeAction();
    await this.syncHistory();
  }

  /**
   * Just the badges/snapshot/diff a repos:status sweep changed -- the
   * git-status subscription's own refresh, cheaper than a full seed.
   * Every read, including the diff for a selection that moved, lands
   * before the first write, so the snapshot, selection, and diff publish
   * together or not at all. A pass is "overtaken" when a refresh() started
   * meanwhile (every worktree, repo, and branch switch runs one, and it
   * re-reads everything), and must push nothing: the switch may still be
   * mid-refresh, with currentWorktree moved and this.snapshot not. A pass
   * whose selection or filter moved mid-read is "moved": nothing else will
   * re-read what it saw, since the daemon emits only on a change, so the
   * caller runs it again.
   */
  private async refreshBadges(): Promise<SweepOutcome> {
    const gen = this.refreshGen;
    const worktree = this.state.currentWorktree;
    const selectedPath = this.state.selectedPath;
    const filter = this.state.filter;
    const client = this.deps.client(worktree);
    const check = (): SweepOutcome | null =>
      this.refreshGen !== gen || this.state.currentWorktree !== worktree
        ? "overtaken"
        : this.state.selectedPath !== selectedPath || this.state.filter !== filter
          ? "moved"
          : null;
    const [statusRes, snapshot, fetchState, stagingDiff] = await Promise.all([
      this.deps.daemonQuery("repos:status", {}),
      client.snapshot(),
      client.fetchState(),
      selectedPath ? client.stagingDiff(selectedPath, { withSources: true }) : Promise.resolve(null),
    ]);
    const afterRead = check();
    if (afterRead) return afterRead;
    const nextPath = reconcileSelectedPath(snapshot.files, selectedPath, filter);
    const nextDiff = nextPath === selectedPath ? stagingDiff : nextPath ? await client.stagingDiff(nextPath, { withSources: true }) : null;
    const afterDiff = check();
    if (afterDiff) return afterDiff;
    if (statusRes?.ok) this.rows = (statusRes.data?.repos as RepoStatusRow[] | undefined) ?? [];
    this.snapshot = snapshot;
    this.fetchState = fetchState;
    this.state.selectedPath = nextPath;
    this.stagingDiff = nextDiff;
    this.reconcileSelections();
    this.clearOnDisk();
    this.recomputeAction();
    await this.stash.load(client, snapshot.branch);
    if (this.refreshGen !== gen || this.state.currentWorktree !== worktree) return "overtaken";
    await this.syncHistory();
    return "applied";
  }

  private async refreshDiff(client: GitClient): Promise<void> {
    this.stagingDiff = this.state.selectedPath ? await client.stagingDiff(this.state.selectedPath, { withSources: true }) : null;
  }

  /** Reads the diff before moving the selection: a push during the read must not pair one file's header with another's hunks. */
  private async selectPath(path: string | null): Promise<void> {
    const diff = path ? await this.deps.client(this.state.currentWorktree).stagingDiff(path, { withSources: true }) : null;
    this.state.selectedPath = path;
    this.stagingDiff = diff;
  }

  /**
   * Seeds every newly-appeared changed file's selection to All (GHD's own
   * default, ratified 2026-09-21) and prunes entries for files that no
   * longer appear (committed, reverted, or discarded away) so the map never
   * grows stale forever. Called from every place that replaces this.snapshot
   * -- refresh() and refreshBadges() -- since either can observe a file the
   * user, or another agent (this estate has agents that stage/edit
   * independently), touched outside this session.
   */
  private reconcileSelections(): void {
    const present = new Set(this.snapshot.files.map((f) => f.path));
    for (const path of this.state.selections.keys()) {
      if (!present.has(path)) this.state.selections.delete(path);
    }
    for (const path of present) {
      if (!this.state.selections.has(path)) {
        this.state.selections.set(path, DiffSelection.fromInitialSelection(DiffSelectionType.All));
      }
    }
  }

  private recomputeAction(): void {
    this.action = deriveAction({
      badge: this.currentBadge(),
      remoteName: this.remoteName,
      detached: this.snapshot.detached,
      unborn: this.snapshot.branch === null && !this.snapshot.detached,
      pullRebase: this.pullRebase,
      forcePushRecommended: this.state.forcePushRecommended,
      busy: this.state.busyAction,
    });
  }

  // Cleared unconditionally so a stale notice (an old refusal, an armed
  // discard prompt) never survives an unrelated intent; a handler that needs
  // it to persist (a refusal, a re-arm) sets it again below, after this.
  private async handle(intent: SessionIntent): Promise<void> {
    this.state.notice = "";
    // An armed discard only survives an uninterrupted second d; anything
    // else in between means the user moved on, so the next d re-arms.
    if (intent.name !== "mission:discard") this.state.confirmDiscard = null;
    switch (intent.name) {
      case "mission:action":
        await this.handleAction();
        break;
      case "mission:publish":
        await this.handlePublish(intent.payload as PublishPayload | undefined);
        break;
      case "mission:stage":
        await this.handleStage(intent.payload as StagePayload | undefined);
        break;
      case "mission:discard":
        await this.handleDiscard(intent.payload as StagePayload | undefined);
        break;
      case "mission:commit":
        await this.handleCommit(intent.payload as CommitPayload | undefined);
        break;
      case "mission:undo":
        await this.handleUndo();
        break;
      case "mission:checkout":
        await this.handleCheckout(intent.payload as CheckoutPayload | undefined);
        break;
      case "mission:worktree":
        await this.handleWorktree(intent.payload as WorktreePayload | undefined);
        break;
      case "mission:repo":
        await this.handleRepo(intent.payload as RepoPayload | undefined);
        break;
      case "mission:select":
        await this.handleSelect(intent.payload as SelectPayload | undefined);
        break;
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
      case "mission:menu-action":
        await this.handleMenuAction(intent.payload as MenuActionPayload | undefined);
        break;
      case "mission:stash":
        await this.handleStash();
        break;
      case "mission:stash-restore":
        await this.handleStashEntry("restore", intent.payload as StashEntryPayload | undefined);
        break;
      case "mission:stash-discard":
        await this.handleStashEntry("discard", intent.payload as StashEntryPayload | undefined);
        break;
      case "mission:stash-select":
        await this.handleStashSelect(intent.payload as StashSelectPayload | undefined);
        break;
      case "mission:stash-hide":
        this.stash.hide();
        this.push();
        break;
      case "mission:refresh":
        this.resolveEditor();
        await this.refresh();
        this.push();
        break;
      default:
        break;
    }
  }

  private async handleTab(payload: TabPayload | undefined): Promise<void> {
    if (payload?.tab !== "changes" && payload?.tab !== "history") return;
    this.state.tab = payload.tab;
    if (payload.tab === "history") {
      const sync = this.syncHistory();
      this.push();
      await sync;
    }
    this.push();
  }

  private async handleAction(): Promise<void> {
    const kind = this.action.kind;
    if (kind === "publish-repo") {
      // Every route to the segment's action lands here (its key, a click,
      // the menu row), so the dialog opens the same way from each.
      this.state.publishPrompt = { seq: ++this.publishSeq, name: repoLabel(this.state.currentRepo) };
      this.push();
      this.state.publishPrompt = null;
      return;
    }
    await this.runBusy(
      () => this.deps.runAction(this.state.currentWorktree, kind, { remote: this.remoteName ?? undefined, branch: this.snapshot.branch }),
      () => {
        if (kind === "push" || kind === "force-push") this.state.forcePushRecommended = false;
      },
    );
  }

  private async handlePublish(payload: PublishPayload | undefined): Promise<void> {
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (name === "") return;
    await this.runBusy(() => this.deps.publishRepo(this.state.currentWorktree, { name, private: payload?.private !== false }));
  }

  /**
   * One remote action under the busy segment: a failure is the notice, and
   * either way it refreshes, since a failure can still change the repo (gh
   * adds origin before the push that fails, so remoteName moves).
   */
  private async runBusy(run: () => Promise<{ ok: boolean; detail: string }>, onOk?: () => void): Promise<void> {
    this.state.busyAction = true;
    this.recomputeAction();
    this.push();
    try {
      const result = await run();
      this.state.notice = result.ok ? "" : result.detail;
      if (result.ok) onOk?.();
      await this.refresh();
    } finally {
      // Reached on a rejection too, so a stalled/failed action never leaves
      // the model stuck busy for the caller's error boundary to clean up.
      this.state.busyAction = false;
      this.recomputeAction();
      this.push();
    }
  }

  /**
   * The file's persisted commit-intent selection (GHD's checkbox model,
   * ratified 2026-09-21): every changed file's selection is seeded to All
   * the moment it first appears (reconcileSelections, called from both
   * refresh and refreshBadges) and persists across pushes and refreshes as
   * the user's own commit intent, independent of the real git index. This
   * fallback (All) only matters before the very first reconcile has ever
   * run.
   */
  private currentSelection(path: string): DiffSelection {
    return this.state.selections.get(path) ?? DiffSelection.fromInitialSelection(DiffSelectionType.All);
  }

  /**
   * GHD's own model (ratified 2026-09-21): toggling a line, hunk, or file
   * changes the user's commit SELECTION only -- it never touches the real
   * git index. Nothing here is staged or unstaged; the index is rebuilt
   * from every file's own selection at commit time (handleCommit's
   * rebuildIndexFromSelections). client.stagingDiff is still needed here
   * to resolve a line/hunk payload's compacted selIdx against the diff's
   * real hunk shape -- the same translation staging always needed, just no
   * longer followed by a git call.
   */
  private async handleStage(payload: StagePayload | undefined): Promise<void> {
    if (!payload || typeof payload.path !== "string") return;
    const current = this.currentSelection(payload.path);

    if (payload.mode === "toggle-file") {
      // A tri-state checkbox's own click rule: Partial or None -> All,
      // All -> None. Mirrors a real checkbox's "indeterminate/unchecked
      // click checks everything, checked click clears it" behavior.
      const next =
        current.getSelectionType() === DiffSelectionType.All
          ? DiffSelection.fromInitialSelection(DiffSelectionType.None)
          : DiffSelection.fromInitialSelection(DiffSelectionType.All);
      this.state.selections.set(payload.path, next);
      this.push();
      return;
    }

    const client = this.deps.client(this.state.currentWorktree);
    const diff = await client.stagingDiff(payload.path);
    let next: DiffSelection | null = null;
    if (payload.mode === "line" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      next = current.withToggleLineSelection(target.absoluteIndex);
    } else if (payload.mode === "hunk" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      const allSelected = current.isRangeSelected(target.hunkStart, target.hunkLength) === DiffSelectionType.All;
      next = current.withRangeSelection(target.hunkStart, target.hunkLength, !allSelected);
    }
    if (!next) return;

    this.state.selections.set(payload.path, next);
    this.push();
  }

  // Unchanged by the GHD staging-model ruling: discard is a real,
  // destructive working-tree edit, not a selection change, so it still
  // calls client.discardSelection directly. It now operates against the
  // full HEAD-vs-worktree diff (client.stagingDiff's own new shape) rather
  // than the old worktree-vs-index one -- the same diff the pane actually
  // shows, so a discard always targets the line/hunk the user is looking
  // at. A stale Partial selection is downgraded to None after (GHD's own
  // rule for exactly this "the diff's shape shifted underneath a Partial
  // selection's absolute indices" case -- see handleCommit's identical
  // treatment); All/None both mean the same thing regardless of the
  // diff's shape, so neither needs touching.
  private async handleDiscard(payload: StagePayload | undefined): Promise<void> {
    if (!payload || typeof payload.path !== "string") return;
    const now = this.deps.now().getTime();
    const armed = this.state.confirmDiscard;
    const matches =
      armed !== null &&
      armed.path === payload.path &&
      armed.mode === payload.mode &&
      armed.selIdx === (payload.selIdx ?? null) &&
      now - armed.armedAt <= DISCARD_CONFIRM_WINDOW_MS;

    if (!matches) {
      this.state.confirmDiscard = { path: payload.path, mode: payload.mode, selIdx: payload.selIdx ?? null, armedAt: now };
      this.state.notice = "press d again to discard";
      this.push();
      return;
    }

    this.state.confirmDiscard = null;
    const client = this.deps.client(this.state.currentWorktree);
    const diff = await client.stagingDiff(payload.path);

    let discardSelection: DiffSelection | null = null;
    if (payload.mode === "line" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      discardSelection = DiffSelection.fromInitialSelection(DiffSelectionType.None).withLineSelection(target.absoluteIndex, true);
    } else if (payload.mode === "hunk" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      discardSelection = DiffSelection.fromInitialSelection(DiffSelectionType.None).withRangeSelection(target.hunkStart, target.hunkLength, true);
    }
    if (!discardSelection) return;

    await client.discardSelection(diff, discardSelection);
    if (this.currentSelection(payload.path).getSelectionType() === DiffSelectionType.Partial) {
      this.state.selections.set(payload.path, DiffSelection.fromInitialSelection(DiffSelectionType.None));
    }
    this.state.notice = "";
    await this.refresh();
    this.push();
  }

  /**
   * The view clears its own local summary/description drafts the moment it
   * emits mission:commit (the only point a non-empty local draft can ever
   * go back to empty -- mission.go's emitCommit/SetModel treats a non-empty
   * draft as always outranking a push). A refusal or failure must echo the
   * rejected text back onto the wire model so the now-empty view fields
   * re-seed from it on the next push, or the typed message is lost with no
   * way to recover it.
   */
  private restoreDraft(payload: CommitPayload): void {
    this.state.summary = payload.summary;
    this.state.description = payload.description ?? "";
  }

  private async handleCommit(payload: CommitPayload | undefined): Promise<void> {
    if (!payload || typeof payload.summary !== "string") return;
    // The view already gates on a non-empty summary; this re-check covers
    // any other emitter so git never sees an empty -m.
    if (payload.summary.trim() === "") {
      this.state.notice = "a summary is required to commit";
      this.push();
      return;
    }
    if (payload.amend && this.snapshot.branch) {
      const verdict = await this.guardBranch(this.snapshot.branch);
      if (verdict.verdict === "refuse") {
        this.restoreDraft(payload);
        this.state.notice = verdict.detail;
        this.push();
        return;
      }
    }

    const cwd = this.state.currentWorktree;
    const client = this.deps.client(cwd);
    const message = payload.description ? `${payload.summary}\n\n${payload.description}` : payload.summary;
    // Both halves sit inside the try because a failed index rebuild loses the
    // draft exactly as a failed commit does.
    try {
      // GHD's own sequencing (app/src/lib/git/commit.ts's createCommit):
      // unconditionally reset the whole index to HEAD, then rebuild it from
      // each file's own commit-intent selection, THEN commit -- amend or
      // not. Anything staged outside glitter (a plain `git add`, another
      // agent working the same repo) is rebuilt away here: the checkbox is
      // the source of truth now, not whatever happened to already be in the
      // index. Documented in docs/design/mission/README.md so it's not a
      // surprise.
      await this.rebuildIndexFromSelections(client);
      if (payload.amend) {
        this.deps.amend(cwd, { message });
        this.state.forcePushRecommended = true;
      } else {
        this.deps.commit(cwd, message);
      }
    } catch (err) {
      this.restoreDraft(payload);
      this.state.notice = `commit failed: ${err instanceof Error ? err.message : String(err)}`;
      this.push();
      return;
    }

    this.state.summary = "";
    this.state.description = "";
    this.state.amending = false;
    this.state.notice = "";
    // GHD's own post-commit reconciliation (app/src/lib/stores/updates/
    // changes-state.ts's updateChangedFiles, called with clearPartialState:
    // true right after a commit lands): a file whose selection was Partial
    // just had SOME of its lines committed, so its remaining diff's shape
    // shifted -- the old selection's absolute indices no longer point at
    // the same content, and GHD's own fix is to downgrade it to None, not
    // carry it forward or reseed it to All. All/None files are untouched
    // here: a fully-checked file that fully committed simply vanishes from
    // the next snapshot and gets pruned by reconcileSelections; one that
    // was deliberately left unchecked was never touched by this commit and
    // must not spring back to checked just because a commit happened.
    for (const [path, selection] of this.state.selections) {
      if (selection.getSelectionType() === DiffSelectionType.Partial) {
        this.state.selections.set(path, DiffSelection.fromInitialSelection(DiffSelectionType.None));
      }
    }
    await this.refresh();
    this.push();
  }

  /**
   * GHD's own commit-time index rebuild (app/src/lib/git/update-index.ts's
   * stageFiles, ported to rt's own per-file primitives): the caller has
   * already reset the index to HEAD; this walks every changed file and
   * brings the index to match its own selection -- None needs no call
   * (already at HEAD), All is a whole-file stage (client.stageFileFully),
   * Partial re-fetches the file's own displayed diff and applies exactly
   * the checked lines (client.stageSelection, unchanged -- it was already
   * GHD's own applyPatchToIndex in every way that mattered once the diff
   * it's handed is the HEAD-vs-worktree one).
   */
  private async rebuildIndexFromSelections(client: GitClient): Promise<void> {
    await client.resetToCommit("HEAD", "mixed");
    for (const file of this.snapshot.files) {
      const selection = this.currentSelection(file.path);
      const type = selection.getSelectionType();
      if (type === DiffSelectionType.None) continue;
      if (type === DiffSelectionType.All) {
        await client.stageFileFully(file.path, file.originalPath);
        continue;
      }
      const diff = await client.stagingDiff(file.path);
      await client.stageSelection(diff, selection, file.originalPath ? { originalPath: file.originalPath } : {});
    }
  }

  private async handleUndo(): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    const result = await client.undoLastCommit();
    if (!result.ok) {
      this.state.notice = `refused: ${result.reason}`;
      this.push();
      return;
    }
    this.state.notice = "";
    this.state.forcePushRecommended = true;
    await this.refresh();
    this.push();
  }

  private async handleCheckout(payload: CheckoutPayload | undefined): Promise<void> {
    if (!payload) return;
    if (payload.new === true) {
      await this.createBranch(payload);
      return;
    }
    if (typeof payload.branch !== "string") return;
    const verdict = await this.guardBranch(payload.branch);
    if (verdict.verdict === "refuse") {
      this.state.notice = verdict.detail;
      this.push();
      return;
    }
    const client = this.deps.client(this.state.currentWorktree);
    const snapshot = await client.snapshot();
    if (snapshot.branch === payload.branch) {
      this.push();
      return;
    }
    const hasChanges = snapshot.files.length > 0;
    const requested = payload.strategy === "leave" || payload.strategy === "bring" ? payload.strategy : null;
    // GHD's tip.kind !== TipState.Valid rule: unborn and detached never ask, they bring.
    const strategy: SwitchStrategy | null = snapshot.branch === null ? "bring" : requested;
    if (strategy === null && hasChanges) {
      this.state.switchPrompt = { seq: ++this.switchSeq, branch: payload.branch, current: snapshot.branch!, hasStash: this.stash.entry !== null };
      this.push();
      this.state.switchPrompt = null;
      return;
    }
    let switched = false;
    try {
      if (strategy === "leave") this.state.notice = await checkoutAndLeaveChanges(client, payload.branch, snapshot);
      else if (strategy === "bring") await checkoutAndBringChanges(client, payload.branch, snapshot);
      else await client.checkoutBranch(payload.branch);
      switched = true;
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
    }
    if (switched) {
      this.stash.hide();
      this.state.selections = new Map();
    }
    await this.refresh();
    this.push();
  }

  private async handleStash(): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    this.snapshot = await client.snapshot();
    if (canStash(this.snapshot)) {
      try {
        this.state.notice = await createStashAndDropPreviousEntry(client, this.snapshot.branch!, untrackedPaths(this.snapshot));
      } catch (err) {
        this.state.notice = err instanceof Error ? err.message : String(err);
      }
    }
    await this.refresh();
    this.push();
  }

  private async handleStashEntry(action: "restore" | "discard", payload: StashEntryPayload | undefined): Promise<void> {
    if (typeof payload?.sha !== "string") return;
    const client = this.deps.client(this.state.currentWorktree);
    try {
      if (action === "restore") await client.popStashEntry(payload.sha);
      else await client.dropDesktopStashEntry(payload.sha);
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
    }
    await this.refresh();
    this.push();
  }

  private async handleStashSelect(payload: StashSelectPayload | undefined): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    if (payload?.showOversized === true && typeof payload.path === "string") this.stash.showOversized(payload.path);
    else await this.stash.select(client, typeof payload?.path === "string" ? payload.path : undefined);
    this.push();
  }

  private async createBranch(payload: CheckoutPayload): Promise<void> {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name === "") return;
    const client = this.deps.client(this.state.currentWorktree);
    try {
      // One atomic checkout -b: git leaves no branch behind when the
      // checkout itself fails, so a dirty tree cannot strand one.
      await client.createBranch(name, { from: payload.from, checkout: true });
    } catch (err) {
      this.state.notice = err instanceof Error ? err.message : String(err);
      this.push();
      return;
    }
    this.state.notice = "";
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  /**
   * The single place `currentWorktree` is ever reassigned: `settling` must
   * travel with it, since a tree the board switches away from can never
   * again produce a `worktree:ready-settled` event this driver acts on
   * (the event's path no longer matches `currentWorktree` by then), and a
   * tree the board switches TO is ready unless the caller says otherwise.
   * Only provisionWorktree's fresh tree passes true.
   */
  private setCurrentWorktree(path: string, settling: boolean): void {
    this.state.currentWorktree = path;
    this.state.settling = settling;
    this.history.reset();
    this.stash.reset();
    this.resolveEditor();
  }

  private async handleWorktree(payload: WorktreePayload | undefined): Promise<void> {
    if (!payload) return;
    if (payload.new === true) {
      await this.provisionWorktree(payload);
      return;
    }
    if (typeof payload.path !== "string") return;
    this.setCurrentWorktree(payload.path, false);
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async provisionWorktree(payload: WorktreePayload): Promise<void> {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name === "") return;
    // Provisioning can run for minutes (PROVISION_TIMEOUT_MS): the modal has
    // already closed by the time this awaits, so the board must say why it
    // is frozen rather than sitting blank until the daemon replies.
    this.state.notice = `provisioning ${name}...`;
    this.push();
    // A stale entry from an earlier provision attempt (one whose path never
    // matched, e.g. a refusal) must not be mistaken for this attempt's own
    // settled event below.
    this.pendingSettledEvents.clear();
    this.provisioning = true;
    let res: Awaited<ReturnType<DaemonQueryFn>>;
    try {
      res = await this.deps.daemonQuery("worktree:provision", {
        repoName: this.state.currentRepo,
        branch: name,
        owner: "glitter",
      }, PROVISION_TIMEOUT_MS);
    } finally {
      this.provisioning = false;
    }

    if (!res) {
      this.state.notice = "the rt daemon is not running";
      this.push();
      return;
    }
    if (!res.ok) {
      const code = typeof res.error === "string" ? res.error : "unknown";
      this.state.notice = PROVISION_REFUSALS[code] ?? `could not provision a worktree: ${code}`;
      this.push();
      return;
    }

    const data = res.data as { path?: string; readyPending?: boolean; readyHeld?: boolean } | undefined;
    if (typeof data?.path !== "string") {
      this.state.notice = "the daemon provisioned a tree but returned no path";
      this.push();
      return;
    }
    // A settled event for this exact path may have already arrived and been
    // cached above, while currentWorktree still pointed at the OLD tree --
    // consuming it here is what keeps its `ok` (and thus its failure
    // notice) from being lost to that ordering.
    const cachedOk = this.pendingSettledEvents.get(data.path);
    this.pendingSettledEvents.delete(data.path);
    // readyHeld means the daemon withheld readyPending entirely -- a silent
    // switch onto a tree whose team ready steps never ran is exactly what
    // the readiness design forbids, so this notice is the one place that
    // gets said out loud (commands/worktree.ts prints the same case).
    this.state.notice = data.readyHeld
      ? "team ready steps held pending approval... run rt worktree ready-approve"
      : cachedOk === false
        ? "a ready step failed; dependencies in this tree may be stale"
        : "";
    this.setCurrentWorktree(data.path, data.readyPending === true && cachedOk === undefined);
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async handleRepo(payload: RepoPayload | undefined): Promise<void> {
    if (!payload || typeof payload.repo !== "string") return;
    const target = this.rows.find((r) => r.repo === payload.repo)?.worktrees[0];
    if (!target) {
      // Refuse rather than half-switch: a repo without a known worktree has
      // no directory to point the git client at.
      this.state.notice = `no known worktree for ${repoLabel(payload.repo)}`;
      this.push();
      return;
    }
    this.state.currentRepo = payload.repo;
    this.setCurrentWorktree(target.worktree, false);
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async handleSelect(payload: SelectPayload | undefined): Promise<void> {
    if (!payload) return;
    if (typeof payload.filter === "string") {
      const next = reconcileSelectedPath(this.snapshot.files, this.state.selectedPath, payload.filter);
      if (next !== this.state.selectedPath) await this.selectPath(next);
      this.state.filter = payload.filter;
    }
    if (typeof payload.path === "string") {
      // GHD: selecting a working-directory file replaces the stash selection.
      this.stash.hide();
      await this.selectPath(payload.path === "" ? null : payload.path);
    }
    if (payload.showOversized === true && this.state.selectedPath) this.state.showOversized.add(this.state.selectedPath);
    if (payload.showOversized === false && this.state.selectedPath) this.state.showOversized.delete(this.state.selectedPath);
    this.push();
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
          if (abs && !this.deps.fileActions.reveal(abs)) this.state.notice = `Could not reveal ${rel}`;
          break;
        case "reveal-repo":
          if (!this.deps.fileActions.reveal(root, "folder")) this.state.notice = `Could not reveal ${basename(root)}`;
          break;
        case "open-default":
          if (abs && !this.deps.fileActions.open(abs)) this.state.notice = `Could not open ${rel}`;
          break;
        case "open-editor":
        case "open-repo-editor": {
          const target = p.action === "open-repo-editor" ? root : abs;
          if (!target) break;
          if (!this.editor) this.resolveEditor();
          if (!this.editor) {
            this.state.notice = "No editor set: run rt code once to pick one";
            break;
          }
          this.launchInBackground(this.editor, target);
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
          if (!rel) break;
          // The cached snapshot can lag the tree (a file deleted then
          // recreated keeps kind "deleted" until the next full refresh), and
          // discardChanges picks Trash versus checkout from the kind.
          this.snapshot = await client.snapshot();
          // Set before the lookup: the fresh read can differ from what the
          // board shows, and discardChanges can throw after it has already
          // changed the tree.
          mutated = true;
          const file = this.snapshot.files.find((f) => f.path === rel);
          if (!file) {
            this.state.notice = `${rel} has no changes to discard`;
            break;
          }
          await client.discardChanges([file]);
          this.state.selections.delete(file.path);
          break;
        }
        case "discard-all": {
          this.snapshot = await client.snapshot();
          mutated = true;
          if (this.snapshot.files.length === 0) {
            this.state.notice = "No changes to discard";
            break;
          }
          await client.discardChanges(this.snapshot.files);
          this.state.selections = new Map();
          break;
        }
        case "create-tag": {
          const name = typeof p.name === "string" ? p.name.trim() : "";
          if (typeof p.sha === "string" && name !== "") {
            await client.createTag(name, { sha: p.sha });
            this.history.requestReload();
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
    this.state.notice = this.deps.fileActions.copy(text) ? "Copied" : "Could not copy";
  }

  /** Never awaited: an editor CLI that waits for its window must not hold up the intent loop. */
  private launchInBackground(editor: ResolvedEditor, target: string): void {
    const failed = (): void => {
      this.state.notice = `Could not open ${editor.label}`;
      this.push();
    };
    this.deps.launchEditor(editor.command, target).then((ok) => {
      if (!ok) failed();
    }, failed);
  }
}
