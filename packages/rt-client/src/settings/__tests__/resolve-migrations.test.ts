/**
 * The resolver over versioned store names: an older name is migrated in
 * memory, a current name wins and labels the older names beside it, a name
 * from a newer rt is skipped and reported, $migrated is never a key. Same
 * HOME-per-test isolation as resolve.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath, userSettingsPath } from "../paths.ts";
import { getDef, type MigrationStep, type SettingDef } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { explainSetting, getSetting, listSettings, listUnregisteredSettings, mergedValueWith, repoSectionsFor } from "../resolve.ts";
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

const ROLES_SCHEMA_V2 = { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } };
const ROLES_BUMP = { storeVersion: 2, migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }], schema: ROLES_SCHEMA_V2 };

describe("settings/resolve over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-resolve-mig-")));
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
  const userRow = (key: string) => explainSetting(key).find((r) => r.scope === "user")!;

  test("a store holding only the old name reads in the new shape, and explain shows both", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1 });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const row = userRow(EB);
      expect(row).toMatchObject({ present: true, storeName: EB, storedVersion: 1, value: EB_V2, authored: EB_V1 });
      expect(row.olderNames).toBeUndefined();
      expect(row.nonconforming).toBeUndefined();
    });
  });

  test("every present store row names its store name; the default row does not", () => {
    writeUser({ [EB]: EB_V1 });
    const rows = explainSetting(EB);
    expect(rows.find((r) => r.scope === "user")).toMatchObject({ storeName: EB, storedVersion: 1, authored: EB_V1 });
    expect("storeName" in rows.find((r) => r.scope === "default")!).toBe(false);
  });

  test("the current name wins; an older name beside it is labeled leftover", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const row = userRow(EB);
      expect(row).toMatchObject({ storeName: `${EB}@2`, storedVersion: 2, olderLabel: "leftover" });
      expect(row.olderNames).toEqual([{ storeName: EB, storedVersion: 1, label: "leftover", value: EB_V2, authored: EB_V1 }]);
    });
  });

  test("stale and diverged older names carry both values on the row", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(userRow(EB).olderLabel).toBe("stale");
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const row = userRow(EB);
      expect(row.olderLabel).toBe("diverged");
      expect(row.value).toEqual(EB_V2_EDITED);
      expect(row.olderNames?.[0]).toMatchObject({ storeName: EB, label: "diverged", value: EB_V2 });
    });
  });

  test("a failing step keeps the stored value in effect, labeled nonconforming with the step named", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      writeUser({ [EB]: EB_V1 });
      expect(getSetting(EB).value).toEqual(EB_V1);
      expect(userRow(EB).nonconforming?.[0]).toEqual({ path: [], message: "migration 1 -> 2 threw: boom" });
    });
  });

  test("a name above this rt's storeVersion is skipped and reported as newer, never read", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@3`]: [{ anything: 1 }] });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const listed = listUnregisteredSettings();
      expect(listed).toContainEqual({ key: `${EB}@3`, scope: "user", file: userSettingsPath(), newer: true });
      expect(listed.map((u) => u.key)).not.toContain(EB);
      expect(listSettings().find((s) => s.key === `${EB}@3`)).toMatchObject({ unregistered: true, newer: true });
    });
  });

  test("older names at or below storeVersion are never unregistered", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      expect(listUnregisteredSettings()).toEqual([]);
    });
  });

  test("$migrated is never resolved or reported, globally or in a repo section", () => {
    writeUser({ $migrated: { [EB]: "sha256:0000000000000000" }, repos: { [IDENTITY]: { $migrated: {} } } });
    expect(listUnregisteredSettings()).toEqual([]);
    expect(listSettings().filter((s) => s.unregistered).map((s) => s.key)).toEqual([]);
  });

  test("a repo section reads, labels and reports a diverged older name on its repo rung", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./other.sh" } } } } });
      const row = explainSetting("rt.roles", { repoIdentity: IDENTITY }).find((r) => r.scope === "team.repo")!;
      expect(row.olderLabel).toBe("diverged");
      expect(row.olderNames?.[0]).toMatchObject({ storeName: "rt.roles", value: { web: { devHook: "./dev.sh" } } });
      expect(repoSectionsFor("rt.roles")).toContainEqual({ identity: IDENTITY, scopes: ["team"] });
    });
  });

  test("repoSectionsFor counts a section holding only the versioned current name", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      expect(repoSectionsFor("rt.roles")).toContainEqual({ identity: IDENTITY, scopes: ["team"] });
    });
  });

  test("listSettings flags a diverged layer", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      expect(listSettings().find((s) => s.key === EB)?.diverged).toEqual([{ scope: "user", file: userSettingsPath(), storeNames: [EB] }]);
    });
  });

  test("mergedValueWith patches the current store name, which then wins", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [`${EB}@2`]: EB_V2 });
      expect(mergedValueWith(getDef(EB) as SettingDef, { scope: "user", value: EB_V2_EDITED })).toEqual(EB_V2_EDITED);
    });
  });
});
