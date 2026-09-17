import type { ClientContext } from "./client.ts";
import { assertSafeCommitish, assertValidBranchName } from "./ref-guard.ts";

export async function checkoutBranch(ctx: ClientContext, name: string): Promise<void> {
  await assertValidBranchName(ctx.dir, name);
  await ctx.git.checkout([name]);
}

export async function createBranch(
  ctx: ClientContext,
  name: string,
  opts?: { from?: string; checkout?: boolean },
): Promise<void> {
  await assertValidBranchName(ctx.dir, name);
  if (opts?.from !== undefined) assertSafeCommitish(opts.from, "from");

  if (opts?.checkout) {
    // One atomic checkout -b: git does not create the branch when this
    // checkout fails, so a dirty conflicting tree can never strand it.
    await ctx.git.checkout(["-b", name, ...(opts.from !== undefined ? [opts.from] : [])]);
    return;
  }
  const args = opts?.from !== undefined ? [name, opts.from] : [name];
  await ctx.git.branch(args);
}
