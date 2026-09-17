import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import { DiffParser } from "./vendor/ghd/diff-parser.ts";
import type { DiffSelection } from "./vendor/ghd/diff-selection.ts";
import { AppFileStatusKind } from "./vendor/ghd/types.ts";
import { formatPatch, formatPatchToDiscardChanges } from "./vendor/ghd/patch-formatter.ts";
import type { StagingDiff } from "./types.ts";

const APPLY_FLAGS = ["--unidiff-zero", "--whitespace=nowarn", "-"];

export async function getStagingDiff(ctx: ClientContext, path: string): Promise<StagingDiff> {
  const status = await ctx.git.status();
  const untracked = status.not_added.includes(path);
  const text = untracked
    ? await rawGit(ctx.dir, ["diff", "--no-index", "--", "/dev/null", path], { okCodes: [1] })
    : await ctx.git.diff(["--", path]);

  if (/^Binary files .* differ$/m.test(text)) {
    return { path, kind: "binary", untracked, hunks: [] };
  }
  if (/^(old|new) mode 160000$/m.test(text) || /^index [0-9a-f.]+ 160000$/m.test(text)) {
    return { path, kind: "submodule", untracked, hunks: [] };
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

  if (opts.originalPath !== undefined) {
    // Clears any index entry left at the old path -- `--ignore-unmatch`
    // makes this idempotent whether the rename is already staged (e.g. a
    // prior `git mv`) or not (a same-content deleted+untracked pair) --
    // then re-parents the original blob under the new path so `-M`
    // detection still sees a rename once the content patch below lands.
    await rawGit(ctx.dir, ["rm", "--cached", "--ignore-unmatch", "--", opts.originalPath]);
    const lsTree = await rawGit(ctx.dir, ["ls-tree", "HEAD", "--", opts.originalPath]);
    const match = /^(\S+) blob (\S+)\t/.exec(lsTree);
    if (!match) {
      throw new Error(`could not resolve HEAD blob for rename source: ${opts.originalPath}`);
    }
    const [, mode, oid] = match;
    await rawGit(ctx.dir, ["update-index", "--add", "--cacheinfo", `${mode},${oid},${diff.path}`]);
  }

  const kind = diff.untracked ? AppFileStatusKind.Untracked : AppFileStatusKind.Modified;
  const patch = formatPatch({ path: diff.path, status: { kind }, selection }, { hunks: diff.hunks });
  await rawGit(ctx.dir, ["apply", "--cached", ...APPLY_FLAGS], { stdin: patch });
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
