import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** Hand-written lines are not written the way this file writes them: `KEY = v`
    is legal and bun's own .env loader trims around the `=` and strips one pair
    of surrounding quotes off the value. Reading it any other way hands back a
    key nothing ever matches. */
function stripQuotes(value: string): string {
  const q = value[0];
  if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) return value.slice(1, -1);
  return value;
}

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
    out[trimmed.slice(0, eq).trim()] = stripQuotes(trimmed.slice(eq + 1).trim());
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
    // Trimmed to match readEnvFile: an untrimmed "KEY " matches no update, so
    // the stale line would survive and the new value land beside it.
    const key = trimmed.slice(0, eq).trim();
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
  // The mode option only applies to a file this call creates, so a tmp left
  // behind by an earlier crash would carry its own (possibly loose) permissions
  // onto .env through the rename. chmod after the write settles it either way,
  // and a failed write takes the orphan with it rather than leaving tokens in a
  // stray file.
  const tmp = path + ".tmp";
  try {
    writeFileSync(tmp, next.join("\n") + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
