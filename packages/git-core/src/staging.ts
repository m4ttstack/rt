import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import { classifyDiffText } from "./diff-classify.ts";
import { DiffParser } from "./vendor/ghd/diff-parser.ts";
import type { DiffSelection } from "./vendor/ghd/diff-selection.ts";
import { AppFileStatusKind } from "./vendor/ghd/types.ts";
import { formatPatch, formatPatchToDiscardChanges } from "./vendor/ghd/patch-formatter.ts";
import type { StagingDiff } from "./types.ts";

const APPLY_FLAGS = ["--unidiff-zero", "--whitespace=nowarn", "-"];

/**
 * The file's full displayed diff, GHD-style (rt adopts GitHub Desktop's own
 * staging model wholesale, ratified 2026-09-21: `app/src/lib/git/diff.ts`'s
 * getWorkingDirectoryDiff, verified against the local clone). Staged or not
 * never affects what is shown here -- three cases, same as GHD's:
 *   - untracked: `--no-index -- /dev/null <path>` (the whole file as additions).
 *   - renamed: `git diff -- <path>` (against the INDEX, not HEAD). GHD's own
 *     comment calls this "technically incorrect, the best kind of incorrect":
 *     diffing against HEAD would need a rename-aware three-way comparison
 *     this doesn't attempt, so an already-staged edit to a renamed file is
 *     invisible here (matches GHD exactly, not a gap introduced here).
 *   - everything else (modified/deleted/copied/conflicted): `git diff HEAD
 *     -- <path>`, which is worktree vs HEAD and so includes staged AND
 *     unstaged changes together -- the point of the model: what you see is
 *     what you can select for the next commit, independent of the index.
 */
export async function getStagingDiff(ctx: ClientContext, path: string): Promise<StagingDiff> {
  const status = await ctx.git.status();
  const untracked = status.not_added.includes(path);
  const renamed = status.renamed.some((r) => r.to === path);
  const text = untracked
    ? await rawGit(ctx.dir, ["diff", "--no-index", "--", "/dev/null", path], { okCodes: [1] })
    : renamed
      ? await ctx.git.diff(["--", path])
      : await ctx.git.diff(["HEAD", "--", path]);

  const kind = classifyDiffText(text);
  if (kind !== "text") {
    return { path, kind, untracked, hunks: [] };
  }
  // DiffParser tolerates (and ignores) the `diff --git` / `index` preamble,
  // so the raw command output goes straight in.
  const hunks = text.trim() === "" ? [] : new DiffParser().parse(text).hunks;
  return { path, kind: "text", untracked, hunks };
}

export async function stageSelection(
  ctx: ClientContext,
  diff: StagingDiff,
  selection: DiffSelection,
  opts: { originalPath?: string } = {},
): Promise<void> {
  if (diff.kind !== "text") {
    throw new Error(`cannot line-stage ${diff.kind} file: ${diff.path}`);
  }

  if (opts.originalPath !== undefined && diff.untracked) {
    // An untracked diff was computed against /dev/null (all-additions,
    // hunk position 0). Applying that shape on top of the rename recipe's
    // pre-staged old-blob base would insert rather than replace, silently
    // duplicating content -- refuse before any index mutation runs.
    throw new Error(
      `cannot stage rename for untracked target ${diff.path}: the diff was computed against /dev/null; provide a tracked target (git mv) first`,
    );
  }

  if (opts.originalPath !== undefined) {
    // Resolved and validated before any index mutation: rm --cached first
    // would leave a rename source that was staged but never committed
    // stranded neither at the old path nor re-parented, once this lookup
    // then came back empty.
    const lsTree = await rawGit(ctx.dir, ["ls-tree", "HEAD", "--", opts.originalPath]);
    const match = /^(\S+) blob (\S+)\t/.exec(lsTree);
    if (!match) {
      throw new Error(`rename source not in HEAD: ${opts.originalPath}`);
    }
    const [, mode, oid] = match;

    // Snapshot both paths' index state before touching anything, so a
    // failure below (the content patch is stale against the re-parented
    // base) can be rolled back to exactly this instead of leaving the
    // pre-stage rename applied with no content change.
    const snapshot = await rawGit(ctx.dir, ["ls-files", "-s", "-z", "--", opts.originalPath, diff.path]);

    try {
      // Clears any index entry left at the old path -- `--ignore-unmatch`
      // makes this idempotent whether the rename is already staged (e.g. a
      // prior `git mv`) or not (a same-content deleted+untracked pair) --
      // then re-parents the original blob under the new path so `-M`
      // detection still sees a rename once the content patch below lands.
      await rawGit(ctx.dir, ["rm", "--cached", "--ignore-unmatch", "--", opts.originalPath]);
      await rawGit(ctx.dir, ["update-index", "--add", "--cacheinfo", `${mode},${oid},${diff.path}`]);
      await applyStagePatch(ctx, diff, selection);
    } catch (err) {
      await restoreIndexSnapshot(ctx, snapshot, [opts.originalPath, diff.path]);
      throw err;
    }
    return;
  }

  await applyStagePatch(ctx, diff, selection);
}

// Callers must have already rejected diff.kind !== "text" -- this only
// reads fields common to every StagingDiff, so no narrowed type is needed.
async function applyStagePatch(ctx: ClientContext, diff: StagingDiff, selection: DiffSelection): Promise<void> {
  const kind = diff.untracked ? AppFileStatusKind.Untracked : AppFileStatusKind.Modified;
  const patch = formatPatch({ path: diff.path, status: { kind }, selection }, { hunks: diff.hunks });
  await rawGit(ctx.dir, ["apply", "--cached", ...APPLY_FLAGS], { stdin: patch });
}

// `snapshot` is `ls-files -s -z` output for exactly `paths`, captured before
// any mutation. update-index accepts that same "mode SP sha SP stage TAB
// path" line back via --index-info, so restoring is feeding it straight
// through; a path absent from the snapshot (never staged to begin with)
// needs an explicit all-zero removal line instead, or it would stay behind
// at whatever the failed mutation left it at.
async function restoreIndexSnapshot(ctx: ClientContext, snapshot: string, paths: string[]): Promise<void> {
  const entries = snapshot.split("\0").filter((line) => line.length > 0);
  const present = new Set(entries.map((line) => line.slice(line.indexOf("\t") + 1)));
  const removals = paths
    .filter((path) => !present.has(path))
    .map((path) => `0 0000000000000000000000000000000000000000\t${path}`);
  const payload = [...entries, ...removals].map((line) => `${line}\0`).join("");
  await rawGit(ctx.dir, ["update-index", "-z", "--index-info"], { stdin: payload });
}

export async function discardSelection(
  ctx: ClientContext,
  diff: StagingDiff,
  selection: DiffSelection,
): Promise<void> {
  if (diff.untracked) {
    throw new Error(`cannot line-discard an untracked file: ${diff.path}`);
  }
  if (diff.kind !== "text") {
    throw new Error(`cannot line-discard ${diff.kind} file: ${diff.path}`);
  }

  const patch = formatPatchToDiscardChanges(diff.path, { hunks: diff.hunks }, selection);
  if (patch === null) return;
  // No `-R`: the reversal is already baked into the patch text, and it
  // targets the working tree, not the index (no `--cached`).
  await rawGit(ctx.dir, ["apply", ...APPLY_FLAGS], { stdin: patch });
}

/**
 * Stages path's FULL current content -- the "All" case of a GHD-style
 * commit-time index rebuild (the "Partial" case is stageSelection above; a
 * "None" selection needs no call at all). Mirrors GHD's own stageFiles
 * "normal" + "oldRenamed" steps (app/src/lib/git/update-index.ts): a rename
 * needs its old path force-removed from the index first (recreating the
 * move rather than leaving a stale entry behind), since the caller has
 * just reset the whole index to HEAD and HEAD still has the old name.
 * A bare `git add` on a plain path already handles new/modified/deleted
 * uniformly (it stages a removal for a path missing from the working
 * tree), so no branching is needed for those.
 */
export async function stageFileFully(ctx: ClientContext, path: string, originalPath?: string): Promise<void> {
  if (originalPath !== undefined) {
    await rawGit(ctx.dir, ["update-index", "--force-remove", "--", originalPath]);
  }
  await rawGit(ctx.dir, ["add", "--", path]);
}
