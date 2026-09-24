import { join } from "path";
import { applyEdits, modify } from "jsonc-parser";
import { stripJsonc } from "./sources.ts";

export type RepoRef = { host: string; path: string; slug: string };

/** Mirrors norm_url in merge-manifests.sh so the slug here is the one the per-repo manifest lands under. */
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

export const PIPELINE_STAGES = [
  "stage-provision",
  "stage-plan",
  "stage-gates",
  "stage-evidence",
  "stage-implement",
  "stage-self-review",
  "stage-ship",
  "stage-watch-ci",
] as const;

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

export function packDescription(pack: string): string {
  return `The ${pack} team pack for mattstack pipelines: the team's verb roster and bindings fragment, plus the domain fills bound to the generic stages.`;
}

export function renderPackFiles(opts: { pack: string; workDescription: string }): Record<string, string> {
  const { pack, workDescription } = opts;
  const plugin = { name: pack, version: "0.1.0", description: packDescription(pack), skills: "./skills/" };
  const stubs = { verbs: { work: { engine: "work", description: workDescription } } };
  const manifest = {
    version: 1,
    skills: { enabled: ["mattstack:work", "mattstack:model-tiering"] },
    pipelines: { feature: PIPELINE_STAGES.map((s) => `mattstack:${s}`) },
    bindings: {
      "mattstack:work": { tiering: "mattstack:model-tiering" },
      "mattstack:stage-watch-ci": { forge: "mattstack:ci-forge-gitlab" },
    },
  };
  return {
    ".claude-plugin/plugin.json": JSON.stringify(plugin, null, 2) + "\n",
    "PACK.md": renderPackMd(pack),
    "pack/surface.jsonc":
      "// Public verbs live under skills/; everything else under attachments/.\n" +
      "// Flip a verb with: rt skills surface set <verb> --public\n" +
      JSON.stringify({ public: ["work"] }, null, 2) + "\n",
    "pack/stubs.jsonc":
      "// Verb roster: rt skills compile renders one skill per entry from the named\n" +
      "// mattstack engine. Each description here is a placeholder seeded from the\n" +
      "// engine; rewrite it in your team's words.\n" +
      JSON.stringify(stubs, null, 2) + "\n",
    "pack/skills.jsonc":
      `// ${pack} bindings fragment. merge-manifests.sh folds it into the per-repo\n` +
      "// manifest at ~/.mattstack/repos/<slug>/skills.jsonc. Every domain slot is\n" +
      "// optional; bind one with rt skills bind (see mattstack:extending-a-pack).\n" +
      JSON.stringify(manifest, null, 2) + "\n",
  };
}

function renderPackMd(pack: string): string {
  return [
    `# ${pack} pack`,
    "",
    "Scaffolded by `rt skills init`. The roster (`pack/stubs.jsonc`) names one",
    "verb, `work`, compiled from the mattstack engine with every domain slot",
    "unbound, so `/" + pack + ":work` runs the generic pipeline until the team",
    "adds rules. The verb's description is a placeholder seeded from the",
    "engine; rewrite it in your team's words.",
    "",
    "- Add a rule, a verb, or reword one: `mattstack:extending-a-pack`.",
    "- How this pack came to be: `mattstack:creating-a-pack`.",
    "- Publish a change: `mattstack:editing-skills`.",
    "",
    "`skills/` holds public verbs, `attachments/` the compiled stages and the",
    "team's fills. Compiled files are overwritten by `rt skills compile`; edit",
    "the roster, the fragment, or a fill instead.",
    "",
  ].join("\n");
}

export function declareRepo(teamJsonc: string | null, repo: RepoRef): string {
  if (teamJsonc === null) {
    return (
      "// Team declaration read by merge-manifests.sh: which forge host and which\n" +
      "// projects this zone's packs bind into.\n" +
      JSON.stringify({ gitlabHost: `https://${repo.host}`, projects: [repo.path] }, null, 2) + "\n"
    );
  }
  const parsed = JSON.parse(stripJsonc(teamJsonc)) as { projects?: unknown };
  if (!Array.isArray(parsed.projects)) {
    return applyEdits(teamJsonc, modify(teamJsonc, ["projects"], [repo.path], FORMAT));
  }
  if (parsed.projects.includes(repo.path)) return teamJsonc;
  const edits = modify(teamJsonc, ["projects", parsed.projects.length], repo.path, { ...FORMAT, isArrayInsertion: true });
  return applyEdits(teamJsonc, edits);
}

export function addMarketplacePlugin(marketplaceJson: string, pack: string, description: string): string {
  const parsed = JSON.parse(stripJsonc(marketplaceJson)) as { plugins?: { name?: unknown }[] };
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  if (plugins.some((p) => p?.name === pack)) return marketplaceJson;
  const entry = { name: pack, source: `./mattstack/packs/${pack}`, description };
  const edits = modify(marketplaceJson, ["plugins", plugins.length], entry, { ...FORMAT, isArrayInsertion: true });
  return applyEdits(marketplaceJson, edits);
}
