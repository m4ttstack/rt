import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeTeamConfig, readTeamZone, stripJsonc } from "../team-zone.ts";

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

/** A fresh mkdtemp config.json with stale team fields plus board-only fields. */
function makeConfig(): string {
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
});
