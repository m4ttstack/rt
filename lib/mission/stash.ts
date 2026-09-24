import {
  isLocalChangesOverwrittenError,
  type CommittedFileChange,
  type DesktopStashEntry,
  type GitClient,
  type RepoSnapshot,
  type StagingDiff,
} from "../../packages/git-core/src/index.ts";

export type SwitchStrategy = "leave" | "bring";

/** GHD filter-changes-list.tsx onContextMenu's Stash All Changes enablement. */
export function canStash(snapshot: RepoSnapshot): boolean {
  return snapshot.files.length > 0 && snapshot.branch !== null && !snapshot.files.some((f) => f.kind === "conflicted");
}

export function untrackedPaths(snapshot: RepoSnapshot): string[] {
  return snapshot.files.filter((f) => f.kind === "untracked").map((f) => f.path);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * GHD app-store createStashAndDropPreviousEntry: the old entry goes only once
 * the new one exists, and each step fails on its own (two
 * performFailableOperation calls). A failed create throws; a failed drop
 * returns its notice, since the changes are already safe in the new entry.
 */
export async function createStashAndDropPreviousEntry(
  client: GitClient,
  branch: string,
  untracked: ReadonlyArray<string>,
): Promise<string> {
  const previous = await client.lastDesktopStashEntryForBranch(branch);
  const created = await client.createDesktopStashEntry(branch, untracked);
  if (!created || previous === null) return "";
  try {
    await client.dropDesktopStashEntry(previous.stashSha);
  } catch (err) {
    return `Your changes were stashed, but the previous stash could not be removed: ${message(err)}`;
  }
  return "";
}

/** GHD checkoutAndLeaveChanges: a failed stash is reported and the checkout still runs (performFailableOperation). */
export async function checkoutAndLeaveChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<string> {
  let notice = "";
  if (snapshot.branch !== null && snapshot.files.length > 0) {
    try {
      notice = await createStashAndDropPreviousEntry(client, snapshot.branch, untrackedPaths(snapshot));
    } catch (err) {
      notice = message(err);
    }
  }
  try {
    await client.checkoutBranch(target);
  } catch (err) {
    // Desktop reports each failed operation; one notice line must carry both.
    if (notice === "") throw err;
    throw new Error(`${message(err)} · ${notice}`);
  }
  return notice;
}

/** GHD checkoutAndBringChanges: the transient stash is tagged for the target and never replaces its own stash. */
export async function checkoutAndBringChanges(client: GitClient, target: string, snapshot: RepoSnapshot): Promise<void> {
  try {
    await client.checkoutBranch(target);
  } catch (checkoutError) {
    if (!isLocalChangesOverwrittenError(checkoutError)) throw checkoutError;
    const stash = (await client.createDesktopStashEntry(target, untrackedPaths(snapshot)))
      ? await client.lastDesktopStashEntryForBranch(target)
      : null;
    if (stash === null) throw checkoutError;
    await client.checkoutBranch(target);
    await client.popStashEntry(stash.stashSha);
  }
}

/** GHD git-store's currentBranchStashEntry and its lazily loaded files, plus the Changes-selection "stash" kind. */
export class StashStore {
  entry: DesktopStashEntry | null = null;
  files: CommittedFileChange[] | null = null;
  showing = false;
  selectedFile: CommittedFileChange | null = null;
  diff: StagingDiff | null = null;
  private oversized = new Set<string>();
  private generation = 0;

  reset(): void {
    this.generation++;
    this.entry = null;
    this.clearEntryState();
  }

  async load(client: GitClient, branch: string | null): Promise<void> {
    const gen = ++this.generation;
    const next = branch === null ? null : await client.lastDesktopStashEntryForBranch(branch);
    if (gen !== this.generation) return;
    if (next === null) {
      this.entry = null;
      this.clearEntryState();
      return;
    }
    if (this.entry?.stashSha === next.stashSha && this.files !== null) {
      this.entry = next;
      return;
    }
    const keepPath = this.selectedFile?.path;
    this.entry = next;
    this.files = null;
    this.selectedFile = null;
    this.diff = null;
    this.oversized = new Set();
    const files = await client.stashedFiles(next.stashSha);
    if (gen !== this.generation) return;
    this.files = files;
    if (this.showing) await this.select(client, keepPath);
  }

  async select(client: GitClient, path?: string): Promise<void> {
    const entry = this.entry;
    if (entry === null) return;
    this.showing = true;
    const files = this.files ?? [];
    const file = (path !== undefined ? files.find((f) => f.path === path) : undefined) ?? files[0] ?? null;
    this.selectedFile = file;
    this.diff = null;
    if (file === null) return;
    const diff = await client.commitDiff(file, entry.stashSha);
    if (this.entry?.stashSha === entry.stashSha && this.selectedFile === file) this.diff = diff;
  }

  hide(): void {
    this.showing = false;
  }

  showOversized(path: string): void {
    this.oversized.add(path);
  }

  isOversizedShown(path: string): boolean {
    return this.oversized.has(path);
  }

  private clearEntryState(): void {
    this.files = null;
    this.showing = false;
    this.selectedFile = null;
    this.diff = null;
    this.oversized = new Set();
  }
}
