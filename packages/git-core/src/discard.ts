import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ClientContext } from "./client.ts";
import { isGitExitCode, rawGit } from "./exec.ts";
import type { ChangedFile } from "./types.ts";

const NULL_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// GHD diff-index.ts's IndexStatus, order preserved so the numeric values match.
enum IndexStatus {
  Unknown = 0,
  Added,
  Copied,
  Deleted,
  Modified,
  Renamed,
  TypeChanged,
  Unmerged,
}

type NoRenameIndexStatus =
  | IndexStatus.Added
  | IndexStatus.Deleted
  | IndexStatus.Modified
  | IndexStatus.TypeChanged
  | IndexStatus.Unmerged
  | IndexStatus.Unknown;

function getIndexStatus(status: string): IndexStatus {
  switch (status[0]) {
    case "A":
      return IndexStatus.Added;
    case "C":
      return IndexStatus.Copied;
    case "D":
      return IndexStatus.Deleted;
    case "M":
      return IndexStatus.Modified;
    case "R":
      return IndexStatus.Renamed;
    case "T":
      return IndexStatus.TypeChanged;
    case "U":
      return IndexStatus.Unmerged;
    case "X":
      return IndexStatus.Unknown;
    default:
      throw new Error(`Unknown index status: ${status}`);
  }
}

function getNoRenameIndexStatus(status: string): NoRenameIndexStatus {
  const parsed = getIndexStatus(status);
  if (parsed === IndexStatus.Copied || parsed === IndexStatus.Renamed) {
    throw new Error(`Invalid index status for no-rename index status: ${parsed}`);
  }
  return parsed;
}

/** GHD diff-index.ts's getIndexChanges: staged changes vs HEAD (or the null tree, for an unborn HEAD). */
export async function getIndexChanges(ctx: ClientContext): Promise<Map<string, NoRenameIndexStatus>> {
  const args = ["diff-index", "--cached", "--name-status", "--no-renames", "-z"];
  let stdout: string;
  try {
    stdout = await rawGit(ctx.dir, [...args, "HEAD", "--"]);
  } catch (error) {
    // Exit 128 alone means an unborn HEAD; anything else (a spawn failure,
    // a signal, a real git error) is not that, and must not be read as one.
    if (!isGitExitCode(error, 128)) throw error;
    stdout = await rawGit(ctx.dir, [...args, NULL_TREE_SHA]);
  }

  const map = new Map<string, NoRenameIndexStatus>();
  const pieces = stdout.split("\0");
  for (let i = 0; i < pieces.length - 1; i += 2) {
    const status = getNoRenameIndexStatus(pieces[i]!);
    const path = pieces[i + 1]!;
    map.set(path, status);
  }
  return map;
}

/** GHD reset.ts's resetPaths, narrowed to the Mixed mode discardChanges always uses. */
async function resetPaths(ctx: ClientContext, ref: string, paths: ReadonlyArray<string>): Promise<void> {
  if (paths.length === 0) return;
  await rawGit(ctx.dir, ["reset", ref, "--", ...paths]);
}

/** GHD checkout-index.ts's checkoutIndex: paths NUL-joined on stdin to dodge argv length limits. */
async function checkoutIndex(ctx: ClientContext, paths: ReadonlyArray<string>): Promise<void> {
  if (paths.length === 0) return;
  await rawGit(ctx.dir, ["checkout-index", "-f", "-u", "-q", "--stdin", "-z"], {
    stdin: paths.join("\0"),
    okCodes: [1],
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** GHD submodule.ts's listSubmodules: top-level submodule paths, [] when the repo has none. */
export async function listSubmodules(ctx: ClientContext): Promise<ReadonlyArray<{ path: string }>> {
  const [submodulesFile, submodulesDir] = await Promise.all([
    pathExists(join(ctx.dir, ".gitmodules")),
    pathExists(join(ctx.dir, ".git", "modules")),
  ]);

  if (!submodulesFile && !submodulesDir) {
    // A linked worktree keeps its modules dir in the common git dir rather
    // than under .git/, so this checks there too before giving up.
    const gitDir = (await rawGit(ctx.dir, ["rev-parse", "--absolute-git-dir"])).trim();
    const commonDir = await readFile(join(gitDir, "commondir"), "utf8")
      .then((content) => content.replace(/\r?\n$/, ""))
      .then((path) => (path ? resolve(gitDir, path) : null))
      .catch(() => null);

    if (!commonDir || !(await pathExists(join(commonDir, "modules")))) {
      return [];
    }
  }

  let stdout: string;
  try {
    stdout = await rawGit(ctx.dir, ["submodule", "status", "--"]);
  } catch (error) {
    // Exit 128 alone means git gave up parsing submodules; anything else
    // must surface, since a wrongly-empty result here can send a real
    // submodule's whole working directory to the Trash as a plain file.
    if (!isGitExitCode(error, 128)) throw error;
    return [];
  }

  const submodules: { path: string }[] = [];
  const statusRe = /^.([^ ]+) (.+) \((.+?)\)$/gm;
  for (const match of stdout.matchAll(statusRe)) {
    submodules.push({ path: match[2]! });
  }
  return submodules;
}

/** GHD submodule.ts's resetSubmodulePaths. */
async function resetSubmodulePaths(ctx: ClientContext, paths: ReadonlyArray<string>): Promise<void> {
  if (paths.length === 0) return;
  await rawGit(ctx.dir, ["submodule", "update", "--recursive", "--force", "--", ...paths]);
}

// Shared by discardChanges' normal completion and its partial-failure
// recovery below: resets and checks out exactly the paths already trashed
// (or, for a Deleted file, never needing the Trash at all).
async function runDiscardGitSteps(
  ctx: ClientContext,
  submodules: ReadonlyArray<{ path: string }>,
  pathsToCheckout: ReadonlyArray<string>,
  pathsToReset: ReadonlyArray<string>,
): Promise<void> {
  const changedFilesInIndex = await getIndexChanges(ctx);

  const necessaryPathsToReset = pathsToReset.filter((x) => changedFilesInIndex.has(x));

  const submodulePaths = pathsToCheckout.filter((p) => submodules.some((s) => s.path === p));

  // GHD's own filter, kept verbatim: a submodule path is excluded from
  // checkout only when its current index status is Added -- newly staged,
  // so there is no prior committed gitlink to check out.
  const necessaryPathsToCheckout = pathsToCheckout.filter(
    (x) => submodulePaths.indexOf(x) === -1 || changedFilesInIndex.get(x) !== IndexStatus.Added,
  );

  if (submodulePaths.length > 0) {
    await resetSubmodulePaths(ctx, submodulePaths);
  }
  await resetPaths(ctx, "HEAD", necessaryPathsToReset);
  await checkoutIndex(ctx, necessaryPathsToCheckout);
}

/**
 * GHD GitStore.discardChanges (app/src/lib/stores/git-store.ts 1545-1650),
 * with moveToTrash always on and no permanent-delete fallback: GHD catches a
 * Trash failure and falls back to `rm` for an untracked file, or silently
 * leaves a tracked one. This port instead finishes the reset/checkout-index
 * steps for every file already moved to the Trash before the failing one,
 * then rethrows -- each file ends either fully discarded or fully untouched,
 * never left trashed with its index/working-tree state stale.
 */
export async function discardChanges(
  ctx: ClientContext,
  files: ReadonlyArray<ChangedFile>,
  opts: { moveToTrash?: (absPath: string) => Promise<void> } = {},
): Promise<void> {
  const moveToTrash = opts.moveToTrash ?? trashItem;
  const pathsToCheckout: string[] = [];
  const pathsToReset: string[] = [];

  const submodules = await listSubmodules(ctx);

  for (const file of files) {
    const isSubmodule = submodules.some((s) => s.path === file.path);

    if (file.kind !== "deleted" && !isSubmodule) {
      try {
        await moveToTrash(join(ctx.dir, file.path));
      } catch (error) {
        await runDiscardGitSteps(ctx, submodules, pathsToCheckout, pathsToReset);
        throw error;
      }
    }

    if (file.kind === "renamed" && file.originalPath !== undefined) {
      // file.path is the rename's destination; the working copy at that path
      // was just trashed above, so only the index needs to forget it. The
      // old path is what gets checked back out.
      pathsToReset.push(file.path);
      pathsToCheckout.push(file.originalPath);
      pathsToReset.push(file.originalPath);
    } else {
      pathsToCheckout.push(file.path);
      pathsToReset.push(file.path);
    }
  }

  await runDiscardGitSteps(ctx, submodules, pathsToCheckout, pathsToReset);
}

async function trashItem(absPath: string): Promise<void> {
  const proc = Bun.spawn(["/usr/bin/trash", absPath], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`Could not move ${absPath} to the Trash${err.trim() ? `: ${err.trim()}` : ""}`);
}
