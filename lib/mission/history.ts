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
  /** Bumped only by a real reload (syncTip) or reset. Guards a slower sync in flight against a newer one that lands first. */
  private generation = 0;
  private pendingBatch: Promise<void> | null = null;
  private pendingBase: Commit[] | null = null;

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
    this.generation++;
  }

  /** Loads the first batch when nothing is loaded or HEAD moved; returns whether anything changed. */
  async syncTip(client: GitClient, branch: HistoryBranch): Promise<boolean> {
    const head = (await client.commits("HEAD", 1))[0]?.sha ?? null;
    if (this.loaded && head === this.tip) return false;
    const gen = ++this.generation;
    const [batch, local] = await Promise.all([client.commits("HEAD", COMMIT_BATCH_SIZE, 0), client.localCommits(branch)]);
    if (gen !== this.generation) return false;
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
    if (this.selection.length > 0 && this.selection.every((sha) => present.has(sha))) {
      // Always re-run for a kept multi-selection: a reload can make it contiguous
      // (load the range) or break it (select() clears to the non-contiguous
      // state) -- either way the previous changeset may no longer match reality.
      if (this.selection.length > 1) await this.select(client, this.selection);
      return;
    }
    const first = this.commits[0];
    await this.select(client, first ? [first.sha] : []);
  }

  /**
   * One page load in flight at a time. A caller joins the pending load only
   * while it still targets the current list (`pendingBase === this.commits`);
   * a reload swaps `commits` to a new array, so a stale pending load is left
   * to resolve into a no-op (see fetchNextBatch) and this starts a fresh one
   * rather than handing the caller a promise that can never grow the list.
   */
  loadNextBatch(client: GitClient, branch: HistoryBranch): Promise<void> {
    if (this.pendingBatch && this.pendingBase === this.commits) return this.pendingBatch;
    if (!this.hasMore) return Promise.resolve();
    const base = this.commits;
    const promise = this.fetchNextBatch(client, branch, base);
    this.pendingBatch = promise;
    this.pendingBase = base;
    promise.finally(() => {
      if (this.pendingBatch === promise) {
        this.pendingBatch = null;
        this.pendingBase = null;
      }
    });
    return promise;
  }

  private async fetchNextBatch(client: GitClient, branch: HistoryBranch, base: Commit[]): Promise<void> {
    const last = base.at(-1);
    let newCommits: Commit[] = [];
    let localAdditions: Commit[] = [];
    if (last && this.localShas.has(last.sha)) {
      const local = await client.localCommits(branch, base.length);
      localAdditions = local.filter((c) => !this.localShas.has(c.sha));
      newCommits = localAdditions;
    }
    if (newCommits.length === 0) {
      newCommits = await client.commits("HEAD", COMMIT_BATCH_SIZE, base.length);
    }
    // this.commits is only ever reassigned wholesale, never mutated: an identity
    // mismatch here means a reload or reset replaced the list while this fetch
    // awaited. Catches a load that started between a reload deciding to reload
    // and it writing the new list, which comparing generation numbers alone
    // would miss (the load would capture the already-bumped generation).
    if (this.commits !== base) return;
    for (const c of localAdditions) this.localShas.add(c.sha);
    const known = new Set(base.map((c) => c.sha));
    const fresh = newCommits.filter((c) => !known.has(c.sha));
    this.commits = [...base, ...fresh];
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
    // The key can still match after a reload re-selects the same shas (they
    // survived) yet a list change made them non-contiguous: the range result
    // no longer describes an adjacent selection, so drop it too.
    if (shas.length > 1 && !this.isContiguous()) return;
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
