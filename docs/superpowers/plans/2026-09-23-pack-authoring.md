# Pack Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt skills init` scaffolds a team's zero-fill pack so `/<pack>:work` runs, and two mattstack skills (`creating-a-pack`, `extending-a-pack`) walk an author from nothing to that pack and then through adding rules in their own words.

**Architecture:** Deterministic scaffolding is a pure module (`lib/skills/init.ts`) with injected deps, wrapped by a thin command (`commands/skills-init.ts`) that reuses the existing compile, check, materialize, register, and plugin-install seams. `rt skills bind` gains a write into the team pack's fragment so a binding survives materialize and reaches teammates. The two skills are mattstack plugin skills written TDD-style (baseline first) under a scratch HOME so no baseline touches the live estate. A scratch end-to-end run proves the generic pipeline before either skill is written.

**Tech Stack:** Bun + TypeScript (rt), `jsonc-parser` for comment-preserving edits, `bun:test`, mattstack-skills (markdown skills, `tests/certify.sh`, `tests/desc-test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-23-pack-authoring-design.md`

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, skills, commits). Use `...` or rephrase.
- No `RT-`/`SKILLS-`/`BOARD-`/`MAT-` ticket ids in any shipped file.
- The two skills live in mattstack and must pass `tests/certify.sh <dir>` in stack mode: no team names, no personal names or home paths. Examples use `acme`.
- Skill descriptions are trigger-only, start with "Use when", third person, under 500 chars.
- Every new command module referenced from `lib/command-tree-def.ts` is also registered as a thunk in `lib/module-registry.ts`.
- `init` has no required positional, so no `omitBehavior`.
- `init` never commits. It never writes into an existing pack directory. One pack per zone; the pack is named after the zone's `namespace`.
- Roster on scaffold is `work` only, public. Bindings: `mattstack:work.tiering -> mattstack:model-tiering`, `mattstack:stage-watch-ci.forge -> mattstack:ci-forge-gitlab`, nothing else.
- Built or source `rt` is only ever run against a real machine through the normal dev wrapper; any scratch run uses `env -i HOME=<scratch> CLAUDE_CONFIG_DIR=<scratch>/.claude`.
- rt work happens on branch `pack-authoring` in worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/elrond`. mattstack-skills work happens on a branch `pack-authoring` in a worktree at `/Users/matt/Documents/GitHub/mattstack-skills/.claude/worktrees/pack-authoring`.
- Commit after every task.
- Execution order (ratified 2026-09-23): Tasks 1 to 6, then Task 14 (rt PR, merge, daemon restart), then Tasks 7 to 13 against the merged rt. Tasks 7 to 11 are driven by the orchestrating session from a herdr pane; the operator does only the one-time scratch login (Task 7 Step 2).

## Review Focus

1. A repo whose remote is `git@GitLab.com:Group/Sub/repo.git` (SSH form, mixed-case host) must resolve to host `gitlab.com`, path `Group/Sub/repo`, and the same slug `merge-manifests.sh` computes. Test in Task 1.
2. A zone whose `team.jsonc` is absent but whose `settings.team.jsonc` names a forge host must still be a candidate, and `init` must then create `team.jsonc`. Test in Task 1 (candidate) and Task 3 (creation).
3. A zone on the repo's host that already carries a pack must be skipped by detection (a second team never lands in it), and `--zone` naming it must refuse `zone-has-pack`. Test in Task 1 and Task 3.
4. When compile fails after files were written, the report must list every written path and exit 1, so the author can fix and re-run compile rather than re-run init (which would refuse on `pack-exists`). Test in Task 3.
5. `rt skills bind` on a team pack must land the binding in `pack/skills.jsonc`, or the next materialize drops it and teammates never get it. Test in Task 6.

---

## Task 1: Remote parsing and zone resolution (`lib/skills/init.ts`)

**Files:**
- Create: `lib/skills/init.ts`
- Test: `lib/skills/__tests__/init.test.ts`

**Interfaces:**
- Produces:
  - `type RepoRef = { host: string; path: string; slug: string }`
  - `parseRemote(url: string): RepoRef | null`
  - `type InitFs = { exists(p: string): boolean; readFile(p: string): string | null; writeFile(p: string, text: string): void; mkdirp(p: string): void; readDir(p: string): string[] }`
  - `type ZoneInfo = { slug: string; namespace: string; dir: string; host: string | null; projects: string[]; marketplace: string | null; hasPack: boolean }`
  - `readZones(fs: InitFs, home: string): ZoneInfo[]`
  - `chooseZone(zones: ZoneInfo[], repo: RepoRef, wanted: string | null): { kind: "found"; zone: ZoneInfo } | { kind: "ambiguous"; zones: ZoneInfo[] } | { kind: "missing" } | { kind: "mismatch"; zone: ZoneInfo } | { kind: "has-pack"; zone: ZoneInfo }`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/skills/__tests__/init.test.ts
import { describe, expect, test } from "bun:test";
import { chooseZone, parseRemote, readZones, type InitFs, type ZoneInfo } from "../init.ts";

function memFs(files: Record<string, string>): InitFs {
  const store = new Map(Object.entries(files));
  return {
    exists: (p) => store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/")),
    readFile: (p) => store.get(p) ?? null,
    writeFile: (p, text) => { store.set(p, text); },
    mkdirp: () => {},
    readDir: (p) => {
      const names = new Set<string>();
      for (const k of store.keys()) {
        if (!k.startsWith(p + "/")) continue;
        names.add(k.slice(p.length + 1).split("/")[0]!);
      }
      return [...names];
    },
  };
}

describe("parseRemote", () => {
  test("ssh form, mixed-case host, .git suffix", () => {
    expect(parseRemote("git@GitLab.com:Group/Sub/repo.git")).toEqual({
      host: "gitlab.com",
      path: "Group/Sub/repo",
      slug: "gitlab.com-Group-Sub-repo",
    });
  });
  test("https form with credentials", () => {
    expect(parseRemote("https://user:tok@gitlab.com/acme/api.git")).toEqual({
      host: "gitlab.com",
      path: "acme/api",
      slug: "gitlab.com-acme-api",
    });
  });
  test("no path is not a repo ref", () => {
    expect(parseRemote("gitlab.com")).toBeNull();
  });
});

const HOME = "/h";
const zoneFiles = (slug: string, extra: Record<string, string>, namespace = slug) => ({
  [`${HOME}/.mattstack/teams/${slug}/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "${namespace}", "org": "x" }`,
  [`${HOME}/.mattstack/teams/${slug}/.claude-plugin/marketplace.json`]: `{ "name": "${slug}-market", "owner": { "name": "x" }, "plugins": [] }`,
  ...extra,
});

describe("readZones", () => {
  test("host from team.jsonc gitlabHost, projects listed, namespace from the marker, no pack", () => {
    const fs = memFs(zoneFiles("acme", {
      [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `// shim\n{ "gitlabHost": "https://GitLab.com", "projects": ["acme/api"] }`,
    }, "acmens"));
    expect(readZones(fs, HOME)).toEqual([
      { slug: "acme", namespace: "acmens", dir: `${HOME}/.mattstack/teams/acme`, host: "gitlab.com", projects: ["acme/api"], marketplace: "acme-market", hasPack: false },
    ]);
  });
  test("host falls back to settings.team.jsonc forge host when team.jsonc is absent", () => {
    const fs = memFs(zoneFiles("beta", {
      [`${HOME}/.mattstack/teams/beta/mattstack/settings.team.jsonc`]: `// header\n{ "mattstack.integrations": { "forge": { "host": "gitlab.com", "provider": "gitlab" } } }`,
    }));
    expect(readZones(fs, HOME)[0]).toMatchObject({ slug: "beta", namespace: "beta", host: "gitlab.com", projects: [] });
  });
  test("a zone with a plugin.json under mattstack/packs/* has a pack", () => {
    const fs = memFs(zoneFiles("acme", {
      [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.5.0" }`,
    }));
    expect(readZones(fs, HOME)[0]!.hasPack).toBe(true);
  });
  test("a user-role zone is skipped", () => {
    const fs = memFs({
      [`${HOME}/.mattstack/teams/me/mattstack/mattstack.jsonc`]: `{ "role": "user" }`,
    });
    expect(readZones(fs, HOME)).toEqual([]);
  });
});

describe("chooseZone", () => {
  const repo = { host: "gitlab.com", path: "acme/api", slug: "gitlab.com-acme-api" };
  const z = (slug: string, host: string | null, projects: string[] = [], hasPack = false): ZoneInfo =>
    ({ slug, namespace: slug, dir: `/z/${slug}`, host, projects, marketplace: slug, hasPack });
  test("a zone already declaring the repo wins, pack or not", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com", ["acme/api"], true)], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com", ["acme/api"], true) });
  });
  test("a zone on the host that already has a pack is skipped", () => {
    const r = chooseZone([z("claim", "gitlab.com", ["acme/other"], true), z("fresh", "gitlab.com")], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("fresh", "gitlab.com") });
  });
  test("only packed zones on the host means missing", () => {
    expect(chooseZone([z("claim", "gitlab.com", ["acme/other"], true)], repo, null)).toEqual({ kind: "missing" });
  });
  test("two packless host matches is ambiguous", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, null);
    expect(r.kind).toBe("ambiguous");
  });
  test("--zone picks among candidates", () => {
    const r = chooseZone([z("a", "gitlab.com"), z("b", "gitlab.com")], repo, "b");
    expect(r).toEqual({ kind: "found", zone: z("b", "gitlab.com") });
  });
  test("--zone naming a zone on another host is a mismatch", () => {
    const r = chooseZone([z("gh", "github.com")], repo, "gh");
    expect(r).toEqual({ kind: "mismatch", zone: z("gh", "github.com") });
  });
  test("--zone naming a packed zone that does not declare the repo is has-pack", () => {
    const packed = z("claim", "gitlab.com", ["acme/other"], true);
    expect(chooseZone([packed], repo, "claim")).toEqual({ kind: "has-pack", zone: packed });
  });
  test("a zone with no host yet is a candidate", () => {
    const r = chooseZone([z("fresh", null)], repo, null);
    expect(r).toEqual({ kind: "found", zone: z("fresh", null) });
  });
  test("no candidates is missing", () => {
    expect(chooseZone([z("gh", "github.com")], repo, null)).toEqual({ kind: "missing" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: FAIL, `Cannot find module "../init.ts"`.

- [ ] **Step 3: Implement**

```ts
// lib/skills/init.ts
import { join } from "path";
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/init.ts lib/skills/__tests__/init.test.ts
git commit -m "skills init: remote parsing and zone resolution"
```

---

## Task 2: Pack file rendering and zone edits

**Files:**
- Modify: `lib/skills/init.ts`
- Test: `lib/skills/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `RepoRef` from Task 1.
- Produces:
  - `PIPELINE_STAGES: readonly string[]` (eight `stage-*` names in order)
  - `renderPackFiles(opts: { pack: string; workDescription: string }): Record<string, string>` (relative path to content)
  - `declareRepo(teamJsonc: string | null, repo: RepoRef): string`
  - `addMarketplacePlugin(marketplaceJson: string, pack: string, description: string): string`
  - `packDescription(pack: string): string`

- [ ] **Step 1: Write the failing tests** (append to `init.test.ts`)

```ts
import { addMarketplacePlugin, declareRepo, packDescription, PIPELINE_STAGES, renderPackFiles } from "../init.ts";
import { stripJsonc } from "../sources.ts";

describe("renderPackFiles", () => {
  const files = renderPackFiles({ pack: "acme", workDescription: "Use when running a unit of work." });
  test("writes exactly the five scaffold files", () => {
    expect(Object.keys(files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "PACK.md",
      "pack/skills.jsonc",
      "pack/stubs.jsonc",
      "pack/surface.jsonc",
    ]);
  });
  test("plugin.json is the pack's plugin at 0.1.0 serving ./skills/", () => {
    expect(JSON.parse(files[".claude-plugin/plugin.json"]!)).toEqual({
      name: "acme",
      version: "0.1.0",
      description: packDescription("acme"),
      skills: "./skills/",
    });
  });
  test("roster is work only, seeded from the engine description", () => {
    expect(JSON.parse(stripJsonc(files["pack/stubs.jsonc"]!))).toEqual({
      verbs: { work: { engine: "work", description: "Use when running a unit of work." } },
    });
    expect(JSON.parse(stripJsonc(files["pack/surface.jsonc"]!))).toEqual({ public: ["work"] });
  });
  test("bindings fragment carries enabled skills, the eight-stage pipeline, and only the two generic bindings", () => {
    const manifest = JSON.parse(stripJsonc(files["pack/skills.jsonc"]!));
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toEqual({ enabled: ["mattstack:work", "mattstack:model-tiering"] });
    expect(manifest.pipelines.feature).toEqual(PIPELINE_STAGES.map((s) => `mattstack:${s}`));
    expect(manifest.bindings).toEqual({
      "mattstack:work": { tiering: "mattstack:model-tiering" },
      "mattstack:stage-watch-ci": { forge: "mattstack:ci-forge-gitlab" },
    });
  });
  test("PACK.md names the two authoring skills, calls the description a placeholder, no dashes", () => {
    expect(files["PACK.md"]).toContain("mattstack:extending-a-pack");
    expect(files["PACK.md"]).toContain("mattstack:creating-a-pack");
    expect(files["PACK.md"]).toContain("placeholder");
    for (const text of Object.values(files)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("declareRepo", () => {
  const repo = { host: "gitlab.com", path: "acme/api", slug: "gitlab.com-acme-api" };
  test("creates the shim when absent", () => {
    const out = declareRepo(null, repo);
    expect(JSON.parse(stripJsonc(out))).toEqual({ gitlabHost: "https://gitlab.com", projects: ["acme/api"] });
    expect(out.startsWith("//")).toBe(true);
  });
  test("appends to an existing projects array, keeping comments and entries", () => {
    const before = `// keep me\n{\n  "gitlabHost": "https://gitlab.com",\n  "projects": ["acme/web"]\n}\n`;
    const out = declareRepo(before, repo);
    expect(out).toContain("// keep me");
    expect(JSON.parse(stripJsonc(out)).projects).toEqual(["acme/web", "acme/api"]);
  });
  test("adds a projects array when the shim has none", () => {
    const before = `{ "gitlabHost": "https://gitlab.com" }\n`;
    expect(JSON.parse(stripJsonc(declareRepo(before, repo))).projects).toEqual(["acme/api"]);
  });
  test("is a no-op when the repo is already declared", () => {
    const before = `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/api"] }\n`;
    expect(declareRepo(before, repo)).toBe(before);
  });
});

describe("addMarketplacePlugin", () => {
  const before = `{\n  "name": "acme",\n  "owner": { "name": "x" },\n  "plugins": []\n}\n`;
  test("appends the pack entry", () => {
    const out = addMarketplacePlugin(before, "acme", "desc");
    expect(JSON.parse(out).plugins).toEqual([{ name: "acme", source: "./mattstack/packs/acme", description: "desc" }]);
  });
  test("is a no-op when the pack is already listed", () => {
    const once = addMarketplacePlugin(before, "acme", "desc");
    expect(addMarketplacePlugin(once, "acme", "desc")).toBe(once);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: FAIL, `renderPackFiles is not a function` (and the others).

- [ ] **Step 3: Implement** (append to `lib/skills/init.ts`; add `import { applyEdits, modify } from "jsonc-parser";` at the top)

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/init.ts lib/skills/__tests__/init.test.ts
git commit -m "skills init: render pack files, declare repo, add marketplace entry"
```

---

## Task 3: `initPack` orchestration with injected deps

**Files:**
- Modify: `lib/skills/init.ts`
- Test: `lib/skills/__tests__/init.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces:

```ts
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
export type InitRefusalCode = "not-a-repo" | "no-remote" | "zone-ambiguous" | "zone-missing" | "zone-mismatch" | "zone-has-pack" | "pack-exists" | "mattstack-missing" | "claude-missing";
export type InitOutcome =
  | { ok: true; pack: { name: string; dir: string; zone: string; marketplace: string }; repo: { slug: string; manifest: string }; wrote: string[]; installed: { plugin: string; version: string }; restartNeeded: true; tryNext: string }
  | { ok: false; refused: true; code: InitRefusalCode; detail: string }
  | { ok: false; refused: false; code: "materialize-failed" | "compile-failed" | "check-drift" | "install-failed"; detail: string; wrote: string[] };
export async function initPack(opts: { repoDir: string; zone: string | null }, deps: InitDeps): Promise<InitOutcome>;
```

- [ ] **Step 1: Write the failing tests** (append to `init.test.ts`)

```ts
import { initPack, type InitDeps, type RunResult } from "../init.ts";

type Calls = { claude: string[][]; registered: string[]; materialized: string[]; compiled: string[]; checked: string[] };

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const REPO = "/work/api";

function world(overrides: Partial<InitDeps> & { files?: Record<string, string>; marketplaces?: string[] } = {}) {
  const calls: Calls = { claude: [], registered: [], materialized: [], compiled: [], checked: [] };
  const files: Record<string, string> = {
    ...zoneFiles("acme", {
      [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": [] }\n`,
    }),
    ...(overrides.files ?? {}),
  };
  const fs = memFs(files);
  const marketplaces = overrides.marketplaces ?? [];
  const deps: InitDeps = {
    fs,
    home: HOME,
    gitRemote: async () => ({ kind: "ok", url: "git@gitlab.com:acme/api.git" }),
    isTTY: false,
    promptZone: async () => { throw new Error("must not prompt"); },
    createZone: async () => { throw new Error("must not create"); },
    engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null),
    claude: async (args) => {
      calls.claude.push(args);
      if (args[1] === "marketplace" && args[2] === "list") return ok(JSON.stringify(marketplaces.map((name) => ({ name }))));
      if (args[1] === "marketplace" && args[2] === "add") return ok("Marketplace already on disk");
      return ok("");
    },
    registerRepo: async (dir) => { calls.registered.push(dir); return "gitlab.com/acme/api"; },
    materialize: async (name) => {
      calls.materialized.push(name);
      fs.writeFile(`${HOME}/.mattstack/repos/gitlab.com-acme-api/skills.jsonc`, "// mattstack:work tiering <- acme@acme\n{}");
      return { ok: true, detail: "merged" };
    },
    compile: async (dir) => { calls.compiled.push(dir); return { ok: true, errors: [] }; },
    check: async (dir) => { calls.checked.push(dir); return { drift: false }; },
    ...overrides,
  };
  return { deps, calls, fs };
}

describe("initPack", () => {
  test("happy path writes the pack named after the namespace, declares the repo, installs, and reports", async () => {
    const { deps, calls, fs } = world();
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const packDir = `${HOME}/.mattstack/teams/acme/mattstack/packs/acme`;
    expect(out.pack).toEqual({ name: "acme", dir: packDir, zone: "acme", marketplace: "acme-market" });
    expect(fs.exists(`${packDir}/pack/stubs.jsonc`)).toBe(true);
    expect(JSON.parse(stripJsonc(fs.readFile(`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`)!)).projects).toEqual(["acme/api"]);
    expect(JSON.parse(fs.readFile(`${HOME}/.mattstack/teams/acme/.claude-plugin/marketplace.json`)!).plugins[0].name).toBe("acme");
    expect(calls.registered).toEqual([REPO]);
    expect(calls.materialized).toEqual(["gitlab.com/acme/api"]);
    expect(calls.compiled).toEqual([packDir]);
    expect(calls.checked).toEqual([packDir]);
    expect(calls.claude).toContainEqual(["plugin", "marketplace", "add", `${HOME}/.mattstack/teams/acme`]);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
    expect(out.repo).toEqual({ slug: "gitlab.com-acme-api", manifest: `${HOME}/.mattstack/repos/gitlab.com-acme-api/skills.jsonc` });
    expect(out.tryNext).toBe("/acme:work <ticket>");
    expect(out.restartNeeded).toBe(true);
  });

  test("the pack takes the zone namespace when it differs from the slug", async () => {
    const { deps } = world({
      files: { [`${HOME}/.mattstack/teams/acme/mattstack/mattstack.jsonc`]: `{ "role": "team", "namespace": "acmens", "org": "x" }` },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.pack.name).toBe("acmens");
  });

  test("a marketplace already listed is not re-added", async () => {
    const { deps, calls } = world({ marketplaces: ["acme-market"] });
    await initPack({ repoDir: REPO, zone: null }, deps);
    expect(calls.claude.some((a) => a[2] === "add")).toBe(false);
  });

  test("a marketplace add that exits non-zero with already wording still installs", async () => {
    const { deps, calls } = world({
      claude: async (args) => {
        calls.claude.push(args);
        if (args[2] === "list") return ok("[]");
        if (args[2] === "add") return { code: 1, stdout: "", stderr: "Marketplace acme-market already added" };
        return ok("");
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out.ok).toBe(true);
    expect(calls.claude).toContainEqual(["plugin", "install", "acme@acme-market"]);
  });

  test("refuses before writing: pack-exists when the declaring zone already has a pack", async () => {
    const { deps, fs } = world({
      files: {
        [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/api"] }\n`,
        [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.3.0" }`,
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "pack-exists" });
    expect(fs.exists(`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/pack/stubs.jsonc`)).toBe(false);
  });

  test("a packed zone on the host that does not declare the repo is skipped, so the outcome is zone-missing", async () => {
    const { deps, calls } = world({
      files: {
        [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/other"] }\n`,
        [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.3.0" }`,
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    expect(calls.registered).toEqual([]);
  });

  test("--zone naming a packed zone refuses zone-has-pack", async () => {
    const { deps } = world({
      files: {
        [`${HOME}/.mattstack/teams/acme/mattstack/team.jsonc`]: `{ "gitlabHost": "https://gitlab.com", "projects": ["acme/other"] }\n`,
        [`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/.claude-plugin/plugin.json`]: `{ "name": "acme", "version": "0.3.0" }`,
      },
    });
    const out = await initPack({ repoDir: REPO, zone: "acme" }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-has-pack" });
  });

  test.each([
    ["no-remote", { gitRemote: async () => ({ kind: "no-remote" as const }) }],
    ["not-a-repo", { gitRemote: async () => ({ kind: "not-a-repo" as const }) }],
    ["mattstack-missing", { engineDescription: () => null }],
    ["claude-missing", { claude: null }],
  ])("refuses with %s", async (code, over) => {
    const { deps, calls } = world(over as Partial<InitDeps>);
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code });
    expect(calls.registered).toEqual([]);
  });

  test("zone-missing without a TTY names rt team create", async () => {
    const { deps } = world({ gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-missing" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toContain("rt team create");
  });

  test("zone-missing with a TTY prompts and creates the zone, then writes team.jsonc for it", async () => {
    const created: string[] = [];
    const { deps, fs } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "https://gitlab.example.com/acme/mattstack-team-beta.git" }),
      createZone: async (name, remote) => {
        created.push(`${name} ${remote}`);
        const dir = `${HOME}/.mattstack/teams/beta`;
        for (const [p, t] of Object.entries(zoneFiles("beta", {}))) fs.writeFile(p, t);
        return { slug: "beta", dir };
      },
      materialize: async () => {
        fs.writeFile(`${HOME}/.mattstack/repos/gitlab.example.com-acme-api/skills.jsonc`, "// beta@beta\n{}");
        return { ok: true, detail: "merged" };
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(created).toEqual(["Beta https://gitlab.example.com/acme/mattstack-team-beta.git"]);
    expect(out.ok).toBe(true);
    expect(fs.readFile(`${HOME}/.mattstack/teams/beta/mattstack/team.jsonc`)).toContain("gitlab.example.com");
  });

  test("a compile failure after writing reports every written path", async () => {
    const { deps } = world({ compile: async () => ({ ok: false, errors: ["boom"] }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "compile-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("boom");
    expect(out.wrote).toContain(`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/pack/stubs.jsonc`);
  });

  test("materialize that leaves no manifest is materialize-failed", async () => {
    const { deps } = world({ materialize: async () => ({ ok: false, detail: "no team declares" }) });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed" });
  });
});
```

Note: `memFs.exists` from Task 1 treats a directory prefix as existing; the `pack-exists` path and `zoneHasPack` rely on that, and on `readDir` listing the pack dir name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: FAIL, `initPack is not a function`.

- [ ] **Step 3: Implement** (append to `lib/skills/init.ts`)

```ts
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

  let zones = readZones(deps.fs, deps.home);
  let choice = chooseZone(zones, repo, opts.zone);
  if (choice.kind === "missing" && opts.zone === null) {
    if (!deps.isTTY) {
      return refuse("zone-missing", `no team zone without a pack covers ${repo.host}; run rt team create <Name> --remote <url>, then re-run`);
    }
    const answer = await deps.promptZone();
    await deps.createZone(answer.name, answer.remote);
    zones = readZones(deps.fs, deps.home);
    choice = chooseZone(zones, repo, null);
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

  const repoName = await deps.registerRepo(opts.repoDir);
  const materialized = await deps.materialize(repoName);
  const manifestPath = join(deps.home, ".mattstack", "repos", repo.slug, "skills.jsonc");
  if (!materialized.ok || !deps.fs.exists(manifestPath)) {
    return failed("materialize-failed", `${materialized.detail}; expected ${manifestPath}`);
  }
  const compiled = await deps.compile(packDir, manifestPath);
  if (!compiled.ok) return failed("compile-failed", compiled.errors.join("\n"));
  const checked = await deps.check(packDir, manifestPath);
  if (checked.drift) return failed("check-drift", "rt skills check reports drift right after compile");

  const known = await marketplaceNames(deps.claude);
  if (!known || !known.has(marketplace)) {
    const added = await deps.claude(["plugin", "marketplace", "add", zone.dir]);
    if (added.code !== 0 && !isAlreadyDone(added)) return failed("install-failed", `claude plugin marketplace add exited ${added.code}: ${added.stderr.trim()}`);
  }
  const pluginId = `${pack}@${marketplace}`;
  const installed = await deps.claude(["plugin", "install", pluginId]);
  if (installed.code !== 0 && !isAlreadyDone(installed)) return failed("install-failed", `claude plugin install ${pluginId} exited ${installed.code}: ${installed.stderr.trim()}`);

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/skills/__tests__/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/init.ts lib/skills/__tests__/init.test.ts
git commit -m "skills init: initPack orchestration with injected deps"
```

---

## Task 4: The `rt skills init` command

**Files:**
- Create: `commands/skills-init.ts`
- Modify: `lib/command-tree-def.ts` (the `skills` subtree, beside `sync`)
- Modify: `lib/module-registry.ts`
- Test: `commands/__tests__/skills-init.test.ts`

**Interfaces:**
- Consumes: `initPack`, `InitDeps`, `InitOutcome` (Task 3); `createTeam` from `lib/team/create.ts`; `materializeSkills` from `lib/setup/skills-materialize.ts`; `compilePackAll`, `checkPack` from `commands/skills.ts`; `resolvePluginRoots`, `loadStepSource` from `lib/skills/sources.ts`; `resolveClaudeBin` from `lib/claude-bin.ts`; `createRealProbes` from `lib/setup/probes.ts`; `deriveRepoIdentity`, `serializeIdentity` from `lib/settings/identity.ts`; `updateRepoIndexAsync` from `lib/repo-index.ts`; `textInput` from `lib/ui/prompts.ts`; `UserActionableError` from `lib/setup/errors.ts`; `envelope` from `lib/setup/contract.ts`; `CommandContext` from `lib/command-tree.ts`.
- Produces: `skillsInit(args: string[], _ctx?: CommandContext, deps?: InitDeps): Promise<void>`; `parseInitArgs(args: string[]): { repo: string; zone: string | null; json: boolean }`; `renderInitOutcome(out: InitOutcome): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// commands/__tests__/skills-init.test.ts
import { describe, expect, test } from "bun:test";
import { parseInitArgs, renderInitOutcome } from "../skills-init.ts";
import type { InitOutcome } from "../../lib/skills/init.ts";

describe("parseInitArgs", () => {
  test("defaults: cwd repo, no zone, human output", () => {
    expect(parseInitArgs([])).toEqual({ repo: process.cwd(), zone: null, json: false });
  });
  test("reads every flag", () => {
    expect(parseInitArgs(["--repo", "/r", "--zone", "z", "--json"])).toEqual({ repo: "/r", zone: "z", json: true });
  });
  test("a flag without a value throws a usage error", () => {
    expect(() => parseInitArgs(["--zone"])).toThrow(/--zone needs a value/);
  });
  test("--pack is not an argument", () => {
    expect(() => parseInitArgs(["--pack", "x"])).toThrow(/unrecognized argument "--pack"/);
  });
});

describe("renderInitOutcome", () => {
  const okOutcome: InitOutcome = {
    ok: true,
    pack: { name: "acme", dir: "/z/mattstack/packs/acme", zone: "acme", marketplace: "acme" },
    repo: { slug: "gitlab.com-acme-api", manifest: "/h/.mattstack/repos/gitlab.com-acme-api/skills.jsonc" },
    wrote: ["/z/mattstack/packs/acme/pack/stubs.jsonc"],
    installed: { plugin: "acme@acme", version: "0.1.0" },
    restartNeeded: true,
    tryNext: "/acme:work <ticket>",
  };
  test("human output names the pack dir, the restart, and what to try", () => {
    const text = renderInitOutcome(okOutcome);
    expect(text).toContain("/z/mattstack/packs/acme");
    expect(text).toContain("restart");
    expect(text).toContain("/acme:work <ticket>");
  });
  test("a refusal renders as rt skills init: <detail>", () => {
    const text = renderInitOutcome({ ok: false, refused: true, code: "pack-exists", detail: "exists" });
    expect(text).toBe("rt skills init: exists");
  });
  test("a failure lists what was written", () => {
    const text = renderInitOutcome({ ok: false, refused: false, code: "compile-failed", detail: "boom", wrote: ["/a", "/b"] });
    expect(text).toContain("boom");
    expect(text).toContain("/a");
    expect(text).toContain("/b");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test commands/__tests__/skills-init.test.ts`
Expected: FAIL, `Cannot find module "../skills-init.ts"`.

- [ ] **Step 3: Implement the command**

```ts
// commands/skills-init.ts
/**
 * rt skills init [--repo <path>] [--zone <slug>] [--json]
 *
 * Scaffolds a zero-fill team pack named after its zone's namespace (roster
 * `work` only, every domain slot unbound), declares the repo in the zone,
 * materializes, compiles, checks, and installs the pack plugin on this
 * machine. Never commits; never writes into an existing pack directory.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { updateRepoIndexAsync } from "../lib/repo-index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError } from "../lib/setup/errors.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { materializeSkills } from "../lib/setup/skills-materialize.ts";
import { createTeam } from "../lib/team/create.ts";
import { initPack, type InitDeps, type InitOutcome } from "../lib/skills/init.ts";
import { loadStepSource, resolvePluginRoots } from "../lib/skills/sources.ts";
import { textInput } from "../lib/ui/prompts.ts";
import { checkPack, compilePackAll } from "./skills.ts";

export type InitArgs = { repo: string; zone: string | null; json: boolean };

export function parseInitArgs(args: string[]): InitArgs {
  const out: InitArgs = { repo: process.cwd(), zone: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (flag: string): string => {
      const v = args[++i];
      if (!v || v.startsWith("--")) throw new UserActionableError("usage", `${flag} needs a value`);
      return v;
    };
    switch (a) {
      case "--repo": out.repo = resolve(value(a)); break;
      case "--zone": out.zone = value(a); break;
      case "--json": out.json = true; break;
      default: throw new UserActionableError("usage", `unrecognized argument "${a}"`);
    }
  }
  return out;
}

export function renderInitOutcome(out: InitOutcome): string {
  if (!out.ok) {
    if (out.refused) return `rt skills init: ${out.detail}`;
    return [`rt skills init: ${out.code}: ${out.detail}`, "written so far (fix, then rt skills compile / check by hand):", ...out.wrote.map((w) => `  ${w}`)].join("\n");
  }
  return [
    `pack ${out.pack.name} at ${out.pack.dir}`,
    `zone ${out.pack.zone}, marketplace ${out.pack.marketplace}, installed ${out.installed.plugin} ${out.installed.version}`,
    `repo manifest ${out.repo.manifest}`,
    "restart your Claude session, then try:",
    `  ${out.tryNext}`,
  ].join("\n");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function realDeps(): InitDeps {
  const p = createRealProbes();
  const claudeBin = resolveClaudeBin();
  const run = async (cmd: string, args: string[]) => {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, stderr };
  };
  return {
    fs: {
      exists: (path) => existsSync(path),
      readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      writeFile: (path, text) => writeFileSync(path, text),
      mkdirp: (path) => mkdirSync(path, { recursive: true }),
      readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    },
    home: homedir(),
    gitRemote: async (dir) => {
      try {
        execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "pipe" });
      } catch {
        return { kind: "not-a-repo" };
      }
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
        return url ? { kind: "ok", url } : { kind: "no-remote" };
      } catch {
        return { kind: "no-remote" };
      }
    },
    isTTY: Boolean(process.stdin.isTTY) && !process.env.RT_BATCH,
    promptZone: async () => ({
      name: await textInput({ message: "Team name (a new zone will be created)", stderr: true }),
      remote: await textInput({ message: "Empty git remote URL for the team zone", stderr: true }),
    }),
    createZone: async (name, remote) => {
      const r = await createTeam(p, { name, remote, others: false });
      return { slug: r.slug, dir: r.dir };
    },
    engineDescription: (engine) => {
      try {
        return loadStepSource(engine, resolvePluginRoots()).description;
      } catch {
        return null;
      }
    },
    claude: claudeBin ? (args) => run(claudeBin, args) : null,
    registerRepo: async (dir) => {
      const identity = serializeIdentity(await deriveRepoIdentity(dir));
      const indexed = await updateRepoIndexAsync(identity, dir);
      if (!indexed.ok) throw new UserActionableError("locate-failed", `registering ${dir} failed: ${indexed.error}`);
      return identity;
    },
    materialize: async (repoName) => {
      const r = await materializeSkills(p, { repo: repoName });
      if (r.skipped) return { ok: false, detail: r.reason };
      const row = r.repos[0];
      return row ? { ok: row.ok, detail: row.detail } : { ok: false, detail: "materialize wrote nothing" };
    },
    // compilePackAll and checkPack resolve outside withCleanErrors, so a usage error from
    // pack resolution would escape as an uncaught throw and lose the `wrote` list.
    compile: async (packDir, manifest) => {
      try {
        return await compilePackAll({ packDir, manifest });
      } catch (err) {
        return { ok: false, errors: [message(err)] };
      }
    },
    check: async (packDir, manifest) => {
      try {
        return { drift: (await checkPack({ packDir, manifest })).drift };
      } catch (err) {
        console.error(`rt skills init: check threw: ${message(err)}`);
        return { drift: true };
      }
    },
  };
}

export async function skillsInit(args: string[], _ctx: CommandContext = {}, deps: InitDeps = realDeps()): Promise<void> {
  let parsed: InitArgs;
  try {
    parsed = parseInitArgs(args);
  } catch (err) {
    if (err instanceof UserActionableError) {
      console.error(`rt skills init: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  const out = await initPack({ repoDir: parsed.repo, zone: parsed.zone }, deps);
  if (parsed.json) console.log(JSON.stringify(envelope(out)));
  else console.log(renderInitOutcome(out));
  if (!out.ok) process.exitCode = out.refused ? 2 : 1;
}
```

`updateRepoIndexAsync` is the whole registration (`rt repos register` adds tracking only behind `--track`, which init does not need); its result has `ok` and, on failure, `error`. `CommandContext` has only optional fields, so `= {}` typechecks.

- [ ] **Step 4: Add the command-tree leaf and registry entry**

In `lib/command-tree-def.ts`, inside `skills.subcommands`, after `sync`:

```ts
      init: {
        description: "Scaffold this zone's team pack with a generic work pipeline, declare the repo, compile, check, and install it",
        module: "./commands/skills-init.ts",
        fn: "skillsInit",
        args: [
          { name: "Repo", flag: "--repo", type: "text", placeholder: "/path/to/repo", hint: "Repo to declare; defaults to the current directory" },
          { name: "Zone", flag: "--zone", type: "text", placeholder: "acme", hint: "Team zone slug when more than one packless zone could host the pack" },
          SETUP_JSON_ARG,
        ],
      },
```

In `lib/module-registry.ts`, beside `"./commands/skills-sync.ts"`:

```ts
  "./commands/skills-init.ts": () => import("../commands/skills-init.ts"),
```

- [ ] **Step 5: Run the tests and the gates**

Run: `bun test commands/__tests__/skills-init.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

Run: `bun run picker:check`
Expected: exit 0 (init has no required positional).

Run: `bun run cli.ts skills init --help`
Expected: usage printed with the three flags.

- [ ] **Step 6: Commit**

```bash
git add commands/skills-init.ts commands/__tests__/skills-init.test.ts lib/command-tree-def.ts lib/module-registry.ts
git commit -m "rt skills init: command, tree leaf, registry entry"
```

---

## Task 5: Fixture end-to-end: a generated pack compiles

**Files:**
- Test: `lib/skills/__tests__/init-compile.e2e.test.ts`

**Interfaces:**
- Consumes: `renderPackFiles`, `PIPELINE_STAGES` (Task 2); `skillsCompile`, `skillsCheck` from `commands/skills.ts`; `runExpectingCleanExit` from `lib/skills/__tests__/helpers.ts`, which returns `{ exitCode: number | undefined; errors: string[] }` (`exitCode` is `undefined` when the command never called `process.exit`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/skills/__tests__/init-compile.e2e.test.ts
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { skillsCheck, skillsCompile } from "../../../commands/skills.ts";
import { PIPELINE_STAGES, renderPackFiles } from "../init.ts";
import { runExpectingCleanExit } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "compile-native");

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const stageEngine = (name: string, slots: string) => `---
name: ${name}
description: "Pipeline stage ${name}."
disable-model-invocation: true
type: pipeline-step
slots:
${slots}
metadata:
  stage: "${name.slice("stage-".length)}"
  stage-consumes: "ticket"
  stage-produces: "-"
---

# ${name}

{{slot:domain}}
`;

const workEngine = `---
name: work
description: "Use when running a unit of work through a configured pipeline."
disable-model-invocation: true
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
---

# work

Stages:

{{pipeline.stages}}

## Tiering

{{slot:tiering}}
`;

const fill = (name: string, provides: string, body: string) => `---
name: ${name}
description: "Use when a slot resolves here."
disable-model-invocation: true
metadata:
  provides: "${provides}"
---

${body}
`;

async function build() {
  const root = mkdtempSync(join(tmpdir(), "rt-init-e2e-"));
  cpSync(FIX, root, { recursive: true });
  const ms = join(root, "mattstack-home");
  const engines = join(ms, "plugins", "mattstack", "attachments");
  // The fixture's own work engine declares no slots, so the tiering bind would be
  // silently ignored; this one exercises it.
  write(join(engines, "pipeline", "work", "SKILL.md"), workEngine);
  for (const stage of PIPELINE_STAGES) {
    const path = join(engines, "pipeline", stage, "SKILL.md");
    if (existsSync(path)) continue;
    const slots = stage === "stage-watch-ci"
      ? "  domain: { contract: watch-ci-domain@1, required: false }\n  forge: { contract: ci-forge@1, required: false }"
      : `  domain: { contract: ${stage.slice("stage-".length)}-domain@1, required: false }`;
    write(path, stageEngine(stage, slots));
  }
  write(join(engines, "model-tiering", "SKILL.md"), fill("model-tiering", "model-tiering@1", "tiering rules"));
  write(join(engines, "ci-forge-gitlab", "SKILL.md"), fill("ci-forge-gitlab", "ci-forge@1", "gitlab forge"));
  const pack = join(root, "generated");
  for (const [rel, text] of Object.entries(renderPackFiles({ pack: "acme", workDescription: "Use when running a unit of work." }))) {
    write(join(pack, rel), text);
  }
  const manifest = join(ms, "repos", "acme-repo", "skills.jsonc");
  write(manifest, "// mattstack:work tiering <- acme@acme\n" + readFileSync(join(pack, "pack", "skills.jsonc"), "utf8"));
  return { pack, ms, manifest };
}

describe("rt skills init output compiles", () => {
  test("work (tiering bound) plus eight stages compile and check clean with no placeholders left", async () => {
    const { pack, ms, manifest } = await build();
    const compiled = await runExpectingCleanExit(() => skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]));
    expect(compiled.exitCode).toBeUndefined();
    expect(compiled.errors).toEqual([]);
    const work = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
    expect(work).toContain("tiering rules");
    expect(work).not.toContain("{{");
    for (const stage of PIPELINE_STAGES) {
      const body = readFileSync(join(pack, "attachments", stage, "SKILL.md"), "utf8");
      expect(body).not.toContain("{{");
    }
    const checked = await runExpectingCleanExit(() => skillsCheck(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]));
    expect(checked.exitCode).toBeUndefined();
  });
});
```

The `stage-watch-ci` template binds `forge` without placing `{{slot:forge}}`; that yields a compile note, not an error.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/skills/__tests__/init-compile.e2e.test.ts`
Expected: FAIL on the first missing engine or contract (read the message; it names what the fixture is missing).

- [ ] **Step 3: Make it pass**

Adjust only the test fixture writes (engine frontmatter, contract strings) until compile and check are clean. Do not change `renderPackFiles` to fit a fixture; if `renderPackFiles` output is wrong for a real engine, fix it and add the case to Task 2's tests.

- [ ] **Step 4: Run the whole skills suite**

Run: `bun test lib/skills commands/__tests__/skills-init.test.ts commands/__tests__/skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/__tests__/init-compile.e2e.test.ts
git commit -m "skills init: generated pack compiles and checks clean end to end"
```

---

## Task 6: `rt skills bind` writes the team pack's fragment

**Files:**
- Modify: `commands/skills.ts` (`skillsBind`, the manifest write near the `modify(text, ["bindings", engineRef, slotName], fill, ...)` call)
- Test: `commands/__tests__/skills-bind.test.ts`

**Interfaces:**
- Consumes: the existing `skillsBind(args)` with `--pack-dir`, `--mattstack-dir`, `--manifest` flags; the compile-native fixture (`pack/attachments/plan-policy` provides `plan-domain@1`, the manifest binds `mattstack:stage-plan.domain` to `acme:plan-policy`).
- Produces: after a bind on a pack whose `<packDir>/pack/skills.jsonc` exists and is not the manifest itself, that fragment carries the same `bindings.<engine>.<slot>` entry.

- [ ] **Step 1: Write the failing test** (append to `commands/__tests__/skills-bind.test.ts`)

```ts
import { cpSync } from "fs";
import { stripJsonc } from "../../lib/skills/sources.ts";

const FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-native");

describe("bind writes the team pack fragment", () => {
  function fixtureWithFragment(fragment: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-bind-frag-")));
    cpSync(FIX, root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
    writeFile(join(pack, "pack", "skills.jsonc"), fragment);
    writeFile(manifest, `// acme@acme\n{\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
    return { pack, ms, manifest };
  }

  test("the fragment gains the binding, comments kept, and the manifest gets it too", async () => {
    const { pack, ms, manifest } = fixtureWithFragment(`// acme fragment\n{\n  "version": 1,\n  "bindings": {}\n}\n`);
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest]);
    const fragment = readFileSync(join(pack, "pack", "skills.jsonc"), "utf8");
    expect(fragment).toContain("// acme fragment");
    expect(JSON.parse(stripJsonc(fragment)).bindings).toEqual({ "mattstack:stage-plan": { domain: "acme:plan-policy" } });
    expect(readManifestBindings(manifest)["mattstack:stage-plan"]).toEqual({ domain: "acme:plan-policy" });
  });

  test("a standalone pack whose fragment is the manifest is written once", async () => {
    const { pack, ms } = fixtureWithFragment(`{\n  "version": 1,\n  "pipelines": { "feature": ["mattstack:stage-plan", "mattstack:stage-implement", "mattstack:stage-ship"] },\n  "bindings": {}\n}\n`);
    const own = join(pack, "pack", "skills.jsonc");
    await skillsBind(["stage-plan", "domain", "acme:plan-policy", "--pack-dir", pack, "--mattstack-dir", ms, "--manifest", own]);
    const text = readFileSync(own, "utf8");
    expect(text.match(/acme:plan-policy/g)?.length).toBe(1);
  });
});
```

`writeFile`, `join`, `mkdtempSync`, `realpathSync`, `tmpdir`, `readFileSync`, `readManifestBindings`, and `skillsBind` are already imported or defined at the top of that test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test commands/__tests__/skills-bind.test.ts -t "fragment"`
Expected: FAIL, the fragment's `bindings` is still `{}`.

- [ ] **Step 3: Implement**

In `skillsBind`, right after `writeFileSync(resolved.manifestPath, applyEdits(text, edits));`:

```ts
    // A team pack's pack/skills.jsonc is the fragment merge-manifests folds into the
    // per-repo manifest; the manifest write alone is undone by the next materialize and
    // never reaches a teammate. A standalone pack's fragment IS its manifest (written above).
    const fragmentPath = join(resolved.packDir, "pack", "skills.jsonc");
    if (existsSync(fragmentPath) && realpathSync(fragmentPath) !== realpathSync(resolved.manifestPath)) {
      const fragmentText = readFileSync(fragmentPath, "utf8");
      const fragmentEdits = modify(fragmentText, ["bindings", engineRef, slotName], fill, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      writeFileSync(fragmentPath, applyEdits(fragmentText, fragmentEdits));
    }
```

Extend the `summary` printed just after to name the fragment when it was written (`bound ... (fragment updated: <path>)`), so the author sees both writes.

- [ ] **Step 4: Run the bind suite**

Run: `bun test commands/__tests__/skills-bind.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add commands/skills.ts commands/__tests__/skills-bind.test.ts
git commit -m "rt skills bind: write the binding into the team pack fragment"
```

---

## Task 7: Scratch end-to-end (real machine, isolated HOME)

This task produces evidence, not code. It proves two things before any skill is written: `rt skills init` works against real `claude`, real git, and the real merge script; and the generic pipeline runs with nothing bound.

**Files:**
- Create: `docs/superpowers/plans/2026-09-23-pack-authoring-scratch-evidence.md`

**Interfaces:**
- Consumes: the `rt` source checkout on branch `pack-authoring` (`bun run cli.ts`), `/Users/matt/Documents/GitHub/glance/harness_credentials.json` (read for the GitLab test repo URLs and token; never copied anywhere), the mattstack-skills worktree (created in Step 1).

- [ ] **Step 1: Create the mattstack-skills worktree and the scratch environment**

```bash
cd /Users/matt/Documents/GitHub/mattstack-skills
git worktree add .claude/worktrees/pack-authoring -b pack-authoring origin/main
S=/private/tmp/claude-501/pack-scratch
mkdir -p $S/.claude $S/repos $S/marketplace/.claude-plugin
cat > $S/marketplace/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "mattstack",
  "owner": { "name": "scratch" },
  "plugins": [
    {
      "name": "mattstack",
      "source": { "source": "url", "url": "file:///Users/matt/Documents/GitHub/mattstack-skills/.claude/worktrees/pack-authoring", "ref": "pack-authoring" },
      "description": "mattstack from the pack-authoring worktree"
    }
  ]
}
EOF
export HOME=$S CLAUDE_CONFIG_DIR=$S/.claude
```

Every command in this task runs with those two variables set (prefix each with `env HOME=$S CLAUDE_CONFIG_DIR=$S/.claude` when not in one shell). Never run these against the real HOME. The worktree-isolated rt session refuses `git -C` to other repos; run the `git worktree add` from a plain terminal.

The scratch marketplace is named `mattstack` on purpose: `findMergeManifests` (`lib/setup/skills-materialize.ts`) looks for `merge-manifests.sh` only under `<home>/.claude/plugins/cache/mattstack/mattstack/<version>/`, and the cache path is `cache/<marketplace>/<plugin>/<version>`. Any other marketplace name leaves `materializeSkills` skipped and every init at `materialize-failed`.

- [ ] **Step 2: Log in, then install the mattstack and superpowers plugins into the scratch config**

A fresh `CLAUDE_CONFIG_DIR` has no credentials: the first `claude` invocation asks for a login. Matt does that login by hand in this shell (`claude` once, complete the browser flow, exit) before anything below. Then:

```bash
claude plugin marketplace add $S/marketplace
claude plugin install mattstack@mattstack
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install superpowers@claude-plugins-official
claude plugin list --json | jq '.[].id'
```

Expected: `mattstack@mattstack` and `superpowers@claude-plugins-official` listed. The mattstack cache under `$S/.claude/plugins/cache/mattstack/mattstack/<version>/` exists.

- [ ] **Step 3: Clone the throwaway repo and start a scratch daemon**

Read the two GitLab test project URLs from the harness credentials file (one for the repo, one empty for the zone remote). Then:

```bash
git clone <repo-url> $S/repos/api
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/elrond
bun run cli.ts daemon start
bun run cli.ts daemon status --json
```

Expected: daemon socket at `$S/.mattstack/rt/rt.sock`, `"ok":true`. The live daemon on the real HOME is untouched.

- [ ] **Step 4: Create the zone and run init**

```bash
bun run cli.ts team create Scratch --remote <zone-remote-url>
bun run cli.ts skills init --repo $S/repos/api --json | tee $S/init.json
```

Expected: `"ok": true`, `"pack": { "name": "scratch", ... }`, `tryNext: "/scratch:work <ticket>"`. Then:

```bash
ls $S/.mattstack/teams/scratch/mattstack/packs/scratch/{pack,skills,attachments}
grep '<- scratch@' $S/.mattstack/repos/*/skills.jsonc
bun run cli.ts skills check --pack scratch
bun run cli.ts skills composition --pack scratch
claude plugin list --json | jq '.[] | select(.id | startswith("scratch@"))'
```

Expected: `work` under `skills/`, eight `stage-*` under `attachments/`, the manifest header naming `scratch@scratch`, check clean, composition listing the tiering and forge fills bound, plugin `scratch@scratch` listed and enabled.

- [ ] **Step 5: Run the generic pipeline in a fresh Claude session**

Open a new terminal with `HOME=$S CLAUDE_CONFIG_DIR=$S/.claude`, `cd $S/repos/api`, run `claude`, and invoke:

```
/scratch:work add a line "scratch pipeline check" to README.md
```

Walk it through: provision (a worktree from the scratch daemon), plan (an APPROACH block), implement, ship (an MR on the throwaway project), watch-ci. Answer gates as they come. Record, per stage, one line of what happened and any place the generic fallback was taken.

Expected: an MR URL on the throwaway project and a CI verdict. If a stage cannot proceed without a domain fill, that is a finding: record it verbatim; it becomes a fix in the engine (mattstack-skills) before Task 8.

- [ ] **Step 6: Write the evidence file and tear down**

`docs/superpowers/plans/2026-09-23-pack-authoring-scratch-evidence.md`: the init envelope (paths only, no tokens), the check and composition output, the plugin list line, the per-stage record, the MR URL, and any findings. Then:

```bash
bun run cli.ts daemon stop
```

Close the throwaway MR. Leave `$S` in place for the baselines and GREEN runs.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-23-pack-authoring-scratch-evidence.md
git commit -m "docs: scratch end-to-end evidence for rt skills init and the generic pipeline"
```

---

## Task 8: RED baseline for `creating-a-pack`

**Files:**
- Create (mattstack-skills worktree): `docs/superpowers/baselines/2026-09-23-creating-a-pack.md`

- [ ] **Step 1: Reset the scratch pack state**

Under the scratch environment from Task 7 (`HOME=$S CLAUDE_CONFIG_DIR=$S/.claude`):

```bash
claude plugin uninstall scratch@scratch
rm -rf $S/.mattstack/teams/scratch/mattstack/packs/scratch
```

Then edit `$S/.mattstack/teams/scratch/.claude-plugin/marketplace.json` to drop the `scratch` plugin entry, and `$S/.mattstack/teams/scratch/mattstack/team.jsonc` to empty its `projects` array. Confirm `rt skills packs` (from the rt worktree, scratch env) lists no `scratch` pack.

- [ ] **Step 2: Run the no-skill scenario**

Start a fresh `claude` in `$S/repos/api` and give it, with no skill mentioned:

```
We want the mattstack work pipeline on this repo. Set it up so /<team>:work runs. Our team is called scratch.
```

Let it run to a stop. Do not steer.

- [ ] **Step 3: Record the baseline verbatim**

In the baseline file: the prompt, then what the agent did (files it created, commands it ran, what it copied from), and every rationalization quoted verbatim. Expected failure class: wrong shape (hand-rolled directories, a copy of an existing pack, a `.mattstack/skills.jsonc` in the repo, no compile, no install). Classify the failure per writing-skills "Match the Form to the Failure": shape failures get a recipe, not a prohibition list.

- [ ] **Step 4: Reset again**

Repeat Step 1 so Task 9's GREEN run starts from the same state.

- [ ] **Step 5: Commit** (in the mattstack-skills worktree)

```bash
git add docs/superpowers/baselines/2026-09-23-creating-a-pack.md
git commit -m "baseline: creating-a-pack without the skill"
```

---

## Task 9: GREEN: write `mattstack:creating-a-pack`

**Files:**
- Create: `plugin/skills/creating-a-pack/SKILL.md`
- Modify: `tests/desc-test-scenarios.json`

**Interfaces:**
- Consumes: `rt skills init --json` envelope (Task 3 shape), `mattstack:extending-a-pack` (Task 11, referenced by name only), `mattstack:editing-skills`, `rt:herdr-inject`. `rt daemon status --json` prints `{"ok":true,"state":"running",...}` when the daemon is up (verified).

- [ ] **Step 1: Write the skill**

```markdown
---
name: creating-a-pack
description: Use when a team wants the mattstack pipeline on a repo that has no pack yet -- "make a pack", "set up /<team>:work", "we want the work pipeline on our repo", "onboard our team to mattstack", or when no pack of the team's is installed. Not for adding rules or verbs to a pack that already exists.
---

# Creating a pack

A pack is a plugin in the team's zone: a verb roster, a bindings fragment,
and (later) domain fills. `rt skills init` writes all of it; this skill runs
that verb, proves the result, and offers the first rules. One zone holds
one pack, named after the zone's namespace.

The output of this skill is a pack the author can invoke, in this order:

1. every prerequisite checked and named
2. `rt skills init` run once, its envelope read
3. a restarted session that has run `/<pack>:work`
4. zero or more rules, each through `mattstack:extending-a-pack`
5. the zone committed and pushed

## 1. Prerequisites (stop on any miss, say which)

| check | command | pass |
| --- | --- | --- |
| rt daemon | `rt daemon status --json` | `"ok":true` |
| mattstack plugin | `claude plugin list --json` | an id starting `mattstack@` |
| superpowers | `claude plugin list --json` | an id starting `superpowers@` |
| a GitLab remote | `git remote get-url origin` | host is a GitLab host |

A miss is reported as the missing thing and the command that installs it
(`rt setup pack` covers the first three). Do not improvise a substitute.

## 2. Run init

From the repo root:

```bash
rt skills init --json
```

Read the envelope:

- `ok: false, refused: true`: relay `detail` verbatim and stop.
  `zone-missing` outside a TTY means the author runs
  `rt team create <Name> --remote <url>` (an empty repo the team owns) and
  re-runs init. `zone-has-pack` means the zone found already belongs to
  another team's pack: create a zone for this team the same way.
- `ok: false, refused: false`: files were written; relay `detail` and the
  `wrote` list, then fix and run `rt skills compile --pack <name>` and
  `rt skills check --pack <name>` by hand. Never re-run init on a written
  pack; it refuses on `pack-exists`.
- `ok: true`: continue with `pack.name`, `pack.dir`, `tryNext`,
  `restartNeeded`.

## 3. Restart and prove

`restartNeeded` is always true. In a herdr pane use `rt:herdr-inject` to
restart this session with a continuation; otherwise tell the author to
restart and paste `tryNext` with a small real ticket.

"Works" means, in the restarted session: a worktree provisioned, an
APPROACH block printed, commits, an MR, and a CI verdict. Every stage runs
its generic path; that is the expected shape of a pack with no fills.

The `work` verb's description in `pack/stubs.jsonc` is a placeholder seeded
from the engine. Rewording it in the team's words is the first, smallest
edit; `mattstack:extending-a-pack` covers it.

## 4. Offer the first rules, once

Ask exactly this:

> Are any of your team's rules already written down (CONTRIBUTING, a review
> checklist, branch rules, a release checklist)?

Each yes is one round of `mattstack:extending-a-pack`, one rule per round.
No is a complete answer; say that rules can be added any time with the same
skill.

## 5. Publish

Hand to `mattstack:editing-skills` for the tail: commit the zone (the pack
dir, `team.jsonc`, `marketplace.json`), push, and note that teammates
receive the pack through `rt setup`.

## Red flags

- Creating directories or `plugin.json` by hand: init writes them.
- Copying another team's pack: its fills carry that team's rules.
- A `.mattstack/skills.jsonc` inside the repo: the compiler reads the
  per-repo manifest under `~/.mattstack/repos/`, not the repo.
- Writing a fill "to have something there": fills are optional and each one
  is written through `superpowers:writing-skills` when the rule exists.
```

- [ ] **Step 2: Certify**

Run: `sh tests/certify.sh plugin/skills/creating-a-pack`
Expected: every line `ok`; exit 0.

- [ ] **Step 3: Add selection scenarios**

Append to `tests/desc-test-scenarios.json`:

```json
  {
    "task": "We want the mattstack work pipeline on our repo; nothing is set up yet for our team",
    "expect": "creating-a-pack"
  },
  {
    "task": "Onboard the billing team: get them a /billing:work verb",
    "expect": "creating-a-pack"
  },
  {
    "task": "I edited a fill in our team pack and the change is not showing up in my session",
    "expect": "editing-skills"
  }
```

Run: `bun run tests/desc-test.ts --reps 5`
Expected: every rep of every scenario picks the expected skill.

- [ ] **Step 4: GREEN run**

Commit the draft skill in the worktree (Step 5's commit, amended later if the wording changes), then under the scratch environment:

```bash
claude plugin update mattstack@mattstack
claude plugin list --json | jq '.[] | select(.id == "mattstack@mattstack") | .version'
```

The scratch marketplace clones the worktree at ref `pack-authoring`, so the update carries the new skill. Start a fresh `claude` in `$S/repos/api` with the pack state reset (Task 8 Step 4) and give the same prompt as the baseline. Expected: the agent invokes `creating-a-pack`, runs `rt skills init --json`, stops at the restart with `tryNext`, and asks the rules question once. Record the run under the baseline file's "With the skill" heading; if it deviates, tighten the recipe, commit, update the plugin, and re-run.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/creating-a-pack/SKILL.md tests/desc-test-scenarios.json docs/superpowers/baselines/2026-09-23-creating-a-pack.md
git commit -m "skill: creating-a-pack"
```

---

## Task 10: RED baseline for `extending-a-pack`

**Files:**
- Create: `docs/superpowers/baselines/2026-09-23-extending-a-pack.md`

- [ ] **Step 1: Run the no-skill scenario**

Scratch environment, pack present (re-run `bun run cli.ts skills init --repo $S/repos/api --json` from the rt worktree if Task 9's reset left none). Fresh `claude` in `$S/repos/api`, no skill mentioned:

```
Our pipeline shipped an MR without running `bun run lint`. Make the pipeline always run lint before it opens an MR on this repo.
```

Let it run to a stop.

- [ ] **Step 2: Record the baseline verbatim**

Expected failure class: editing the compiled `attachments/stage-ship/SKILL.md` (overwritten on the next compile), editing the mattstack engine in the plugin cache, or writing a rule into the repo. Quote rationalizations verbatim. Classify the form: this is partly wrong shape (needs the fill recipe) and partly discipline (edits compiled output because it is right there), so the skill gets a recipe plus a short red-flags list.

- [ ] **Step 3: Reset**

From a plain terminal (not the worktree-isolated rt session): `git -C $S/.mattstack/teams/scratch checkout -- .` and remove any file the agent added under the pack or the plugin cache; re-run `bun run cli.ts skills compile --pack scratch` and `bun run cli.ts skills check --pack scratch` from the rt worktree to confirm clean.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/baselines/2026-09-23-extending-a-pack.md
git commit -m "baseline: extending-a-pack without the skill"
```

---

## Task 11: GREEN: write `mattstack:extending-a-pack`

**Files:**
- Create: `plugin/skills/extending-a-pack/SKILL.md`
- Create: `plugin/skills/extending-a-pack/slots.md`
- Modify: `tests/desc-test-scenarios.json`

- [ ] **Step 1: Write the skill**

```markdown
---
name: extending-a-pack
description: Use when a team pack already exists and it should know something new -- "add a rule to our pack", "the pipeline should X on our repo", "make ship run lint first", "add a ship/review/watch-ci verb", "reword the work description" -- or right after a generic stage missed a team rule. Not for creating the pack (see creating-a-pack) or publishing it (see editing-skills).
---

# Extending a pack

One ask per round. The ask lands in exactly one of four places; the rule
itself is written by the author, in their words, as a real skill.

**REQUIRED SUB-SKILL:** `superpowers:writing-skills` for every `context`
skill and every fill. Baseline first, then write, then re-run.

## 1. Sort the ask

| the ask is about | goes to |
| --- | --- |
| a rule that holds even outside a pipeline (branch names, forbidden ops, where things live) | `skills/context/SKILL.md`, a hand-authored public skill |
| something one stage or verb should do differently | a fill bound to that stage's `domain` slot (or the review cluster's `criteria` / `reply-rules`) |
| a new door: `ship`, `review`, `watch-ci`, `self-review`, `receive-review`, `shepherdr` | a roster entry in `pack/stubs.jsonc` plus `rt skills surface set <verb> --public` |
| the wording of an existing verb | its `description` in `pack/stubs.jsonc` |

`slots.md` beside this file maps asks to slots and contracts.
`rt skills composition --pack <pack>` is the live list; use it when the
table and the pack disagree.

## 2. Write it (context or fill)

Paths: `<zone>/mattstack/packs/<pack>/skills/context/SKILL.md` for context,
`<zone>/mattstack/packs/<pack>/attachments/<fill>/SKILL.md` for a fill.
`rt skills packs` prints the pack dir.

A fill has this frontmatter and nothing else in it:

```markdown
---
name: <fill>
description: "Use when mattstack:<engine> resolves its <slot> slot here; the pack manifest binds <contract> to this skill. Not for manual invocation."
disable-model-invocation: true
metadata:
  provides: "<contract>"
---
```

RED, in the author's repo, in a worktree: run the stage or verb without the
rule on a small real task (`/<pack>:work` for a stage, `/<pack>:ship` for a
door) and record verbatim where it missed the rule. Then write the body:
the rule, its reason, and the decision it changes. Re-run: the miss is gone.

## 3. Bind, certify, check

```bash
rt skills bind <stage-or-verb> <slot> <pack>:<fill>     # validates provides, writes the per-repo manifest AND pack/skills.jsonc, recompiles
sh <mattstack-skills>/tests/certify.sh <fill dir> --domain
rt skills check --pack <pack>
```

The write into `pack/skills.jsonc` is what reaches teammates; the per-repo
manifest is regenerated on every materialize. Confirm the fragment carries
the new `bindings` entry before moving on.

A verb-level bind (`mattstack:ship`) needs the door rostered first; the
stage-level bind (`mattstack:stage-ship`) works either way. Bind both when
both exist. `context` needs no bind: it is public by being under `skills/`;
add it to `pack/surface.jsonc`'s `public` list.

## 4. Doors and wording

Add a roster entry with the engine name and a trigger-only description in
the team's words, then `rt skills surface set <verb> --public` and
`rt skills compile --pack <pack>`. Rewording is the same edit without the
surface step. A `shepherdr` door also needs its two required slots bound
(`tiering` to `mattstack:model-tiering`, `strategy` to
`mattstack:execution-strategy`) before it compiles.

## 5. Publish

Hand to `mattstack:editing-skills`: bump, commit, push, `rt skills sync`,
restart.

## Red flags

- Editing anything under `skills/<verb>/` or `attachments/stage-*/`: compiled
  output, overwritten by the next compile.
- Editing the mattstack engine in the plugin cache: every team's compile
  reads it, and the next update erases the edit.
- Editing `~/.mattstack/repos/<slug>/skills.jsonc` by hand: regenerated on
  the next materialize; the fragment is the source.
- A fill body that restates the engine: the fill carries only what the team
  adds.
- Binding before the fill exists: `rt skills bind` refuses; write first.
```

- [ ] **Step 2: Write `slots.md`**

```markdown
# Asks to slots

| the ask is about | engine | slot | contract |
| --- | --- | --- | --- |
| getting a worktree, ticket lookup, branch shape | `mattstack:stage-provision` | `domain` | `provision-domain@1` |
| what a plan must commit to, tiers, extra APPROACH lines | `mattstack:stage-plan` | `domain` | `plan-domain@1` |
| checks for touched paths before implementation | `mattstack:stage-gates` | `domain` | `gates-domain@1` |
| what counts as evidence, before/after capture | `mattstack:stage-evidence` | `domain` | `evidence-domain@1` |
| own-branch review homework | `mattstack:stage-self-review` | `domain` | `self-review-domain@1` |
| MR preflight, description shape, labels | `mattstack:stage-ship` and `mattstack:ship` | `domain` | `ship-domain@1` |
| CI job names, retry rules, triage | `mattstack:stage-watch-ci` and `mattstack:watch-ci` | `domain` | `watch-ci-domain@1` |
| what reviewers check | `mattstack:review`, `mattstack:self-review`, `mattstack:receive-review` | `criteria` | `review-criteria@1` |
| how to answer review threads | `mattstack:receive-review` | `reply-rules` | `reply-rules@1` |
| fan-out rules for parallel agents | `mattstack:shepherdr` | `domain` | `shepherdr-domain@1` |

Every slot above is optional; an unbound slot renders as nothing. One fill
may be bound to more than one engine (ship's stage and door share one fill).
`mattstack:shepherdr` is the one engine with required slots, `tiering`
(`model-tiering@1`) and `strategy` (`execution-strategy@1`); bind both to
the mattstack fills before compiling a `shepherdr` door.
```

- [ ] **Step 3: Certify and scenarios**

Run: `sh tests/certify.sh plugin/skills/extending-a-pack`
Expected: exit 0.

Append to `tests/desc-test-scenarios.json`:

```json
  {
    "task": "Our pipeline opened an MR without running lint; make ship run lint first on this repo",
    "expect": "extending-a-pack"
  },
  {
    "task": "Add a /acme:review verb to our pack",
    "expect": "extending-a-pack"
  },
  {
    "task": "Reword what our work verb says it is for",
    "expect": "extending-a-pack"
  }
```

Run: `bun run tests/desc-test.ts --reps 5`
Expected: all pass, including the earlier `editing-skills` scenarios.

- [ ] **Step 4: GREEN run**

Commit (Step 5), `claude plugin update mattstack@mattstack` under the scratch environment, then the same scratch setup and prompt as Task 10. Expected: the agent sorts the ask to `ship-domain@1`, runs a RED pass, writes `attachments/ship-lint/SKILL.md` (or similar) with the fixed frontmatter, binds to `mattstack:stage-ship`, confirms the fragment carries the binding, certifies, checks, and hands to `editing-skills`. Record under the baseline's "With the skill" heading; tighten, commit, update, and re-run on deviation.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/extending-a-pack docs/superpowers/baselines/2026-09-23-extending-a-pack.md tests/desc-test-scenarios.json
git commit -m "skill: extending-a-pack"
```

---

## Task 12: Retire the stale template and point the README at the skills

**Files:**
- Delete: `templates/domain-pack/` (three files)
- Modify: `README.md`, two places: the paragraph at lines 116-118 ("A domain team starts its own pack from `templates/domain-pack`...") and the Configuration paragraph beginning "A domain team does not fork this repo."

- [ ] **Step 1: Delete the template**

```bash
git rm -r templates/domain-pack
```

Run: `grep -rn "domain-pack" --include=*.md --include=*.json --include=*.jsonc . | grep -v .claude/worktrees`
Expected: exactly the two README.md hits (fixed next).

- [ ] **Step 2: Rewrite the two README paragraphs**

Replace the lines 116-118 paragraph with:

```markdown
A domain team gets its pack from `rt skills init` (the `creating-a-pack`
skill walks through it) and grows it with `extending-a-pack`; both are
public doors of this plugin.
```

Replace the Configuration paragraph (one paragraph, from "A domain team does not fork this repo." through "certification habit described below.") with:

```markdown
A domain team does not fork this repo. It runs `rt skills init` in its repo
(the `creating-a-pack` skill walks through it), which scaffolds a pack in
the team's zone: a `work` verb compiled from the engines here with every
domain slot unbound, so the generic pipeline runs on day one. Rules are
added later as fills, one slot at a time, through the `extending-a-pack`
skill; each fill is a small skill declaring `metadata.provides` and bound
with `rt skills bind`.
```

Keep the paragraph about the manifest schema and the `rt skills compile` / `rt skills check` block.

- [ ] **Step 3: Purity sweep**

Run: `grep -rn "domain-pack" README.md; sh tests/repo-purity.sh`
Expected: no `domain-pack` hits; purity clean.

- [ ] **Step 4: Commit**

```bash
git add -A README.md templates
git commit -m "retire templates/domain-pack; README points at the pack skills"
```

---

## Task 13: Bump, publish, and verify the skills are live

**Files:**
- Modify: `.claude-plugin/plugin.json` (`version` and the `description` list of public doors)

- [ ] **Step 1: Bump and describe**

Raise `version` one minor (0.19.x to 0.20.0: two new public doors). In `description`, add `creating-a-pack, extending-a-pack` to the list of public doors.

- [ ] **Step 2: Commit and merge to main**

```bash
git add .claude-plugin/plugin.json
git commit -m "mattstack 0.20.0: creating-a-pack and extending-a-pack"
```

Open a PR from `pack-authoring` in mattstack-skills, wait for checks, merge. Then in the canonical checkout: `git checkout main && git pull --ff-only`. Remove the worktree (`git worktree remove .claude/worktrees/pack-authoring`) before any `rt skills sync`, which refuses on a `.claude/worktrees/` dir under the pack.

- [ ] **Step 3: Sync the caches**

```bash
rt skills sync --pack mattstack
rt skills check --pack <existing team pack>
```

Expected: sync reports the new version installed; the existing team pack's check reports no engine drift (no engine changed). If sync warns about a cswap session, repeat the update with that session's `CLAUDE_CONFIG_DIR`.

- [ ] **Step 4: Verify live**

Restart a session and run `/mattstack:creating-a-pack` and `/mattstack:extending-a-pack` by name; both load. Read both installed files in full from `<config>/plugins/cache/mattstack/mattstack/0.20.0/plugin/skills/` and confirm they match the checkout.

---

## Task 14: rt PR

- [ ] **Step 1: Full gates on the rt worktree**

Run: `bun run test && bun run test:e2e && bun run picker:check`
Expected: green. If a rotating flake appears, isolate and re-run per the repo's flake note.

- [ ] **Step 2: Open the PR**

From the worktree, push `pack-authoring` and open a PR against `main` titled `rt skills init: scaffold a zero-fill team pack; bind writes the pack fragment`. Body: the spec path, the evidence file path, and the three follow-ups from the spec's "Out of scope" as a short list. End with the attribution line the session reminder gives.

- [ ] **Step 3: Review and merge**

Wait for CodeRabbit and CI per the repo rules; address actionable findings; merge with confirmation. Then restart the dev daemon so the merged command is live (`rt daemon restart` from the main checkout on `main`).
