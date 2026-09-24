import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ClientContext } from "./client.ts";
import type { FetchState } from "./types.ts";
import { rawGit } from "./exec.ts";

// FETCH_HEAD lives in the common dir so linked worktrees share it.
export async function getFetchState(ctx: ClientContext): Promise<FetchState> {
  const commonDirRaw = (await rawGit(ctx.dir, ["rev-parse", "--git-common-dir"])).trim();
  const commonDir = isAbsolute(commonDirRaw) ? commonDirRaw : join(ctx.dir, commonDirRaw);
  try {
    const s = await stat(join(commonDir, "FETCH_HEAD"));
    // git empties FETCH_HEAD before it connects, so a fetch that failed
    // leaves it empty with a fresh mtime; only a written one is a fetch.
    return { lastFetchedAt: s.size > 0 ? s.mtime.toISOString() : null };
  } catch {
    return { lastFetchedAt: null };
  }
}
