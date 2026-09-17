import { simpleGit, type SimpleGit } from "simple-git";
import { getSnapshot } from "./snapshot.ts";
import { getFileDiff } from "./diff.ts";
import { getBranches, getTags } from "./refs.ts";
import { getLog } from "./log.ts";
import type { GitClient } from "./types.ts";

export interface ClientContext {
  dir: string;
  git: SimpleGit;
}

type Method<K extends keyof GitClient> = GitClient[K];

function unimplemented(name: string): never {
  throw new Error(`git-core: ${name} not implemented yet`);
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
    stashes: () => unimplemented("stashes"),
    fetchState: () => unimplemented("fetchState"),
  };
}
