/**
 * The write path over versioned store names: a write lands on the current
 * name, never touches an older one, and records baselines only on the first
 * write of the current name; unset removes every name; prune removes one
 * older name through its own path. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { explainSetting, getSetting } from "../resolve.ts";
import { pruneStoreName, setSetting, unsetSetting } from "../write.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
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

const OLD_LINE = `  "${EB}": [{ "pattern": "gate/opened/*", "category": "gate", "title": "Gate", "message": "{question}" }],`;
// A property follows the old name: jsonc-parser's modify reformats the line of whatever property it appends after.
const OLD_TEXT = `// my notes\n{\n${OLD_LINE}\n  "rt.notifications": {}\n}\n`;

describe("settings/write over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let errSpy: ReturnType<typeof spyOn<Console, "error">>;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-write-mig-")));
    process.env.HOME = home;
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeText(text: string): void {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), text);
  }
  const writeUser = (obj: unknown) => writeText(JSON.stringify(obj, null, 2));
  const userText = () => readFileSync(userSettingsPath(), "utf8");
  const userRoot = () => parse(userText()) as Record<string, unknown>;
  const userRow = () => explainSetting(EB).find((r) => r.scope === "user")!;

  test("the first write of the current name leaves the old name byte for byte and records its baseline", () => {
    withMigration(EB, EB_BUMP, () => {
      writeText(OLD_TEXT);
      setSetting(EB, EB_V2_EDITED, "user");
      const text = userText();
      expect(text).toContain("// my notes");
      expect(text).toContain(OLD_LINE);
      const root = userRoot();
      expect(root[`${EB}@2`]).toEqual(EB_V2_EDITED);
      expect(root.$migrated).toEqual({ [EB]: valueHash(EB_V1) });
      expect(userRow().olderLabel).toBe("stale");
    });
  });

  test("later writes leave $migrated alone, so an old writer's edit reads diverged", () => {
    withMigration(EB, EB_BUMP, () => {
      writeText(OLD_TEXT);
      setSetting(EB, EB_V2, "user");
      const baseline = userRoot().$migrated;
      const root = userRoot();
      writeUser({ ...root, [EB]: [{ pattern: "edited/*", category: "c", title: "t", message: "m" }] });
      setSetting(EB, EB_V2_EDITED, "user");
      expect(userRoot().$migrated).toEqual(baseline);
      expect(userRow().olderLabel).toBe("diverged");
    });
  });

  test("a first write with no older name present records nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      setSetting(EB, EB_V2, "user");
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2 });
    });
  });

  test("a name already carrying a baseline keeps it; only names without one get one", () => {
    withMigration(EB, { storeVersion: 3, migrateFrom: [ebRename, { version: 2, up: (v) => v }], schema: EB_SCHEMA_V2 }, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: "sha256:0000000000000000" } });
      setSetting(EB, EB_V2_EDITED, "user");
      expect(userRoot().$migrated).toEqual({ [EB]: "sha256:0000000000000000", [`${EB}@2`]: valueHash(EB_V2) });
    });
  });

  test("a non-object $migrated is replaced wholesale rather than crashing the write", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, $migrated: null });
      setSetting(EB, EB_V2, "user");
      expect(userRoot().$migrated).toEqual({ [EB]: valueHash(EB_V1) });
      expect(userRoot()[`${EB}@2`]).toEqual(EB_V2);
    });
  });

  test("a repo-section write lands in that section with its own baseline and leaves the global section alone", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeUser({ repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } } } } });
      setSetting("rt.roles", { web: { devHook: "./dev.sh" } }, "user", { repoIdentity: IDENTITY });
      const root = userRoot();
      const section = (root.repos as Record<string, Record<string, unknown>>)[IDENTITY]!;
      expect(section["rt.roles"]).toEqual({ web: { hook: "./dev.sh" } });
      expect(section["rt.roles@2"]).toEqual({ web: { devHook: "./dev.sh" } });
      expect(section.$migrated).toEqual({ "rt.roles": valueHash({ web: { hook: "./dev.sh" } }) });
      expect(root.$migrated).toBeUndefined();
    });
  });

  test("unset removes every name of the key and their baselines, so the key reads as unset", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(unsetSetting(EB, "user")).toBe(true);
      expect(userRoot()).toEqual({});
      expect(getSetting(EB).provenance).toEqual([{ scope: "default", file: null }]);
    });
  });

  test("unset of a store holding only the old name removes it", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, "rt.notifications": {} });
      expect(unsetSetting(EB, "user")).toBe(true);
      expect(userRoot()).toEqual({ "rt.notifications": {} });
    });
  });

  test("unset refuses while an older name is diverged, and changes nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const before = userText();
      expect(() => unsetSetting(EB, "user")).toThrow("older store name edited after its current one");
      expect(userText()).toBe(before);
    });
  });

  test("prune removes a stale name and its baseline, dropping the emptied $migrated", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(pruneStoreName(EB, EB, "user")).toEqual({ removed: true, authored: EB_V1 });
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("prune refuses a diverged name without force and deletes it with force", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("needs force");
      expect(pruneStoreName(EB, EB, "user", { force: true })).toEqual({ removed: true, authored: EB_V1 });
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("prune refuses a name that is not an older name of the key, and a section with no current name", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1 });
      expect(() => pruneStoreName(EB, `${EB}@2`, "user")).toThrow("is not an older store name");
      expect(() => pruneStoreName(EB, "rt.roles", "user")).toThrow("is not an older store name");
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("rt settings migrate --write");
    });
  });

  test("a name an old writer recreates after a prune reads diverged", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      pruneStoreName(EB, EB, "user");
      writeUser({ ...userRoot(), [EB]: [{ pattern: "again/*", category: "c", title: "t", message: "m" }] });
      expect(userRow().olderLabel).toBe("diverged");
    });
  });
});
