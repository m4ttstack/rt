/**
 * Spec 3 acceptance, stores: after a bump, a store still holding the old
 * name reads in the new shape; a write lands on key@2 with a baseline and
 * leaves the old name; the old name reads stale and check passes; an old
 * writer's edit (or re-creation after a prune) reads diverged, fails check
 * and blocks the prune. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../paths.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { checkStores } from "../check.ts";
import { explainSetting, getSetting } from "../resolve.ts";
import { pruneStoreName, setSetting } from "../write.ts";
import { withMigration } from "./with-migration.ts";

const EB = "rt.notify.eventBridges";
const V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const V2_EDITED = [{ match: "gate/opened/*", category: "gate", title: "Gate opened", message: "{question}" }];
const BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") }],
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
      required: ["match", "category", "title", "message"],
    },
  },
};

describe("spec 3 acceptance: a bumped key across a release", () => {
  const origHome = process.env.HOME;
  let home: string;
  const spies: { mockRestore(): void }[] = [];

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-accept-")));
    process.env.HOME = home;
    spies.push(spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}));
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const writeUser = (obj: unknown) => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), JSON.stringify(obj, null, 2));
  };
  const userRoot = () => parse(readFileSync(userSettingsPath(), "utf8")) as Record<string, unknown>;
  const label = () => explainSetting(EB).find((r) => r.scope === "user")!.olderLabel;

  test("old store reads new; a write adds key@2 and a baseline; old name reads stale; an old writer's edit reads diverged", () => {
    withMigration(EB, BUMP, () => {
      writeUser({ [EB]: V1 });
      expect(getSetting(EB).value).toEqual(V2);

      setSetting(EB, V2_EDITED, "user");
      expect(userRoot()[EB]).toEqual(V1);
      expect(userRoot()[`${EB}@2`]).toEqual(V2_EDITED);
      expect(label()).toBe("stale");
      expect(checkStores().failing).toBe(0);

      writeUser({ ...userRoot(), [EB]: [{ pattern: "gate/*", category: "gate", title: "Gate", message: "m" }] });
      expect(label()).toBe("diverged");
      const f = checkStores().findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ storeName: EB, currentValue: V2_EDITED });
      expect(checkStores().failing).toBe(1);
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("needs force");
    });
  });

  test("an old writer creating the old name where it was absent reads leftover only when it matches, else diverged", () => {
    withMigration(EB, BUMP, () => {
      setSetting(EB, V2, "user");
      writeUser({ ...userRoot(), [EB]: V1 });
      expect(label()).toBe("leftover");
      writeUser({ ...userRoot(), [EB]: [{ pattern: "other/*", category: "c", title: "t", message: "m" }] });
      expect(label()).toBe("diverged");
    });
  });
});
