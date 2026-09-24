import type { ClientContext } from "./client.ts";
import { rawGitOr128 } from "./discard.ts";
import { hasGitExitCode, isGitExitCode, rawGit } from "./exec.ts";
import type { DesktopStashEntry } from "./types.ts";
import { createLogParser, parseRawLogWithNumstat, type CommittedFileChange } from "./vendor/ghd/log-parse.ts";

/** GHD app/src/lib/git/stash.ts; a stash made here shows in GitHub Desktop and the reverse. */
export const DesktopStashEntryMarker = "!!GitHub_Desktop";

const desktopStashEntryMessageRe = /!!GitHub_Desktop<(.+)>$/;

/** dugite's GitError.LocalChangesOverwritten pattern (lib/errors.js), unflagged as dugite applies it. */
const localChangesOverwrittenRe = new RegExp(
  "error: (?:Your local changes to the following|The following untracked working tree) files would be overwritten by checkout:",
);

/** dugite's GitError.MergeConflicts pattern, the one error GHD's popStashEntry expects. */
const mergeConflictsRe = new RegExp("(Merge conflict|Automatic merge failed; fix conflicts and then commit the result)");

export function createDesktopStashMessage(branchName: string): string {
  return `${DesktopStashEntryMarker}<${branchName}>`;
}

function extractBranchFromMessage(message: string): string | null {
  const match = desktopStashEntryMessageRe.exec(message);
  return match === null || match[1]!.length === 0 ? null : match[1]!;
}

/** GHD getStashes without stashEntryCount; newest first (reflog order). */
export async function getDesktopStashes(ctx: ClientContext): Promise<DesktopStashEntry[]> {
  const { formatArgs, parse } = createLogParser({ name: "%gD", stashSha: "%H", message: "%gs", tree: "%T", parents: "%P" });
  const stdout = await rawGitOr128(ctx.dir, ["log", "-g", ...formatArgs, "refs/stash", "--"]);
  if (stdout === null) return [];
  const entries: DesktopStashEntry[] = [];
  for (const { name, message, stashSha, tree, parents } of parse(stdout)) {
    const branchName = extractBranchFromMessage(message);
    if (branchName !== null) {
      entries.push({ name, stashSha, branchName, tree, parents: parents.length > 0 ? parents.split(" ") : [] });
    }
  }
  return entries;
}

export async function getLastDesktopStashEntryForBranch(ctx: ClientContext, branchName: string): Promise<DesktopStashEntry | null> {
  return (await getDesktopStashes(ctx)).find((e) => e.branchName === branchName) ?? null;
}

/**
 * GHD createDesktopStashEntry. Untracked files are staged first so the stash
 * carries them without `-u`. Exit 1 with no `error: ` line counts as created,
 * GHD's own rule (it also holds for an unborn repo, which callers refuse).
 */
export async function createDesktopStashEntry(
  ctx: ClientContext,
  branchName: string,
  untrackedPaths: ReadonlyArray<string>,
): Promise<boolean> {
  if (untrackedPaths.length > 0) {
    await rawGit(ctx.dir, ["update-index", "--add", "--remove", "--replace", "-z", "--stdin"], { stdin: untrackedPaths.join("\0") });
  }
  let stdout: string;
  try {
    stdout = await rawGit(ctx.dir, ["stash", "push", "-m", createDesktopStashMessage(branchName)]);
  } catch (e) {
    if (!isGitExitCode(e, 1) || /^error: /m.test(e.stderr)) throw e;
    stdout = e.stdout;
  }
  return stdout !== "No local changes to save\n";
}

async function entryMatchingSha(ctx: ClientContext, stashSha: string): Promise<DesktopStashEntry | null> {
  return (await getDesktopStashes(ctx)).find((e) => e.stashSha === stashSha) ?? null;
}

export async function dropDesktopStashEntry(ctx: ClientContext, stashSha: string): Promise<void> {
  const entry = await entryMatchingSha(ctx, stashSha);
  if (entry !== null) await rawGit(ctx.dir, ["stash", "drop", entry.name]);
}

/** GHD popStashEntry: a conflicted pop exits 1 with empty stderr and git keeps the entry, so it is dropped here. */
export async function popStashEntry(ctx: ClientContext, stashSha: string): Promise<void> {
  const entry = await entryMatchingSha(ctx, stashSha);
  if (entry === null) return;
  try {
    await rawGit(ctx.dir, ["stash", "pop", "--quiet", entry.name]);
  } catch (e) {
    if (!hasGitExitCode(e)) throw e;
    if (mergeConflictsRe.test(e.stderr) || mergeConflictsRe.test(e.stdout)) return;
    if (e.exitCode === 1 && e.stderr.length === 0) {
      await dropDesktopStashEntry(ctx, stashSha);
      return;
    }
    throw e;
  }
}

export async function getStashedFiles(ctx: ClientContext, stashSha: string): Promise<CommittedFileChange[]> {
  const stdout = await rawGit(ctx.dir, [
    "stash", "show", stashSha, "--raw", "--numstat", "-z", "--format=format:", "--no-show-signature", "--",
  ]);
  return [...parseRawLogWithNumstat(stdout, stashSha, `${stashSha}^`).files];
}

export function isLocalChangesOverwrittenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const stderr = "stderr" in err && typeof (err as { stderr: unknown }).stderr === "string" ? (err as { stderr: string }).stderr : "";
  return localChangesOverwrittenRe.test(stderr) || localChangesOverwrittenRe.test(err.message);
}
