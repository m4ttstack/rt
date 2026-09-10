import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Checked in order after PATH, when `claude` is not on it. */
export const CLAUDE_BIN_FALLBACKS = [
  join(homedir(), ".claude", "local", "claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

export function resolveClaudeBin(): string | null {
  const onPath = Bun.which("claude");
  if (onPath) return onPath;
  return CLAUDE_BIN_FALLBACKS.find((path) => existsSync(path)) ?? null;
}
