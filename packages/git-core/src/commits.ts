import type { ClientContext } from "./client.ts";
import { rawGit, rawGitOk } from "./exec.ts";
import { getBranches } from "./refs.ts";
import type { UndoResult } from "./types.ts";

async function isPushed(ctx: ClientContext): Promise<boolean> {
  const branches = await getBranches(ctx);
  const current = branches.find((b) => b.current);
  if (!current || current.upstream === null) return false;
  return rawGitOk(ctx.dir, ["merge-base", "--is-ancestor", "HEAD", current.upstream]);
}

export async function undoLastCommit(ctx: ClientContext): Promise<UndoResult> {
  if (await isPushed(ctx)) return { ok: false, reason: "pushed" };

  const parents = (await rawGit(ctx.dir, ["rev-list", "--parents", "-n", "1", "HEAD"])).trim().split(" ");
  if (parents.length === 1) return { ok: false, reason: "initial" };
  if (parents.length >= 3) return { ok: false, reason: "merge" };

  const undoneSha = (await rawGit(ctx.dir, ["rev-parse", "HEAD"])).trim();
  await ctx.git.reset(["--mixed", "HEAD~1"]);
  return { ok: true, undoneSha };
}

export async function resetToCommit(
  ctx: ClientContext,
  sha: string,
  mode: "soft" | "mixed" | "hard",
): Promise<void> {
  await ctx.git.reset([`--${mode}`, sha]);
}
