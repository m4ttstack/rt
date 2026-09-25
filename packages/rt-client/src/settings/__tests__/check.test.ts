/**
 * checkStores() — the read-only audit behind `rt settings check`: every
 * stored value against its type check and layer schema, every merged value
 * against the full schema, plus unregistered keys.
 *
 * Same HOME-per-test isolation as resolve.test.ts: store files are
 * process-global state, so tests must never share a tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../paths.ts";
import { checkStores } from "../check.ts";
import { withSchema } from "./with-schema.ts";

const SNAPSHOT = { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"] };
const WORKTREES = { type: "object", properties: { onDeck: { type: "number" } } };

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";

describe("settings/check", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-check-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  const writeUser = (obj: unknown) => write(userSettingsPath(), obj);
  const writeMachine = (obj: unknown) => write(machineSettingsPath(), obj);
  const writeTeam = (name: string, obj: unknown) => write(teamSettingsPath(name), obj);

  test("reports a nonconforming layer, a type-invalid layer, a merged failure and an unregistered key", () => {
    withSchema("rt.homeSnapshot", SNAPSHOT, () => {
      writeMachine({ "rt.homeSnapshot": { enabled: "yes" }, "rt.repoRoots": "nope", "board.rtRepos": [] });
      const report = checkStores();
      const kinds = report.findings.map((f) => `${f.key}:${f.kind}`);
      expect(kinds).toContain("rt.homeSnapshot:nonconforming");
      expect(kinds).toContain("rt.homeSnapshot:merged");
      expect(kinds).toContain("rt.repoRoots:invalid");
      expect(kinds).toContain("board.rtRepos:unregistered");
      expect(report.failing).toBe(3);
    });
  });

  test("walks repo sections and reports the repo", () => {
    withSchema("rt.worktrees", WORKTREES, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: "two" } } } });
      const f = checkStores().findings.find((x) => x.key === "rt.worktrees" && x.kind === "nonconforming")!;
      expect(f.repo).toBe(IDENTITY);
      expect(f.scope).toBe("team");
    });
  });

  test("reports invalid and nonconforming values written to the user store", () => {
    withSchema("rt.worktrees", WORKTREES, () => {
      writeUser({ "rt.notifications": "nope", "rt.worktrees": { onDeck: "two" } });
      const findings = checkStores().findings;

      const invalid = findings.find((f) => f.key === "rt.notifications")!;
      expect(invalid.kind).toBe("invalid");
      expect(invalid.scope).toBe("user");
      expect(invalid.file).toBe(userSettingsPath());

      const nonconforming = findings.find((f) => f.key === "rt.worktrees" && f.kind === "nonconforming")!;
      expect(nonconforming.scope).toBe("user");
    });
  });

  test("walks the user store's own repo sections too", () => {
    withSchema("rt.worktrees", WORKTREES, () => {
      writeUser({ repos: { [IDENTITY]: { "rt.worktrees": { onDeck: "two" } } } });
      const f = checkStores().findings.find((x) => x.key === "rt.worktrees" && x.kind === "nonconforming")!;
      expect(f.scope).toBe("user");
      expect(f.repo).toBe(IDENTITY);
    });
  });

  test("clean stores report nothing failing", () => {
    writeMachine({ "rt.repoRoots": ["~/Documents/GitHub"] });
    expect(checkStores().failing).toBe(0);
  });
});
