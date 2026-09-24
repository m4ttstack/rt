import { describe, expect, test } from "bun:test";
import { chooseZone, parseRemote, readZones, type InitFs, type ZoneInfo, addMarketplacePlugin, declareRepo, packDescription, PIPELINE_STAGES, renderPackFiles } from "../init.ts";
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
    for (const text of Object.values(files)) expect(text).not.toMatch(/[–—]/);
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
