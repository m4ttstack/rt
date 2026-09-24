import { describe, expect, test } from "bun:test";
import { chooseZone, parseRemote, readZones, type InitFs, type ZoneInfo, addMarketplacePlugin, declareRepo, packDescription, PIPELINE_STAGES, renderPackFiles, initPack, type InitDeps, type RunResult } from "../init.ts";
import { stripJsonc } from "../sources.ts";

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
      verbs: { work: { engine: "work", description: "Use when running a unit of work." } } ,
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

  test("a throw from registerRepo after writing is materialize-failed, keeping wrote", async () => {
    const { deps } = world({
      registerRepo: async () => { throw new Error("daemon down"); },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: false, code: "materialize-failed" });
    if (out.ok || out.refused) return;
    expect(out.detail).toContain("daemon down");
    expect(out.wrote).toContain(`${HOME}/.mattstack/teams/acme/mattstack/packs/acme/pack/stubs.jsonc`);
  });

  test("zone-missing with a TTY prompts, but the created zone lands on a different host, so it refuses zone-mismatch naming the created zone", async () => {
    const { deps, fs } = world({
      gitRemote: async () => ({ kind: "ok", url: "git@gitlab.example.com:acme/api.git" }),
      isTTY: true,
      promptZone: async () => ({ name: "Beta", remote: "https://github.com/acme/mattstack-team-beta.git" }),
      createZone: async (name, remote) => {
        const dir = `${HOME}/.mattstack/teams/beta`;
        for (const [p, t] of Object.entries(zoneFiles("beta", {
          [`${dir}/mattstack/team.jsonc`]: `{ "gitlabHost": "https://github.com", "projects": [] }\n`,
        }))) fs.writeFile(p, t);
        return { slug: "beta", dir };
      },
    });
    const out = await initPack({ repoDir: REPO, zone: null }, deps);
    expect(out).toMatchObject({ ok: false, refused: true, code: "zone-mismatch" });
    if (out.ok || !out.refused) return;
    expect(out.detail).toContain("beta");
  });
});
