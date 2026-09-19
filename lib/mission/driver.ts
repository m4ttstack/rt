/**
 * The mission session's brain: owns the driver state, gathers everything
 * buildModel needs, and turns each incoming SessionIntent into git-core /
 * git-actions calls followed by a rebuilt model push. The Go view renders
 * pixels only; every decision (guard checks, selection math, confirm
 * timers) lives here.
 */
import { createStackGuardRunners } from "../stack-guard.ts";
import {
  DiffSelection,
  DiffSelectionType,
  type BranchInfo,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";
import { DiffLineType } from "../../packages/git-core/src/vendor/ghd/diff-line.ts";
import type { GitWorktreeBadge, RepoStatusRow, WorktreeTreeRow } from "../../packages/rt-client/src/commands.ts";
import type { BranchGuardVerdict, checkBranchGuard } from "../branch-guard.ts";
import type { DaemonEvent, DaemonSubscription, daemonQuery } from "../daemon-client.ts";
import { getRemoteDefaultBranch } from "../git-ops.ts";
import { createRealProbes } from "../setup/probes.ts";
import type { SessionIntent } from "../ui/protocol.ts";
import type { SessionHandle } from "../ui/spawn.ts";
import { deriveAction, type ActionKind, type ActionState } from "./git-actions.ts";
import { buildModel, joinWorktreeRows, EMPTY_GIT_BADGE, type MissionLastCommit, type MissionModel, type MissionState, type WorktreeRow } from "./model.ts";
import { SessionDied } from "../runner/runner.ts";

// The alias types below exist only so MissionDeps can spell `typeof <fn>`
// without pulling every dependency in as a runtime import: each module
// still supplies the real function to the driver at construction time.
type OpenSessionFn = (view: string, model: unknown) => Promise<SessionHandle>;
type DaemonQueryFn = typeof daemonQuery;
type SubscribeFn = (onEvent: (ev: DaemonEvent) => void, opts?: { onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void }) => DaemonSubscription;
type RunActionFn = (cwd: string, kind: ActionKind, opts: { remote?: string; branch: string | null }) => Promise<{ ok: boolean; detail: string }>;
type CommitStagedFn = (cwd: string, message: string, opts?: { amend?: boolean; noVerify?: boolean; allowEmpty?: boolean; coAuthors?: string[] }) => string;
type AmendStagedFn = (cwd: string, opts?: { message?: string; noVerify?: boolean }) => string;
type GuardFn = typeof checkBranchGuard;
type StageFileFn = (cwd: string, path: string) => void;
type UnstageFileFn = (cwd: string, path: string, origPath?: string) => void;

export interface MissionDeps {
  openSession: OpenSessionFn;
  /** createGitClient, or a fake bound per test/worktree. */
  client: (dir: string) => GitClient;
  daemonQuery: DaemonQueryFn;
  subscribe: SubscribeFn;
  runAction: RunActionFn;
  commit: CommitStagedFn;
  amend: AmendStagedFn;
  guard: GuardFn;
  now: () => Date;
  /** Whole-file `git add` (commit-ops' stagePath): covers untracked and binary files the patch pipeline cannot. */
  stageFile: StageFileFn;
  /** Whole-file `git reset -q HEAD` (commit-ops' unstagePath): the only unstage git-core's forward-only patches allow. */
  unstageFile: UnstageFileFn;
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
}

interface WorktreePayload {
  path?: string;
  new?: boolean;
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

interface DriverState extends MissionState {
  confirmDiscard: ConfirmDiscard | null;
}

/** Second `mission:discard` for the same target must land within this window to execute; a late or mismatched one just re-arms. */
const DISCARD_CONFIRM_WINDOW_MS = 5000;

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
  private snapshot: RepoSnapshot = EMPTY_SNAPSHOT;
  private branches: BranchInfo[] = [];
  private stashCount = 0;
  private lastCommit: MissionLastCommit | null = null;
  private stagingDiff: StagingDiff | null = null;
  private action: ActionState = { kind: "fetch", title: "Fetch origin", meta: "Never fetched", ahead: 0, behind: 0 };
  private refreshingBadges = false;

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
    };
  }

  async run(): Promise<void> {
    await this.refresh();
    const session = await this.deps.openSession("mission", this.model());
    this.session = session;
    const sub = this.deps.subscribe((ev) => {
      if (ev.type !== "git-status") return;
      void this.onGitStatus();
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
      await this.refreshBadges();
      this.push();
    } finally {
      this.refreshingBadges = false;
    }
  }

  private push(): void {
    this.session?.push(this.model());
  }

  private model(): MissionModel {
    return buildModel({
      state: this.state,
      rows: this.rows,
      snapshot: this.snapshot,
      branches: this.branches,
      guards: new Map(),
      worktrees: this.worktreeRows(),
      stagingDiff: this.stagingDiff,
      stashes: this.stashCount,
      lastCommit: this.lastCommit,
      action: this.action,
    });
  }

  private worktreeRows(): WorktreeRow[] {
    return joinWorktreeRows(this.trees, this.currentRepoBadges());
  }

  private currentRepoBadges(): GitWorktreeBadge[] {
    return this.rows.find((r) => r.repo === this.state.currentRepo)?.worktrees ?? [];
  }

  private currentBadge(): GitWorktreeBadge {
    const badges = this.currentRepoBadges();
    return badges.find((w) => w.worktree === this.state.currentWorktree) ?? badges[0] ?? EMPTY_GIT_BADGE;
  }

  private async guardBranch(branch: string): Promise<BranchGuardVerdict> {
    const cwd = this.state.currentWorktree;
    return this.deps.guard({
      cwd,
      branch,
      defaultBranch: getRemoteDefaultBranch(cwd),
      runners: createStackGuardRunners(createRealProbes()),
    });
  }

  /** Repos, snapshot, branches, stashes, and last commit -- everything but the diff for the current pane. */
  private async refresh(): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    const [statusRes, treesRes, snapshot, branches, stashes, log] = await Promise.all([
      this.deps.daemonQuery("repos:status", {}),
      this.deps.daemonQuery("worktree:list", { repoName: this.state.currentRepo }),
      client.snapshot(),
      client.branches(),
      client.stashes(),
      client.log({ maxCount: 1 }),
    ]);
    if (statusRes?.ok) this.rows = (statusRes.data?.repos as RepoStatusRow[] | undefined) ?? [];
    if (treesRes?.ok) this.trees = (treesRes.data?.trees as WorktreeTreeRow[] | undefined) ?? [];
    this.snapshot = snapshot;
    // Seed the diff pane on open (and after a checkout/worktree/repo switch
    // cleared it): the first change is what the view's cursor starts on.
    if (this.state.selectedPath === null) this.state.selectedPath = snapshot.files[0]?.path ?? null;
    this.branches = branches;
    this.stashCount = stashes.length;
    const entry = log[0];
    this.lastCommit = entry
      ? { summary: entry.subject, when: entry.authorDate, undoable: (snapshot.ahead ?? 0) > 0 }
      : null;
    await this.refreshDiff(client);
    this.recomputeAction();
  }

  /** Just the badges/snapshot a repos:status sweep changed -- the git-status subscription's own refresh, cheaper than a full seed. */
  private async refreshBadges(): Promise<void> {
    const client = this.deps.client(this.state.currentWorktree);
    const [statusRes, snapshot] = await Promise.all([this.deps.daemonQuery("repos:status", {}), client.snapshot()]);
    if (statusRes?.ok) this.rows = (statusRes.data?.repos as RepoStatusRow[] | undefined) ?? [];
    this.snapshot = snapshot;
    this.recomputeAction();
  }

  private async refreshDiff(client: GitClient): Promise<void> {
    this.stagingDiff = this.state.selectedPath ? await client.stagingDiff(this.state.selectedPath) : null;
  }

  private recomputeAction(): void {
    this.action = deriveAction({
      badge: this.currentBadge(),
      remoteName: "origin",
      detached: this.snapshot.detached,
      unborn: this.snapshot.branch === null && !this.snapshot.detached,
      pullRebase: false,
      forcePushRecommended: this.state.forcePushRecommended,
      busy: this.state.busyAction,
    });
  }

  // Cleared unconditionally so a stale notice (an old refusal, an armed
  // discard prompt) never survives an unrelated intent; a handler that needs
  // it to persist (a refusal, a re-arm) sets it again below, after this.
  private async handle(intent: SessionIntent): Promise<void> {
    this.state.notice = "";
    switch (intent.name) {
      case "mission:action":
        await this.handleAction();
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
      default:
        break;
    }
  }

  private async handleAction(): Promise<void> {
    const kind = this.action.kind;
    this.state.busyAction = true;
    this.recomputeAction();
    this.push();

    const result = await this.deps.runAction(this.state.currentWorktree, kind, { branch: this.snapshot.branch });
    this.state.busyAction = false;
    if (!result.ok) {
      this.state.notice = result.detail;
    } else {
      this.state.notice = "";
      if (kind === "push" || kind === "force-push") this.state.forcePushRecommended = false;
      await this.refresh();
    }
    this.recomputeAction();
    this.push();
  }

  /**
   * The file's persisted DiffSelection, or a seed derived from its current
   * staged state: a fully staged file reads all-selected (so toggle-file
   * unstages it), anything with unstaged or untracked content reads
   * none-selected, because its staging diff's lines are by definition not in
   * the index yet. Seeds are not stored; the map holds only genuinely
   * divergent selections, and a stage/discard drops the entry so the next
   * touch re-seeds from the refreshed snapshot.
   */
  private currentSelection(path: string): DiffSelection {
    const existing = this.state.selections.get(path);
    if (existing) return existing;
    const file = this.snapshot.files.find((f) => f.path === path);
    const fullyStaged = file !== undefined && file.staged && !file.unstaged;
    return DiffSelection.fromInitialSelection(fullyStaged ? DiffSelectionType.All : DiffSelectionType.None);
  }

  private async handleStage(payload: StagePayload | undefined): Promise<void> {
    if (!payload || typeof payload.path !== "string") return;
    const cwd = this.state.currentWorktree;
    const client = this.deps.client(cwd);
    const current = this.currentSelection(payload.path);

    if (payload.mode === "toggle-file") {
      // Whole-file staging bypasses the line-patch pipeline: git add/reset
      // also cover binary and untracked files, and an unstage cannot be
      // expressed as a forward cached patch at all.
      if (current.getSelectionType() === DiffSelectionType.All) {
        const file = this.snapshot.files.find((f) => f.path === payload.path);
        this.deps.unstageFile(cwd, payload.path, file?.originalPath);
      } else {
        this.deps.stageFile(cwd, payload.path);
      }
      this.state.selections.delete(payload.path);
      await this.refreshSnapshotAndDiff(client);
      this.push();
      return;
    }

    const diff = await client.stagingDiff(payload.path);
    let next: DiffSelection | null = null;
    if (payload.mode === "line" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      next = current.withToggleLineSelection(target.absoluteIndex);
      if (!next.isSelected(target.absoluteIndex)) {
        // The toggle deselected the pressed line: an unstage, which the
        // forward-only cached patch cannot express at line granularity.
        this.state.notice = "unstaging a single line is not supported yet";
        this.push();
        return;
      }
    } else if (payload.mode === "hunk" && typeof payload.selIdx === "number") {
      const target = resolveCompactedSelIdx(diff, payload.selIdx);
      if (current.isRangeSelected(target.hunkStart, target.hunkLength) === DiffSelectionType.All) {
        this.state.notice = "unstaging a hunk is not supported yet";
        this.push();
        return;
      }
      next = current.withRangeSelection(target.hunkStart, target.hunkLength, true);
    }
    // formatPatch throws on an empty selection, so an all-None result never
    // reaches stageSelection.
    if (!next || next.getSelectionType() === DiffSelectionType.None) return;

    await client.stageSelection(diff, next);
    this.state.selections.delete(payload.path);
    await this.refreshSnapshotAndDiff(client);
    this.push();
  }

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
    this.state.selections.delete(payload.path);
    this.state.notice = "";
    await this.refresh();
    this.push();
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
        this.state.notice = verdict.detail;
        this.push();
        return;
      }
    }

    const cwd = this.state.currentWorktree;
    const message = payload.description ? `${payload.summary}\n\n${payload.description}` : payload.summary;
    if (payload.amend) {
      this.deps.amend(cwd, { message });
      this.state.forcePushRecommended = true;
    } else {
      this.deps.commit(cwd, message);
    }

    this.state.summary = "";
    this.state.description = "";
    this.state.amending = false;
    this.state.notice = "";
    await this.refresh();
    this.push();
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
    if (typeof payload.branch !== "string") {
      // The "new branch from…" action row (new:true/from) has no creation
      // flow wired yet -- v1 answers it with a notice, not silence.
      this.state.notice = "use rt worktree provision";
      this.push();
      return;
    }
    const verdict = await this.guardBranch(payload.branch);
    if (verdict.verdict === "refuse") {
      this.state.notice = verdict.detail;
      this.push();
      return;
    }
    const client = this.deps.client(this.state.currentWorktree);
    await client.checkoutBranch(payload.branch);
    this.state.notice = "";
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async handleWorktree(payload: WorktreePayload | undefined): Promise<void> {
    if (!payload) return;
    if (typeof payload.path !== "string") {
      // The "provision new worktree…" action row (new:true) has no
      // provisioning flow wired yet -- v1 answers it with a notice.
      this.state.notice = "use rt worktree provision";
      this.push();
      return;
    }
    this.state.currentWorktree = payload.path;
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async handleRepo(payload: RepoPayload | undefined): Promise<void> {
    if (!payload || typeof payload.repo !== "string") return;
    this.state.currentRepo = payload.repo;
    const row = this.rows.find((r) => r.repo === payload.repo);
    if (row?.worktrees[0]) this.state.currentWorktree = row.worktrees[0].worktree;
    this.state.selectedPath = null;
    this.state.selections = new Map();
    await this.refresh();
    this.push();
  }

  private async handleSelect(payload: SelectPayload | undefined): Promise<void> {
    if (!payload) return;
    if (typeof payload.filter === "string") this.state.filter = payload.filter;
    if (typeof payload.path === "string") {
      this.state.selectedPath = payload.path === "" ? null : payload.path;
      const client = this.deps.client(this.state.currentWorktree);
      await this.refreshDiff(client);
    }
    if (payload.showOversized === true && this.state.selectedPath) this.state.showOversized.add(this.state.selectedPath);
    if (payload.showOversized === false && this.state.selectedPath) this.state.showOversized.delete(this.state.selectedPath);
    this.push();
  }

  private async refreshSnapshotAndDiff(client: GitClient): Promise<void> {
    this.snapshot = await client.snapshot();
    await this.refreshDiff(client);
    this.recomputeAction();
  }
}
