/**
 * checkStores over versioned store names: diverged older names fail with
 * both values, stale and leftover ones are listed without failing, a value
 * the chain cannot carry fails, and a name from a newer rt is listed.
 * HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath, userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { checkStores } from "../check.ts";
import { storeSections } from "../migrate-stores.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_SCHEMA_V2 = {
  type: "array",
  items: {
    type: "object",
    properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
    required: ["match", "category", "title", "message"],
  },
};
const ebRename: MigrationStep = { version: 1, up: (v) => renameProperty(v, ["[]"], "pattern", "match") };
const EB_BUMP = { storeVersion: 2, migrateFrom: [ebRename], schema: EB_SCHEMA_V2 };
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

describe("settings/check over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-check-mig-")));
    process.env.HOME = home;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  const writeUser = (obj: unknown) => write(userSettingsPath(), obj);
  const writeTeam = (name: string, obj: unknown) => write(teamSettingsPath(name), obj);

  test("storeSections walks team, user and machine stores, global then repo sections", () => {
    writeTeam(TEAM, { a: 1, repos: { [IDENTITY]: { b: 2 } } });
    writeUser({ c: 3 });
    expect(storeSections().map((s) => [s.scope, s.team ?? null, s.repo ?? null])).toEqual([
      ["team", TEAM, null],
      ["team", TEAM, IDENTITY],
      ["user", null, null],
    ]);
  });

  test("a diverged older name fails with both values", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const report = checkStores();
      const f = report.findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ key: EB, scope: "user", file: userSettingsPath(), storeName: EB, olderValue: EB_V2, currentValue: EB_V2_EDITED });
      expect(report.failing).toBe(1);
    });
  });

  test("stale and leftover older names are listed and do not fail", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      let report = checkStores();
      expect(report.findings.map((f) => f.kind)).toContain("stale");
      expect(report.failing).toBe(0);
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      report = checkStores();
      expect(report.findings.map((f) => f.kind)).toContain("leftover");
      expect(report.failing).toBe(0);
    });
  });

  test("a value the chain cannot carry fails, naming the step", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      writeUser({ [EB]: EB_V1 });
      const f = checkStores().findings.find((x) => x.key === EB && x.kind === "nonconforming")!;
      expect(f.issues[0]).toEqual({ path: [], message: "migration 1 -> 2 threw: boom" });
    });
  });

  test("a diverged older name in a team repo section is found and names the repo", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./other.sh" } } } } });
      const f = checkStores().findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ key: "rt.roles", scope: "team", repo: IDENTITY, storeName: "rt.roles" });
    });
  });

  test("a name from a newer rt is listed as unregistered and newer, and $migrated not at all", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [`${EB}@3`]: [], $migrated: {} });
      const report = checkStores();
      expect(report.findings).toContainEqual({ key: `${EB}@3`, scope: "user", file: userSettingsPath(), kind: "unregistered", issues: [], newer: true });
      expect(report.findings.map((f) => f.key)).not.toContain("$migrated");
      expect(report.failing).toBe(0);
    });
  });
});
