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

export type RunResult = { code: number; stdout: string; stderr: string };

export type InitDeps = {
  fs: InitFs;
  home: string;
  gitRemote(repoDir: string): Promise<{ kind: "ok"; url: string } | { kind: "not-a-repo" } | { kind: "no-remote" }>;
  isTTY: boolean;
  promptZone(): Promise<{ name: string; remote: string }>;
  createZone(name: string, remote: string): Promise<{ slug: string; dir: string }>;
  engineDescription(engine: string): string | null;
  claude: ((args: string[]) => Promise<RunResult>) | null;
  registerRepo(repoDir: string): Promise<string>;
  materialize(repoName: string): Promise<{ ok: boolean; detail: string }>;
  compile(packDir: string, manifestPath: string): Promise<{ ok: boolean; errors: string[] }>;
  check(packDir: string, manifestPath: string): Promise<{ drift: boolean }>;
};

export type InitRefusalCode =
  | "not-a-repo" | "no-remote" | "zone-ambiguous" | "zone-missing" | "zone-mismatch" | "zone-has-pack"
  | "pack-exists" | "mattstack-missing" | "claude-missing";

export type InitOutcome =
  | {
      ok: true;
      pack: { name: string; dir: string; zone: string; marketplace: string };
      repo: { slug: string; manifest: string };
      wrote: string[];
      installed: { plugin: string; version: string };
      restartNeeded: true;
      tryNext: string;
    }
  | { ok: false; refused: true; code: InitRefusalCode; detail: string }
  | { ok: false; refused: false; code: "materialize-failed" | "compile-failed" | "check-drift" | "install-failed"; detail: string; wrote: string[] };

function refuse(code: InitRefusalCode, detail: string): InitOutcome {
  return { ok: false, refused: true, code, detail };
}

/** Anchored to the CLI's own "already ..." phrasings so a failing call that merely mentions the word does not read as success. */
function isAlreadyDone(res: RunResult): boolean {
  return /already (on disk|added|installed|exists)/i.test(`${res.stdout}\n${res.stderr}`);
}

async function marketplaceNames(claude: NonNullable<InitDeps["claude"]>): Promise<Set<string> | null> {
  const res = await claude(["plugin", "marketplace", "list", "--json"]);
  if (res.code !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map((m) => (m as { name?: unknown })?.name).filter((n): n is string => typeof n === "string"));
  } catch {
    return null;
  }
}

export async function initPack(opts: { repoDir: string; zone: string | null }, deps: InitDeps): Promise<InitOutcome> {
  const remote = await deps.gitRemote(opts.repoDir);
  if (remote.kind === "not-a-repo") return refuse("not-a-repo", `${opts.repoDir} is not a git checkout`);
  if (remote.kind === "no-remote") return refuse("no-remote", `${opts.repoDir} has no git remote; add one so the zone can declare it`);
  const repo = parseRemote(remote.url);
  if (!repo) return refuse("no-remote", `could not read a host and path from remote "${remote.url}"`);

  const workDescription = deps.engineDescription("work");
  if (workDescription === null) {
    return refuse("mattstack-missing", "the mattstack plugin is not installed, so the work engine cannot be read; run rt setup pack first");
  }
  if (!deps.claude) return refuse("claude-missing", "claude binary not found on PATH; install the Claude CLI, then re-run");
  const claude = deps.claude;

  let zones = readZones(deps.fs, deps.home);
  let choice = chooseZone(zones, repo, opts.zone);
  if (choice.kind === "missing" && opts.zone === null) {
    if (!deps.isTTY) {
      return refuse("zone-missing", `no team zone without a pack covers ${repo.host}; run rt team create <Name> --remote <url>, then re-run`);
    }
    const answer = await deps.promptZone();
    const created = await deps.createZone(answer.name, answer.remote);
    zones = readZones(deps.fs, deps.home);
    choice = chooseZone(zones, repo, created.slug);
  }
  if (choice.kind === "missing") return refuse("zone-missing", `no team zone named "${opts.zone}"`);
  if (choice.kind === "ambiguous") {
    return refuse("zone-ambiguous", `several zones could host this pack: ${choice.zones.map((z) => z.slug).join(", ")}; pass --zone <slug>`);
  }
  if (choice.kind === "mismatch") {
    return refuse("zone-mismatch", `zone "${choice.zone.slug}" is on ${choice.zone.host}, the repo is on ${repo.host}`);
  }
  if (choice.kind === "has-pack") {
    return refuse("zone-has-pack", `zone "${choice.zone.slug}" already carries a pack; a zone hosts one pack, so create a zone for this team (rt team create)`);
  }
  const zone = choice.zone;
  const pack = zone.namespace;
  const packDir = join(zone.dir, "mattstack", "packs", pack);
  if (zone.hasPack || deps.fs.exists(packDir)) {
    return refuse("pack-exists", `${join(zone.dir, "mattstack", "packs")} already holds this repo's pack; init never touches an existing pack (see mattstack:extending-a-pack)`);
  }
  const marketplace = zone.marketplace ?? zone.slug;

  const wrote: string[] = [];
  for (const [rel, text] of Object.entries(renderPackFiles({ pack, workDescription }))) {
    const full = join(packDir, rel);
    deps.fs.mkdirp(join(full, ".."));
    deps.fs.writeFile(full, text);
    wrote.push(full);
  }
  const teamPath = join(zone.dir, "mattstack", "team.jsonc");
  const teamBefore = deps.fs.readFile(teamPath);
  const teamAfter = declareRepo(teamBefore, repo);
  if (teamAfter !== teamBefore) { deps.fs.writeFile(teamPath, teamAfter); wrote.push(teamPath); }
  const marketPath = join(zone.dir, ".claude-plugin", "marketplace.json");
  const marketOnDisk = deps.fs.readFile(marketPath);
  const marketBefore = marketOnDisk ?? JSON.stringify({ name: marketplace, owner: { name: zone.slug }, plugins: [] }, null, 2) + "\n";
  const marketAfter = addMarketplacePlugin(marketBefore, pack, packDescription(pack));
  if (marketAfter !== marketOnDisk) { deps.fs.writeFile(marketPath, marketAfter); wrote.push(marketPath); }

  const failed = (code: "materialize-failed" | "compile-failed" | "check-drift" | "install-failed", detail: string): InitOutcome =>
    ({ ok: false, refused: false, code, detail, wrote });

  /** A daemon-backed dep can throw instead of returning a failure shape; the throw must still carry `wrote` forward, same as a returned failure. */
  const attempt = async <T>(code: "materialize-failed" | "compile-failed" | "check-drift" | "install-failed", fn: () => Promise<T>): Promise<{ value: T } | { outcome: InitOutcome }> => {
    try {
      return { value: await fn() };
    } catch (err) {
      return { outcome: failed(code, err instanceof Error ? err.message : String(err)) };
    }
  };

  const registered = await attempt("materialize-failed", () => deps.registerRepo(opts.repoDir));
  if ("outcome" in registered) return registered.outcome;
  const materializedAttempt = await attempt("materialize-failed", () => deps.materialize(registered.value));
  if ("outcome" in materializedAttempt) return materializedAttempt.outcome;
  const materialized = materializedAttempt.value;
  const manifestPath = join(deps.home, ".mattstack", "repos", repo.slug, "skills.jsonc");
  if (!materialized.ok || !deps.fs.exists(manifestPath)) {
    return failed("materialize-failed", `${materialized.detail}; expected ${manifestPath}`);
  }
  const compiledAttempt = await attempt("compile-failed", () => deps.compile(packDir, manifestPath));
  if ("outcome" in compiledAttempt) return compiledAttempt.outcome;
  const compiled = compiledAttempt.value;
  if (!compiled.ok) return failed("compile-failed", compiled.errors.join("\n"));
  const checkedAttempt = await attempt("check-drift", () => deps.check(packDir, manifestPath));
  if ("outcome" in checkedAttempt) return checkedAttempt.outcome;
  if (checkedAttempt.value.drift) return failed("check-drift", "rt skills check reports drift right after compile");

  const known = await attempt("install-failed", () => marketplaceNames(claude));
  if ("outcome" in known) return known.outcome;
  if (!known.value || !known.value.has(marketplace)) {
    const added = await attempt("install-failed", () => claude(["plugin", "marketplace", "add", zone.dir]));
    if ("outcome" in added) return added.outcome;
    if (added.value.code !== 0 && !isAlreadyDone(added.value)) {
      return failed("install-failed", `claude plugin marketplace add exited ${added.value.code}: ${added.value.stderr.trim()}`);
    }
  }
  const pluginId = `${pack}@${marketplace}`;
  const installed = await attempt("install-failed", () => claude(["plugin", "install", pluginId]));
  if ("outcome" in installed) return installed.outcome;
  if (installed.value.code !== 0 && !isAlreadyDone(installed.value)) {
    return failed("install-failed", `claude plugin install ${pluginId} exited ${installed.value.code}: ${installed.value.stderr.trim()}`);
  }

  return {
    ok: true,
    pack: { name: pack, dir: packDir, zone: zone.slug, marketplace },
    repo: { slug: repo.slug, manifest: manifestPath },
    wrote,
    installed: { plugin: pluginId, version: "0.1.0" },
    restartNeeded: true,
    tryNext: `/${pack}:work <ticket>`,
  };
}
