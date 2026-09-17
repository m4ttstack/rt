import { simpleGit, type SimpleGit } from "simple-git";
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
    snapshot: () => unimplemented("snapshot"),
    diffFile: () => unimplemented("diffFile"),
    branches: () => unimplemented("branches"),
    tags: () => unimplemented("tags"),
    log: () => unimplemented("log"),
    stashes: () => unimplemented("stashes"),
    fetchState: () => unimplemented("fetchState"),
  };
}
