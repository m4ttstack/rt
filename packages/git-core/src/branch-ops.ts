import type { ClientContext } from "./client.ts";

export async function checkoutBranch(ctx: ClientContext, name: string): Promise<void> {
  await ctx.git.checkout([name]);
}

export async function createBranch(
  ctx: ClientContext,
  name: string,
  opts?: { from?: string; checkout?: boolean },
): Promise<void> {
  const args = opts?.from ? [name, opts.from] : [name];
  await ctx.git.branch(args);
  if (opts?.checkout) await ctx.git.checkout([name]);
}
