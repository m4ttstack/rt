import { simpleGit, type SimpleGit } from "simple-git";
import { getSnapshot } from "./snapshot.ts";
import { getFileDiff } from "./diff.ts";
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
    branches: () => unimplemented("branches"),
    tags: () => unimplemented("tags"),
    log: () => unimplemented("log"),
    stashes: () => unimplemented("stashes"),
    fetchState: () => unimplemented("fetchState"),
  };
}
