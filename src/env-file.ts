import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** .env reader/writer shared by setup and the board server. The writer is a
    read-modify-write that preserves unrelated lines and comments: this file
    also holds tokens the current operation has nothing to do with. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

/** A key present in `updates` with an empty string value is a removal: its
    existing line is dropped and nothing is written for it, mirroring the
    old whole-file writer's `.filter(([, v]) => v)` falsy filter (this is how
    setup.ts signals "the user explicitly declined to keep this token"). Keys
    absent from `updates` are left untouched, same as any other update. */
export function upsertEnvKeys(path: string, updates: Record<string, string>): void {
  const pending = { ...updates };
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const next = lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [line];
    const eq = trimmed.indexOf("=");
    if (eq === -1) return [line];
    const key = trimmed.slice(0, eq);
    if (key in pending) {
      const value = pending[key]!;
      delete pending[key];
      return value === "" ? [] : [`${key}=${value}`];
    }
    return [line];
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [key, value] of Object.entries(pending)) {
    if (value === "") continue;
    next.push(`${key}=${value}`);
  }
  const tmp = path + ".tmp";
  writeFileSync(tmp, next.join("\n") + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
