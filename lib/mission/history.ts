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
  commits: readonly Commit[] = [];
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
  private pendingBase: readonly Commit[] | null = null;

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
    const entry = this.generation;
    const head = (await client.commits("HEAD", 1))[0]?.sha ?? null;
    // A reset() (or another reload) during this probe already changed what
    // loaded/tip mean; proceeding past it would apply this call's own
    // (now unrelated) worktree/client data onto whatever state reset left.
    if (this.generation !== entry) return false;
    if (this.loaded && head === this.tip) return false;
    const gen = ++this.generation;
    const [batch, local] = await Promise.all([client.commits("HEAD", COMMIT_BATCH_SIZE, 0), client.localCommits(branch)]);
    if (gen !== this.generation) return false;
    this.commits = batch;
    this.localShas = new Set(local.map((c) => c.sha));
    // The head probe and the batch fetch are separate git calls; HEAD can move
    // between them, so tip comes from the batch actually loaded, not the probe.
    this.tip = batch[0]?.sha ?? null;
    this.loaded = true;
    this.hasMore = batch.length === COMMIT_BATCH_SIZE;
    await this.updateOrSelectFirstCommit(client);
    return true;
  }

  private async updateOrSelectFirstCommit(client: GitClient): Promise<void> {
    const present = new Set(this.commits.map((c) => c.sha));
    if (this.selection.length > 0 && this.selection.every((sha) => present.has(sha))) {
      // A range's content depends only on its shas, not their position, so a
      // still-contiguous range with an already-loaded changeset is left alone
      // (a reload would otherwise reset the file cursor to the first file on
      // every tip move). Re-run only when it broke (clear to non-contiguous)
      // or is only now able to load (was cleared while non-contiguous).
      if (this.selection.length > 1 && (!this.isContiguous() || this.changeset === null)) {
        await this.select(client, this.selection);
      }
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
    const clear = (): void => {
      if (this.pendingBatch === promise) {
        this.pendingBatch = null;
        this.pendingBase = null;
      }
    };
    // Both handlers, never .finally: .finally's derived promise re-rejects and
    // nothing holds it, so a page failure the caller already caught would also
    // surface as an unhandled rejection here.
    promise.then(clear, clear);
    return promise;
  }

  private async fetchNextBatch(client: GitClient, branch: HistoryBranch, base: readonly Commit[]): Promise<void> {
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
    // awaited.
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
