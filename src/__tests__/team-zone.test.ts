import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeOnDemand, materializeTeamConfig, readTeamZone, stripJsonc } from "../team-zone.ts";

const zoneJsonc = `// team definition -- materialized into board config
{
  "gitlabHost": "https://gitlab.com",
  "projects": [
    "acme/acme-dev"
  ],
  "members": [
    { "username": "alice", "name": "Alice Ng" },
    { "username": "bob", "hidden": true }
  ],
  "title": "MR Board"
}
`;

/** A fresh mkdtemp clone dir containing mattstack/team.jsonc, either at the
    root or nested one level under `sub/`. */
function makeClone(nested: boolean = false): string {
  const cloneDir = mkdtempSync(join(tmpdir(), "team-zone-clone-"));
  const teamDir = nested ? join(cloneDir, "sub", "mattstack") : join(cloneDir, "mattstack");
  mkdirSync(teamDir, { recursive: true });
  writeFileSync(join(teamDir, "team.jsonc"), zoneJsonc);
  return cloneDir;
}

/** A fresh mkdtemp config.json with stale team fields plus board-only fields.
    `defaultMember` is overridable so tests can set it to a username the
    zone's roster does or doesn't have. */
function makeConfig(defaultMember?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "team-zone-config-"));
  const p = join(dir, "config.json");
  const base = {
    gitlabHost: "https://old.example.com",
    projects: ["stale/project"],
    members: [{ username: "stale", name: "Stale Person" }],
    title: "Old Title",
    port: 7930,
    reviewSkill: "myteam:review",
    staleAfterDays: 30,
    slack: { channel: "code-review" },
    ...(defaultMember !== undefined ? { defaultMember } : {}),
  };
  writeFileSync(p, JSON.stringify(base, null, 2) + "\n");
  return p;
}

describe("stripJsonc", () => {
  test("removes full-line comments and leaves everything else intact", () => {
    const raw = '// a comment\n{\n  "url": "https://example.com"\n}\n';
    expect(stripJsonc(raw)).toBe('{\n  "url": "https://example.com"\n}\n');
  });
});

describe("readTeamZone", () => {
  test("parses a comment-bearing team.jsonc at the clone root", () => {
    const cloneDir = makeClone();
    const zone = readTeamZone(cloneDir);
    expect(zone.gitlabHost).toBe("https://gitlab.com");
    expect(zone.projects).toEqual(["acme/acme-dev"]);
    expect(zone.title).toBe("MR Board");
    expect(zone.members).toEqual([
      { username: "alice", name: "Alice Ng" },
      { username: "bob", hidden: true },
    ]);
  });

  test("finds the zone nested one level deep", () => {
    const cloneDir = makeClone(true);
    const zone = readTeamZone(cloneDir);
    expect(zone.title).toBe("MR Board");
  });

  test("throws a descriptive error naming the searched path when missing", () => {
    const cloneDir = mkdtempSync(join(tmpdir(), "team-zone-empty-"));
    expect(() => readTeamZone(cloneDir)).toThrow(/team\.jsonc/);
    try {
      readTeamZone(cloneDir);
      throw new Error("expected readTeamZone to throw");
    } catch (err) {
      expect(err instanceof Error ? err.message : String(err)).toContain(cloneDir);
    }
  });
});

describe("materializeTeamConfig", () => {
  test("updates the four team fields to the zone's values and reports changed: true", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig();
    const result = materializeTeamConfig(cloneDir, configPath);
    expect(result.changed).toBe(true);
    expect(result.fields.sort()).toEqual(["gitlabHost", "members", "projects", "title"]);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.gitlabHost).toBe("https://gitlab.com");
    expect(onDisk.projects).toEqual(["acme/acme-dev"]);
    expect(onDisk.title).toBe("MR Board");
    expect(onDisk.members).toEqual([
      { username: "alice", name: "Alice Ng" },
      { username: "bob", hidden: true },
    ]);
  });

  test("board-only fields survive untouched", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig();
    materializeTeamConfig(cloneDir, configPath);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.port).toBe(7930);
    expect(onDisk.reviewSkill).toBe("myteam:review");
    expect(onDisk.staleAfterDays).toBe(30);
    expect(onDisk.slack).toEqual({ channel: "code-review" });
  });

  test("running twice reports changed: false the second time", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig();
    materializeTeamConfig(cloneDir, configPath);
    const second = materializeTeamConfig(cloneDir, configPath);
    expect(second).toEqual({ changed: false, fields: [] });
  });

  test("a defaultMember the zone's new roster no longer has is reset to \"all\" and reported", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig("carol"); // zone roster is alice/bob -- carol is stale
    const result = materializeTeamConfig(cloneDir, configPath);
    expect(result.changed).toBe(true);
    expect(result.fields).toContain("defaultMember");
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.defaultMember).toBe("all");
  });

  test("a defaultMember still present in the new roster is left alone", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig("alice"); // alice is in the zone's roster
    const result = materializeTeamConfig(cloneDir, configPath);
    expect(result.fields).not.toContain("defaultMember");
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    expect(onDisk.defaultMember).toBe("alice");
  });
});

describe("materializeOnDemand", () => {
  // BOARD-16: the on-demand leg (bin/materialize.ts) of the same materialize
  // the board's boot hook runs -- reads teamClone from config.json the same
  // minimal way, refuses when unset, otherwise delegates to
  // materializeTeamConfig.
  test("teamClone unset -> ok:false with a reason naming teamClone", () => {
    const configPath = makeConfig();
    const result = materializeOnDemand(configPath);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("teamClone");
  });

  test("changed true then false on second run", () => {
    const cloneDir = makeClone();
    const configPath = makeConfig();
    const obj = JSON.parse(readFileSync(configPath, "utf8"));
    obj.teamClone = cloneDir;
    writeFileSync(configPath, JSON.stringify(obj, null, 2) + "\n");

    const first = materializeOnDemand(configPath);
    expect(first).toEqual({
      ok: true,
      changed: true,
      fields: expect.arrayContaining(["gitlabHost", "members", "projects", "title"]),
    });

    const second = materializeOnDemand(configPath);
    expect(second).toEqual({ ok: true, changed: false, fields: [] });
  });
});
