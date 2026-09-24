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
