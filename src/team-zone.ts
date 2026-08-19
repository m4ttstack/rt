import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Member } from "./config.ts";

/** The team-owned fields a mattstack team zone publishes, materialized
    verbatim into the board's own config. */
export interface TeamZone {
  gitlabHost: string;
  projects: string[];
  members: Member[];
  title: string;
}

const TEAM_FIELDS = ["gitlabHost", "projects", "members", "title"] as const;

/** Strip full-line `//` comments from JSONC text. Only lines whose trimmed
    content starts with `//` are removed -- a `//` inside a string value (e.g.
    a `https://` URL) is left alone since it never starts the line. */
export function stripJsonc(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** Directories to search for `mattstack/team.jsonc`: the clone root, then
    each immediate subdirectory (one level deep), in sorted order for a
    deterministic result when more than one would match. */
function candidatePaths(cloneDir: string): string[] {
  const paths = [join(cloneDir, "mattstack", "team.jsonc")];
  let subdirs: string[] = [];
  try {
    subdirs = readdirSync(cloneDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    subdirs = [];
  }
  for (const name of subdirs) paths.push(join(cloneDir, name, "mattstack", "team.jsonc"));
  return paths;
}

function validateZone(parsed: unknown, path: string): TeamZone {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`team.jsonc at ${path} must contain a JSON object`);
  }
  const z = parsed as Partial<TeamZone>;
  if (typeof z.gitlabHost !== "string" || !z.gitlabHost) {
    throw new Error(`team.jsonc at ${path} is missing required field "gitlabHost"`);
  }
  if (!Array.isArray(z.projects) || z.projects.some((p) => typeof p !== "string")) {
    throw new Error(`team.jsonc at ${path} "projects" must be an array of strings`);
  }
  if (!Array.isArray(z.members) || z.members.length === 0) {
    throw new Error(`team.jsonc at ${path} is missing required field "members"`);
  }
  for (const member of z.members) {
    if (!member || typeof member !== "object" || typeof (member as Member).username !== "string" || !(member as Member).username) {
      throw new Error(`team.jsonc at ${path} has a member with no "username"`);
    }
  }
  if (typeof z.title !== "string" || !z.title) {
    throw new Error(`team.jsonc at ${path} is missing required field "title"`);
  }
  return { gitlabHost: z.gitlabHost, projects: z.projects, members: z.members as Member[], title: z.title };
}

/** Locate and parse the team zone under a mattstack team clone. Searches
    `mattstack/team.jsonc` at `cloneDir`'s root, then one level deep under
    each of its immediate subdirectories. Throws a descriptive error naming
    every path searched when the zone is absent, and a descriptive error
    naming the file when its content is invalid. */
export function readTeamZone(cloneDir: string): TeamZone {
  const candidates = candidatePaths(cloneDir);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`no mattstack/team.jsonc found under ${cloneDir} (searched: ${candidates.join(", ")})`);
  }
  const raw = readFileSync(found, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch (err) {
    throw new Error(`team.jsonc at ${found} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateZone(parsed, found);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Rewrite only the four team-owned fields (`gitlabHost`, `projects`,
 * `members`, `title`) in the board config at `configPath` to match the team
 * zone found under `cloneDir`. Every other field, and the file's existing
 * key order, is preserved -- values are replaced in place, never
 * deleted/reinserted. Writes only when something actually changed
 * (temp-file-plus-rename, like `saveSwitchboardUrl`), so re-running against
 * an already-current config is a no-op.
 */
export function materializeTeamConfig(cloneDir: string, configPath: string): { changed: boolean; fields: string[] } {
  const zone = readTeamZone(cloneDir);
  const raw = readFileSync(configPath, "utf8");
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const fields: string[] = [];
  for (const key of TEAM_FIELDS) {
    if (!deepEqual(obj[key], zone[key])) {
      obj[key] = zone[key];
      fields.push(key);
    }
  }
  // A materialized `members` can drop the very user `defaultMember` names,
  // which would otherwise make loadConfig() hard-throw on next boot (spec
  // §6, never crash boot). Reset to "all" when that happens and report it,
  // same as any other rewritten field.
  if (fields.includes("members")) {
    const defaultMember = obj.defaultMember;
    if (typeof defaultMember === "string" && defaultMember !== "all" && !zone.members.some((m) => m.username === defaultMember)) {
      obj.defaultMember = "all";
      fields.push("defaultMember");
    }
  }
  if (fields.length === 0) return { changed: false, fields: [] };
  const text = JSON.stringify(obj, null, 2) + "\n";
  writeFileSync(configPath + ".tmp", text);
  renameSync(configPath + ".tmp", configPath);
  return { changed: true, fields };
}

/** Expand a possibly `~`-prefixed team-clone path to an absolute directory.
    Same rule the boot hook (src/server.ts materializeTeamConfigAtBoot) uses. */
export function resolveCloneDir(teamClone: string): string {
  return teamClone.startsWith("~") ? join(homedir(), teamClone.slice(1)) : teamClone;
}

export type MaterializeOnDemandResult = { ok: true; changed: boolean; fields: string[] } | { ok: false; reason: string };

/**
 * On-demand materialize (BOARD-16): the same materialize the board's boot
 * hook runs, callable outside of a board restart. Reads `teamClone` out of
 * `configPath` the same minimal way the boot hook does (a raw JSON pre-read,
 * not the full loadConfig validation) and refuses with a clear reason when
 * it's unset -- there is no zone to materialize from. Otherwise delegates to
 * materializeTeamConfig for the actual rewrite.
 *
 * Note this does not itself take effect anywhere: a running board only reads
 * config.json once, at boot, so the caller (bin/materialize.ts) reminds the
 * operator a restart is what picks the change up.
 */
export function materializeOnDemand(configPath: string): MaterializeOnDemandResult {
  let teamClone: unknown;
  try {
    teamClone = (JSON.parse(readFileSync(configPath, "utf8")) as { teamClone?: unknown }).teamClone;
  } catch (err) {
    return { ok: false, reason: `could not read ${configPath}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof teamClone !== "string" || !teamClone) {
    return { ok: false, reason: `config.json has no "teamClone" set -- nothing to materialize from` };
  }
  return { ok: true, ...materializeTeamConfig(resolveCloneDir(teamClone), configPath) };
}
