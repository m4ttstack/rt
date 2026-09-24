import { join } from "path";
import { stripJsonc } from "./sources.ts";

export type RepoRef = { host: string; path: string; slug: string };

export function parseRemote(url: string): RepoRef | null {
  let u = url.trim();
  if (u.endsWith(".git")) u = u.slice(0, -4);
  for (const scheme of ["ssh://", "https://", "http://", "git://"]) {
    if (u.startsWith(scheme)) { u = u.slice(scheme.length); break; }
  }
  const at = u.indexOf("@");
  if (at !== -1) u = u.slice(at + 1);
  u = u.replace(":", "/");
  const slash = u.indexOf("/");
  if (slash === -1 || slash === u.length - 1) return null;
  const host = u.slice(0, slash).toLowerCase();
  const path = u.slice(slash + 1);
  return { host, path, slug: `${host}-${path.replaceAll("/", "-")}` };
}

export type InitFs = {
  exists(p: string): boolean;
  readFile(p: string): string | null;
  writeFile(p: string, text: string): void;
  mkdirp(p: string): void;
  readDir(p: string): string[];
};

export type ZoneInfo = {
  slug: string;
  namespace: string;
  dir: string;
  host: string | null;
  projects: string[];
  marketplace: string | null;
  hasPack: boolean;
};

function readJsonc(fs: InitFs, path: string): Record<string, unknown> | null {
  const raw = fs.readFile(path);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(stripJsonc(raw));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hostOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase() || null;
}

function zoneHasPack(fs: InitFs, dir: string): boolean {
  const packs = join(dir, "mattstack", "packs");
  return fs.readDir(packs).some((name) => fs.exists(join(packs, name, ".claude-plugin", "plugin.json")));
}

export function readZones(fs: InitFs, home: string): ZoneInfo[] {
  const teams = join(home, ".mattstack", "teams");
  const zones: ZoneInfo[] = [];
  for (const slug of fs.readDir(teams)) {
    const dir = join(teams, slug);
    const marker = readJsonc(fs, join(dir, "mattstack", "mattstack.jsonc"));
    if (marker?.role !== "team") continue;
    const namespace = typeof marker.namespace === "string" && marker.namespace ? marker.namespace : slug;
    const shim = readJsonc(fs, join(dir, "mattstack", "team.jsonc"));
    const settings = readJsonc(fs, join(dir, "mattstack", "settings.team.jsonc"));
    const forge = (settings?.["mattstack.integrations"] as { forge?: { host?: unknown } } | undefined)?.forge;
    const host = hostOnly(shim?.gitlabHost) ?? hostOnly(forge?.host);
    const projects = Array.isArray(shim?.projects) ? shim.projects.filter((p): p is string => typeof p === "string") : [];
    const market = readJsonc(fs, join(dir, ".claude-plugin", "marketplace.json"));
    const marketplace = typeof market?.name === "string" ? market.name : null;
    zones.push({ slug, namespace, dir, host, projects, marketplace, hasPack: zoneHasPack(fs, dir) });
  }
  return zones;
}

export type ZoneChoice =
  | { kind: "found"; zone: ZoneInfo }
  | { kind: "ambiguous"; zones: ZoneInfo[] }
  | { kind: "missing" }
  | { kind: "mismatch"; zone: ZoneInfo }
  | { kind: "has-pack"; zone: ZoneInfo };

export function chooseZone(zones: ZoneInfo[], repo: RepoRef, wanted: string | null): ZoneChoice {
  const onHost = (z: ZoneInfo) => z.host === null || z.host === repo.host;
  const declares = (z: ZoneInfo) => z.projects.includes(repo.path);
  if (wanted) {
    const named = zones.find((z) => z.slug === wanted);
    if (!named) return { kind: "missing" };
    if (!onHost(named)) return { kind: "mismatch", zone: named };
    if (named.hasPack && !declares(named)) return { kind: "has-pack", zone: named };
    return { kind: "found", zone: named };
  }
  const declared = zones.filter((z) => onHost(z) && declares(z));
  if (declared.length === 1) return { kind: "found", zone: declared[0]! };
  if (declared.length > 1) return { kind: "ambiguous", zones: declared };
  const candidates = zones.filter((z) => onHost(z) && !z.hasPack);
  if (candidates.length === 1) return { kind: "found", zone: candidates[0]! };
  if (candidates.length > 1) return { kind: "ambiguous", zones: candidates };
  return { kind: "missing" };
}
