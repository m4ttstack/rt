/**
 * `rt settings migrate`: dry run by default, --write is additive, --prune
 * deletes leftover and stale names only after confirmation, the team store
 * only with --team, a diverged name only with --force <key>.
 *
 * process.exitCode is primed with 0 and restored to 0: Bun keeps a nonzero
 * exit code when a later assignment is undefined.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsMigrate } from "../settings-keys.ts";
import { teamSettingsPath, userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { valueHash } from "../../packages/rt-client/src/settings/migrate.ts";
import { getDef } from "../../packages/rt-client/src/settings/registry-machinery.ts";
import { renameProperty } from "../../packages/rt-client/src/settings/migrations/helpers.ts";
import { withMigrationAsync } from "../../packages/rt-client/src/settings/__tests__/with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_BUMP = {
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
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

describe("rt settings migrate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;
  let errSpy: ReturnType<typeof spyOn<Console, "error">>;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-migrate-cli-")));
    process.env.HOME = home;
    process.exitCode = 0;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  const read = (file: string) => parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const printed = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  const allJsonBodies = () => logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const noPrompt = { interactive: false, confirm: async () => { throw new Error("must not prompt"); } };

  test("a dry run changes nothing and lists what --write would do", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate([], noPrompt);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
      expect(printed()).toContain(`would write ${EB}@2 from ${EB}`);
      expect(process.exitCode).toBe(0);
    });
  });

  test("--write adds the current name and a baseline, and leaves the old name", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      await settingsMigrate(["--write"], noPrompt);
      expect(read(userSettingsPath())).toEqual({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--write reaches the team store", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(teamSettingsPath(TEAM), { "rt.roles": { web: { hook: "./dev.sh" } } });
      await settingsMigrate(["--write"], noPrompt);
      expect(read(teamSettingsPath(TEAM))["rt.roles@2"]).toEqual({ web: { devHook: "./dev.sh" } });
    });
  });

  test("--write and --prune together is refused", async () => {
    await settingsMigrate(["--write", "--prune"], noPrompt);
    expect(process.exitCode).toBe(1);
  });

  test("--prune off a terminal without --yes refuses and changes nothing", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate(["--prune"], noPrompt);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
      expect(process.exitCode).toBe(1);
    });
  });

  test("--prune asks per store, names the storeVersion readers need, and removes leftover and stale names", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      const asked: string[] = [];
      await settingsMigrate(["--prune"], { interactive: true, confirm: async (m) => { asked.push(m); return true; } });
      expect(asked).toEqual([`Delete 1 older store name from the user store (${userSettingsPath()})?`]);
      expect(printed()).toContain(`${EB} (storeVersion 2)`);
      expect(read(userSettingsPath())).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--prune leaves the team store alone without --team, and prunes it with --team", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(teamSettingsPath(TEAM), { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } });
      await settingsMigrate(["--prune", "--yes"], noPrompt);
      expect(read(teamSettingsPath(TEAM))["rt.roles"]).toBeDefined();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await settingsMigrate(["--prune", "--team", "--yes"], noPrompt);
      expect(read(teamSettingsPath(TEAM))).toEqual({ "rt.roles@2": { web: { devHook: "./dev.sh" } } });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--prune refuses a diverged name without --force <key>, and prints its authored value before deleting it with one", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      await settingsMigrate(["--prune", "--yes"], noPrompt);
      expect(read(userSettingsPath())[EB]).toEqual(EB_V1);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await settingsMigrate(["--prune", "--yes", "--force", EB], noPrompt);
      expect(printed()).toContain(`deleting diverged ${EB}; its value was: ${JSON.stringify(EB_V1)}`);
      expect(read(userSettingsPath())).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("--prune --force with no key is a usage error, not a crash, and changes nothing", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate(["--prune", "--yes", "--force"], noPrompt);
      expect(process.exitCode).toBe(1);
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("--force needs a key");
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
    });
  });

  test("--force --yes does not take --yes as the forced key: a usage error, not a silent no-op force", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate(["--prune", "--force", "--yes"], noPrompt);
      expect(process.exitCode).toBe(1);
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("--force needs a key");
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
    });
  });

  test("a --force key with no older store name in the plan warns without failing, and other forced keys still prune", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      await settingsMigrate(["--prune", "--yes", "--force", EB, "--force", "rt.roles"], noPrompt);
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("--force rt.roles matches no older store name in this plan");
      expect(read(userSettingsPath())).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--json reports the plan", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      await settingsMigrate(["--json"], noPrompt);
      const body = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("{"))!) as { ok: boolean; writes: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.writes).toHaveLength(1);
    });
  });

  test("never shows a secret def's value, in text or --json", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      const def = getDef(EB)!;
      const savedSecret = def.secret;
      def.secret = true;
      try {
        write(userSettingsPath(), { [EB]: EB_V1 });
        await settingsMigrate([], noPrompt);
        expect(printed()).not.toContain(JSON.stringify(EB_V2));
        expect(printed()).toContain(`would write ${EB}@2 from ${EB}: (secret)`);

        await settingsMigrate(["--json"], noPrompt);
        const dryBody = allJsonBodies().at(-1) as { writes: Record<string, unknown>[] };
        expect(dryBody.writes[0]).not.toHaveProperty("value");
        expect(JSON.stringify(dryBody)).not.toContain(JSON.stringify(EB_V2).slice(1, -1));
        expect(JSON.stringify(dryBody)).not.toContain("(secret)");

        await settingsMigrate(["--write"], noPrompt);
        expect(read(userSettingsPath())[`${EB}@2`]).toEqual(EB_V2);

        write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
        await settingsMigrate(["--prune", "--yes", "--force", EB], noPrompt);
        expect(printed()).toContain(`deleting diverged ${EB}; its value was: (secret)`);
        expect(printed()).not.toContain(JSON.stringify(EB_V1));

        write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
        await settingsMigrate(["--prune", "--yes", "--force", EB, "--json"], noPrompt);
        const pruneBody = allJsonBodies().at(-1) as { pruned: Record<string, unknown>[] };
        expect(pruneBody.pruned[0]).not.toHaveProperty("authored");
        expect(pruneBody.pruned[0]).not.toHaveProperty("olderValue");
        expect(pruneBody.pruned[0]).not.toHaveProperty("currentValue");
      } finally {
        def.secret = savedSecret;
      }
    });
  });

  test("--prune refuses a diverged older name inside a repo section exactly as the global section, and --force clears it there too", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(teamSettingsPath(TEAM), {
        repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./other.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } } },
      });
      await settingsMigrate(["--prune", "--team", "--yes"], noPrompt);
      const before = read(teamSettingsPath(TEAM));
      expect((before.repos as Record<string, unknown>)[IDENTITY]).toMatchObject({ "rt.roles": { web: { hook: "./other.sh" } } });
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;

      await settingsMigrate(["--prune", "--team", "--yes", "--force", "rt.roles"], noPrompt);
      const after = read(teamSettingsPath(TEAM));
      expect(after).toEqual({ repos: { [IDENTITY]: { "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      expect(process.exitCode).toBe(0);
    });
  });
});
