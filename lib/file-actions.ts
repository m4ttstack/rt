import { spawnSync as realSpawnSync } from "child_process";

export interface FileActions {
  copy(text: string): void;
  reveal(absPath: string, kind?: "file" | "folder"): void;
  open(absPath: string): void;
}

export function createFileActions(spawnSync: typeof realSpawnSync = realSpawnSync): FileActions {
  return {
    copy: (text) => {
      spawnSync("pbcopy", [], { input: text });
    },
    reveal: (absPath, kind = "file") => {
      spawnSync("open", kind === "file" ? ["-R", absPath] : [absPath], { stdio: "ignore" });
    },
    open: (absPath) => {
      spawnSync("open", [absPath], { stdio: "ignore" });
    },
  };
}
