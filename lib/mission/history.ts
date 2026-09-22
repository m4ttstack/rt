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
