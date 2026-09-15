/**
 * Where the user's repos go. rt validates a path the user picked; it never
 * picks one.
 *
 * The chosen path is staged under the runtime dir rather than written to the
 * machine store, because that store lives inside the home repo and creating it
 * before `home.init` clones would make the clone fail on a non-empty target.
 */
import { join } from "path";
import { setSetting } from "../settings/write.ts";
import { homeGitDir } from "./steps/home.ts";
import type { Probes } from "./probes.ts";

export const CANDIDATE_ROOT_NAMES = ["Documents/GitHub", "GitHub", "code", "src"];

/** Directories macOS gates behind TCC. rt holds Full Disk Access, so rt never meets the prompts these cause for the user's other tools. */
const TCC_PROTECTED = ["Documents", "Desktop", "Downloads"];

export type RootStat = { isDirectory: boolean; writable: boolean } | null;

export function expandHome(p: Pick<Probes, "home">, path: string): string {
  if (path.startsWith("~/")) return join(p.home, path.slice(2));
  if (path.startsWith("${home}/")) return join(p.home, path.slice(8));
  return path;
}

export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };

export function checkRepoRoot(p: Pick<Probes, "home" | "statPath">, raw: string): RootCheck {
  const path = expandHome(p, raw.trim());
  if (path === "") return { ok: false, detail: "no path given" };
  const s = p.statPath(path);
  if (s === null) return { ok: false, detail: `${path} does not exist` };
  if (!s.isDirectory) return { ok: false, detail: `${path} is not a directory` };
  if (!s.writable) return { ok: false, detail: `${path} is not writable` };

  // Anchored under home: only the user's own TCC-gated directories count, so
  // an unrelated /srv/Documents is not warned about.
  const rel = path.startsWith(`${p.home}/`) ? path.slice(p.home.length + 1) : "";
  const gated = TCC_PROTECTED.find((d) => rel === d || rel.startsWith(`${d}/`));
  return {
    ok: true,
    path,
    tccWarning: gated
      ? `${gated} is protected by macOS privacy controls, so your editor, terminal git and other tools may need permission to reach repos here`
      : null,
  };
}

export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null {
  return CANDIDATE_ROOT_NAMES.map((rel) => join(p.home, rel)).find((path) => p.exists(path)) ?? null;
}

function stagedPath(home: string): string {
  return join(home, ".mattstack", "rt", "repo-root.json");
}

export function readStagedRepoRoot(p: Pick<Probes, "home" | "readFile">): string | null {
  const raw = p.readFile(stagedPath(p.home));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { root?: unknown };
    return typeof parsed.root === "string" && parsed.root !== "" ? parsed.root : null;
  } catch {
    return null;
  }
}

export function stageRepoRoot(p: Probes, path: string): void {
  const target = stagedPath(p.home);
  p.mkdirp(join(p.home, ".mattstack", "rt"));
  p.writeFile(target, JSON.stringify({ root: path }), 0o600);
}

export function clearStagedRepoRoot(p: Probes): void {
  p.removeFile(stagedPath(p.home));
}

/**
 * Moves a staged answer into the store, once. Carries the same home-repo guard
 * the verb does: the machine store's file lives inside the home repo, so
 * writing it before the clone exists makes that clone fail on a non-empty
 * target. Every writer of rt.repoRoots goes through this guard or the verb's.
 */
export function promoteStagedRepoRoot(p: Probes): boolean {
  const staged = readStagedRepoRoot(p);
  if (staged === null) return false;
  if (!p.exists(homeGitDir(p.home))) return false;
  setSetting("rt.repoRoots", [staged], "machine");
  clearStagedRepoRoot(p);
  return true;
}
