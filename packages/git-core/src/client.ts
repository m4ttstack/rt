import { simpleGit, type SimpleGit } from "simple-git";
import { getSnapshot } from "./snapshot.ts";
import { getFileDiff } from "./diff.ts";
import { getBranches, getTags } from "./refs.ts";
import { getLog } from "./log.ts";
import { getStashes } from "./stash.ts";
import { getFetchState } from "./fetch-state.ts";
import { getStagingDiff, stageSelection, discardSelection } from "./staging.ts";
import { undoLastCommit, resetToCommit } from "./commits.ts";
import type { GitClient } from "./types.ts";

export interface ClientContext {
  dir: string;
  git: SimpleGit;
}

export function createGitClient(dir: string): GitClient {
  const ctx: ClientContext = { dir, git: simpleGit({ baseDir: dir }) };
  return {
    dir,
    snapshot: () => getSnapshot(ctx),
    diffFile: (path, opts) => getFileDiff(ctx, path, opts),
    branches: () => getBranches(ctx),
    tags: () => getTags(ctx),
    log: (opts) => getLog(ctx, opts),
    stashes: () => getStashes(ctx),
    fetchState: () => getFetchState(ctx),
    stagingDiff: (path) => getStagingDiff(ctx, path),
    stageSelection: (diff, selection, opts) => stageSelection(ctx, diff, selection, opts),
    discardSelection: (diff, selection) => discardSelection(ctx, diff, selection),
    undoLastCommit: () => undoLastCommit(ctx),
    resetToCommit: (sha, mode) => resetToCommit(ctx, sha, mode),
  };
}
