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
      branch: m ? m[1]! : null,
      message: m ? m[2]! : message,
    };
  });
}
