import type { StatusResult } from "simple-git";
import type { ClientContext } from "./client.ts";
import type { ChangedFile, FileStatusKind, RepoSnapshot } from "./types.ts";

// simple-git exposes per-file index/working_dir XY codes plus aggregate
// lists; the mapping below trusts the per-file codes and uses the
// aggregate `conflicted` list only to identify conflict paths.
function kindOf(index: string, workingDir: string, conflicted: boolean): FileStatusKind {
  if (conflicted) return "conflicted";
  if (index === "?" || workingDir === "?") return "untracked";
  // Working-tree deletion wins uniformly, regardless of index state
  // (AD, MD, RD all read as "deleted"), so this check must precede R/A.
  if (index === "D" || workingDir === "D") return "deleted";
  if (index === "R") return "renamed";
  if (index === "A") return "added";
  return "modified";
}

export function mapStatus(status: StatusResult): ChangedFile[] {
  const conflictedSet = new Set(status.conflicted);
  const renamedByTo = new Map(status.renamed.map((r) => [r.to, r.from]));
  return status.files.map((f) => {
    const conflicted = conflictedSet.has(f.path);
    const index = f.index ?? " ";
    const workingDir = f.working_dir ?? " ";
    const kind = kindOf(index, workingDir, conflicted);
    const file: ChangedFile = {
      path: f.path,
      kind,
      staged: !conflicted && index !== " " && index !== "?",
      unstaged: conflicted || (workingDir !== " " && workingDir !== "?") || kind === "untracked",
    };
    const from = renamedByTo.get(f.path);
    if (from !== undefined) file.originalPath = from;
    return file;
  });
}

export async function getSnapshot(ctx: ClientContext): Promise<RepoSnapshot> {
  const status = await ctx.git.status();
  const files = mapStatus(status);
  return {
    branch: status.detached ? null : status.current,
    detached: status.detached,
    upstream: status.tracking,
    ahead: status.tracking === null ? null : status.ahead,
    behind: status.tracking === null ? null : status.behind,
    files,
    clean: files.length === 0,
  };
}
