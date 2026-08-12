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

export function upsertEnvKeys(path: string, updates: Record<string, string>): void {
  const pending = { ...updates };
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq);
    if (key in pending) {
      const value = pending[key]!;
      delete pending[key];
      return `${key}=${value}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [key, value] of Object.entries(pending)) next.push(`${key}=${value}`);
  const tmp = path + ".tmp";
  writeFileSync(tmp, next.join("\n") + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
