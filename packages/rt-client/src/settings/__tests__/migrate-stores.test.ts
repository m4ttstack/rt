/**
 * planStoreMigrations: what `rt settings migrate` would write (a current
 * name absent, an older one present), what it cannot carry, and every older
 * name beside a current one with its label. Read-only. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { planStoreMigrations } from "../migrate-stores.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
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

describe("planStoreMigrations", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-plan-mig-")));
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

  test("lists a write where the current name is absent, with the migrated value, and changes nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      const before = readFileSync(userSettingsPath(), "utf8");
      const plan = planStoreMigrations();
      expect(plan.writes).toEqual([{ key: EB, scope: "user", file: userSettingsPath(), fromName: EB, fromVersion: 1, storeName: `${EB}@2`, value: EB_V2 }]);
      expect(plan.failures).toEqual([]);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
    });
  });

  test("lists a value the chain cannot carry as a failure", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      expect(planStoreMigrations().failures).toEqual([{ key: EB, scope: "user", file: userSettingsPath(), fromName: EB, message: "migration 1 -> 2 threw: boom" }]);
    });
  });

  test("lists older names beside current ones, with the team name and repo", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      write(teamSettingsPath(TEAM), { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      expect(planStoreMigrations().older).toEqual([{
        key: "rt.roles",
        scope: "team",
        team: TEAM,
        file: teamSettingsPath(TEAM),
        repo: IDENTITY,
        storeName: "rt.roles",
        storedVersion: 1,
        storeVersion: 2,
        label: "leftover",
        olderValue: { web: { devHook: "./dev.sh" } },
        currentValue: { web: { devHook: "./dev.sh" } },
        authored: { web: { hook: "./dev.sh" } },
      }]);
    });
  });

  test("skips a key found in a store its def does not allow", () => {
    withMigration(EB, EB_BUMP, () => {
      write(machineSettingsPath(), { [EB]: EB_V1 });
      expect(planStoreMigrations().writes).toEqual([]);
    });
  });
});
