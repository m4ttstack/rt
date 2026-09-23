import { spawnSync as realSpawnSync } from "child_process";

/** Each action reports whether its process exited 0. */
export interface FileActions {
  copy(text: string): boolean;
  reveal(absPath: string, kind?: "file" | "folder"): boolean;
  open(absPath: string): boolean;
}

export function createFileActions(spawnSync: typeof realSpawnSync = realSpawnSync): FileActions {
  return {
    copy: (text) => spawnSync("pbcopy", [], { input: text }).status === 0,
    reveal: (absPath, kind = "file") => spawnSync("open", kind === "file" ? ["-R", absPath] : [absPath], { stdio: "ignore" }).status === 0,
    open: (absPath) => spawnSync("open", [absPath], { stdio: "ignore" }).status === 0,
  };
}
