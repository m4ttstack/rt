import type { ClientContext } from "./client.ts";
import type { StashEntry } from "./types.ts";

// simple-git's stashList message may carry a leading "stash@{n}: " prefix
// (version-dependent); strip it before matching the "On <branch>: ..." shape.
const STASH_PREFIX = /^stash@\{\d+\}: /;
const ON_BRANCH = /^(?:WIP on|On) ([^:]+): (.*)$/;

export async function getStashes(ctx: ClientContext): Promise<StashEntry[]> {
  const list = await ctx.git.stashList();
  return list.all.map((entry, index) => {
    const message = entry.message.replace(STASH_PREFIX, "");
    const m = ON_BRANCH.exec(message);
    return {
      index,
      branch: m && m[1] !== "(no branch)" ? m[1]! : null,
      message: m ? m[2]! : message,
    };
  });
}

const NOTHING_TO_STASH = "No local changes to save";

export async function stashPush(
  ctx: ClientContext,
  opts?: { message?: string; includeUntracked?: boolean },
): Promise<{ created: boolean }> {
  const args = [
    "push",
    ...(opts?.message ? ["-m", opts.message] : []),
    ...(opts?.includeUntracked ? ["-u"] : []),
  ];
  const out = await ctx.git.stash(args);
  return { created: !out.includes(NOTHING_TO_STASH) };
}

export async function stashApply(ctx: ClientContext, index: number): Promise<void> {
  await ctx.git.stash(["apply", `stash@{${index}}`]);
}

export async function stashPop(ctx: ClientContext, index: number): Promise<void> {
  await ctx.git.stash(["pop", `stash@{${index}}`]);
}

export async function stashDrop(ctx: ClientContext, index: number): Promise<void> {
  await ctx.git.stash(["drop", `stash@{${index}}`]);
}
