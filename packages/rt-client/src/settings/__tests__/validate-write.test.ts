/**
 * settings/validate-write.ts: the one write gate, type check then layer
 * schema then the merged result. Re-points HOME per test (the write.test.ts /
 * resolve.test.ts pattern): store files are process-global state.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../paths.ts";
import { getDef } from "../registry-machinery.ts";
import { setSettingsWarnSink } from "../resolve.ts";
import { validateWrite } from "../validate-write.ts";
import { withSchema } from "./with-schema.ts";

const IDENTITY = "gitlab.com/acme/acme-dev";
const IDENTITY2 = "gitlab.com/acme/acme-other";
const TEAM = "acme";
const OTHER_TEAM = "acme-two";

const SNAPSHOT = { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"] };
const ROLES = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] };
const GIT_STATUS = { type: "object", properties: { sweep: { type: "boolean" }, sweepIntervalSec: { type: "number", minimum: 1 }, fetchIntervalSec: { type: "number" } }, required: ["sweep", "sweepIntervalSec", "fetchIntervalSec"] };
const WORKTREES = { type: "object", properties: { onDeck: { type: "number", minimum: 0 }, name: { type: "string" } }, required: ["onDeck"] };
const NAMED_WORKTREES = { type: "object", properties: { onDeck: { type: "number" }, name: { type: "string" } }, dependentSchemas: { name: { properties: { onDeck: { maximum: 1 } } } } };

describe("settings/validate-write", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-validate-write-")));
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
  const writeTeam = (name: string, obj: unknown) => write(teamSettingsPath(name), obj);

  test("type check still comes first", () => {
    const r = validateWrite(getDef("rt.homeSnapshot")!, "nope", { scope: "machine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("expected object");
  });

  test("a partial deep layer at machine scope is allowed", () => {
    withSchema("rt.homeSnapshot", SNAPSHOT, () => {
      expect(validateWrite(getDef("rt.homeSnapshot")!, { enabled: false }, { scope: "machine" })).toEqual({ ok: true });
    });
  });

  test("a wrongly typed field in a layer is refused with its path", () => {
    withSchema("rt.homeSnapshot", SNAPSHOT, () => {
      const r = validateWrite(getDef("rt.homeSnapshot")!, { enabled: "yes" }, { scope: "machine" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("enabled: expected boolean, got string");
    });
  });

  test("a replace key is checked against the full schema", () => {
    withSchema("rt.repoRoots", { type: "array", items: { type: "string" } }, () => {
      const r = validateWrite(getDef("rt.repoRoots")!, [1], { scope: "machine" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("[0]: expected string, got number");
    });
  });

  test("a limit inside a layer is refused by the layer check itself", () => {
    withSchema("rt.gitStatus", GIT_STATUS, () => {
      const r = validateWrite(getDef("rt.gitStatus")!, { sweepIntervalSec: 0 }, { scope: "machine" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("sweepIntervalSec: must be >= 1");
    });
  });

  test("the merged result is refused only when it fails where it passed before", () => {
    // rt.roles: deep, no registry default, allowed in every store; the layer schema
    // makes `a` optional, so a layer of `{ b }` passes on its own.
    withSchema("rt.roles", ROLES, () => {
      const def = getDef("rt.roles")!;
      const first = validateWrite(def, { b: 1 }, { scope: "machine" });
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.reason).toBe('merged value would fail: a: required property "a" is missing');
      writeUser({ "rt.roles": { a: "x" } });
      expect(validateWrite(def, { b: 1 }, { scope: "machine" })).toEqual({ ok: true });
      writeUser({ "rt.roles": { b: 2 } });
      // The merge already fails on the user layer; an unrelated machine edit still lands.
      expect(validateWrite(def, { b: 3 }, { scope: "machine" })).toEqual({ ok: true });
    });
  });

  test("a global write of a repo-scoped key checks every repo section's merge", () => {
    withSchema("rt.worktrees", WORKTREES, () => {
      const def = getDef("rt.worktrees")!;
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
      expect(validateWrite(def, { name: "x" }, { scope: "user" })).toEqual({ ok: true });
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: -1 } } } });
      // The repo section already fails; an unrelated global edit still lands.
      expect(validateWrite(def, { name: "y" }, { scope: "user" })).toEqual({ ok: true });
    });
  });

  test("a global write that newly breaks one repo section's merge is refused for that repo", () => {
    withSchema("rt.worktrees", NAMED_WORKTREES, () => {
      const def = getDef("rt.worktrees")!;
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
      // The global merge alone passes; only IDENTITY's section, whose onDeck the
      // new name caps at 1, starts failing.
      const r = validateWrite(def, { name: "x" }, { scope: "user" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(`merged value for ${IDENTITY} would fail: onDeck: must be <= 1`);
    });
  });

  test("the merged check emits no resolver warnings for a type-invalid layer elsewhere", () => {
    const warnings: string[] = [];
    setSettingsWarnSink((msg) => warnings.push(msg));
    try {
      withSchema("rt.roles", ROLES, () => {
        write(machineSettingsPath(), { "rt.roles": "nope" });
        const r = validateWrite(getDef("rt.roles")!, { b: 1 }, { scope: "user" });
        expect(r.ok).toBe(false);
        expect(warnings).toEqual([]);
      });
    } finally {
      setSettingsWarnSink(null);
    }
  });

  test("a repo section write checks that repo's merge", () => {
    withSchema("rt.worktrees", WORKTREES, () => {
      const r = validateWrite(getDef("rt.worktrees")!, { onDeck: -1 }, { scope: "user", repoIdentity: IDENTITY });
      expect(r.ok).toBe(false);
    });
  });

  test("a repo section write is checked against that repo's own merge, not another repo's", () => {
    withSchema("rt.roles", ROLES, () => {
      const def = getDef("rt.roles")!;
      writeTeam(TEAM, { repos: { [IDENTITY2]: { "rt.roles": { a: "x" } } } });
      // IDENTITY has nothing supplying "a" anywhere; the layer `{ b: 1 }`
      // passes on its own (the layer schema makes "a" optional) but the
      // merge for THIS repo section has no "a" at all.
      const refused = validateWrite(def, { b: 1 }, { scope: "user", repoIdentity: IDENTITY });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe(`merged value for ${IDENTITY} would fail: a: required property "a" is missing`);
      // IDENTITY2's team layer already supplies "a"; the same write there merges cleanly.
      expect(validateWrite(def, { b: 1 }, { scope: "user", repoIdentity: IDENTITY2 })).toEqual({ ok: true });
    });
  });

  test("a named team write patches only that team's store, not every local team", () => {
    withSchema("rt.roles", ROLES, () => {
      const def = getDef("rt.roles")!;
      writeTeam(TEAM, {});
      writeTeam(OTHER_TEAM, { "rt.roles": { a: "x" } });
      // TEAM's own layer lacks "a"; OTHER_TEAM's real store already supplies
      // it. If the write clobbered every local team store (rather than only
      // the named one) OTHER_TEAM's "a" would be erased and this merge would
      // wrongly fail.
      expect(validateWrite(def, { b: 1 }, { scope: "team", team: TEAM })).toEqual({ ok: true });
    });
  });

  test("a team write with no local team store has no merge to check and leaves the refusal to setSetting", () => {
    expect(validateWrite(getDef("rt.roles")!, { backend: {} }, { scope: "team", repoIdentity: IDENTITY })).toEqual({ ok: true });
    expect(validateWrite(getDef("rt.roles")!, { backend: {} }, { scope: "team", repoIdentity: IDENTITY, team: "ghost-team" })).toEqual({ ok: true });
  });
});
