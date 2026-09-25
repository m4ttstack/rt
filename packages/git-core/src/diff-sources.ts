import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ClientContext } from "./client.ts";
import { rawGit } from "./exec.ts";
import type { DiffSources } from "./types.ts";
import type { CommittedFileChange } from "./vendor/ghd/log-parse.ts";
import { AppFileStatusKind } from "./vendor/ghd/types.ts";

export const DIFF_SOURCE_MAX_BYTES = 256 * 1024;

function textOnly(text: string): string | undefined {
  return text.includes("\0") ? undefined : text;
}

/**
 * The file at `rev` ("" = the index), or undefined when the path does not
 * exist there (a root commit's parent, a file added by the commit), is over
 * the cap, or is binary. A missing path is the expected case, not an error.
 */
export async function readRevisionFile(ctx: ClientContext, rev: string, path: string): Promise<string | undefined> {
  const spec = `${rev}:${path}`;
  try {
    const size = Number((await rawGit(ctx.dir, ["cat-file", "-s", spec])).trim());
    if (!Number.isFinite(size) || size > DIFF_SOURCE_MAX_BYTES) return undefined;
    return textOnly(await rawGit(ctx.dir, ["cat-file", "blob", spec]));
  } catch {
    return undefined;
  }
}

export async function readWorkingFile(ctx: ClientContext, path: string): Promise<string | undefined> {
  const full = join(ctx.dir, path);
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > DIFF_SOURCE_MAX_BYTES) return undefined;
    return textOnly(await readFile(full, "utf8"));
  } catch {
    return undefined;
  }
}

export async function workingDiffSources(
  ctx: ClientContext,
  path: string,
  how: { untracked: boolean; renamed: boolean },
): Promise<DiffSources> {
  const [oldText, newText] = await Promise.all([
    how.untracked ? Promise.resolve(undefined) : readRevisionFile(ctx, how.renamed ? "" : "HEAD", path),
    readWorkingFile(ctx, path),
  ]);
  return { old: oldText, new: newText };
}

export async function commitDiffSources(
  ctx: ClientContext,
  file: CommittedFileChange,
  oldRev: string,
  newRev: string,
): Promise<DiffSources> {
  const moved = file.status.kind === AppFileStatusKind.Renamed || file.status.kind === AppFileStatusKind.Copied;
  const oldPath = moved ? file.status.oldPath : file.path;
  const [oldText, newText] = await Promise.all([
    readRevisionFile(ctx, oldRev, oldPath),
    readRevisionFile(ctx, newRev, file.path),
  ]);
  return { old: oldText, new: newText };
}
