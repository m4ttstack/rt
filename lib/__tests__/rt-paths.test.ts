/**
 * rt-paths — the single source of truth for the ~/.mattstack/rt layout.
 *
 * The source-scanning tripwires that guard this layout (no hand-built
 * <rtDir>/<repoName> joins, no legacy `.rt` path literal outside rt-paths.ts)
 * live in no-hand-built-repo-paths.test.ts, where the always-run glob finds
 * them.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "fs";
import * as osReal from "os";
import { tmpdir } from "os";
// `mock.module` mutates the live "os" namespace object in place, so
// `osReal.hostname` itself becomes the mock the moment it's installed —
// restoring with `() => osReal` would restore the mock to itself. Capture
// the real function BEFORE any test can call mock.module("os", ...).
const realHostname = osReal.hostname;
import { basename, dirname, join } from "path";
import {
  rtDir, reposDir, repoDataDir, logsDir,
  worktreePoolRoot, legacyWorktreePoolRoots, goldenRoot,
  migrateLegacyRtDir, legacyDirsPresent,
  TRAY_APP_NAME, DEV_TRAY_APP_NAME, TRAY_APP_BUNDLE, DEV_TRAY_APP_BUNDLE,
  trayAppPath, devTrayAppPath, legacyTrayAppPaths, installedTrayAppPath, machineSettingsPath,
  legacyUserAppPath, trayAppInstallDest,
  machineKey, userSettingsPath, teamSettingsPath, isSafeMachineKeySegment,
} from "../rt-paths.ts";

describe("rt-paths", () => {
  const origHome = process.env.HOME;
  afterEach(() => { process.env.HOME = origHome; });

  test("per-repo data dir nests under ~/.mattstack/rt/repos/<repo> at call-time HOME", () => {
    process.env.HOME = "/tmp/fake-home-abc";
    expect(rtDir()).toBe("/tmp/fake-home-abc/.mattstack/rt");
    expect(reposDir()).toBe("/tmp/fake-home-abc/.mattstack/rt/repos");
    expect(repoDataDir("my-repo")).toBe("/tmp/fake-home-abc/.mattstack/rt/repos/my-repo");
  });

  test("HOME is resolved at call time (a later change takes effect)", () => {
    process.env.HOME = "/tmp/home-1";
    expect(repoDataDir("r")).toBe("/tmp/home-1/.mattstack/rt/repos/r");
    process.env.HOME = "/tmp/home-2";
    expect(repoDataDir("r")).toBe("/tmp/home-2/.mattstack/rt/repos/r");
  });

  test("logsDir follows HOME at call time (guards against test log pollution)", () => {
    // A module-load-time const here is what made the daemon and CLI loggers
    // write into the developer's real logs dir during tests, no matter what
    // HOME the test had set.
    process.env.HOME = "/tmp/home-logs-1";
    expect(logsDir()).toBe("/tmp/home-logs-1/.mattstack/rt/logs");
    process.env.HOME = "/tmp/home-logs-2";
    expect(logsDir()).toBe("/tmp/home-logs-2/.mattstack/rt/logs");
  });

  test("a repo dir is NEVER directly under the rt dir (regression guard for the move)", () => {
    process.env.HOME = "/tmp/h";
    expect(repoDataDir("x")).toBe(join(reposDir(), "x"));
    expect(repoDataDir("x")).not.toBe(join(rtDir(), "x"));
  });

  // ── Settings store paths (home-repo reroot) ─────────────────────────────────

  describe("settings store path shapes", () => {
    test("userSettingsPath nests under user/settings.user.jsonc", () => {
      process.env.HOME = "/tmp/fake-home-store-1";
      expect(userSettingsPath()).toBe("/tmp/fake-home-store-1/.mattstack/user/settings.user.jsonc");
    });

    test("machineSettingsPath nests under user/local/<machineKey()>/settings.local.jsonc", () => {
      const home = mkdtempSync(join(tmpdir(), "rt-paths-machine-store-"));
      process.env.HOME = home;
      expect(machineSettingsPath()).toBe(join(home, ".mattstack", "user", "local", machineKey(), "settings.local.jsonc"));
      rmSync(home, { recursive: true, force: true });
    });

    test("teamSettingsPath nests under teams/<team>/mattstack/settings.team.jsonc", () => {
      process.env.HOME = "/tmp/fake-home-store-2";
      expect(teamSettingsPath("acme")).toBe("/tmp/fake-home-store-2/.mattstack/teams/acme/mattstack/settings.team.jsonc");
    });
  });

  describe("machineKey", () => {
    const makeKeyHome = () => mkdtempSync(join(tmpdir(), "rt-paths-machine-key-"));

    afterEach(() => {
      mock.module("os", () => ({ ...osReal, hostname: realHostname }));
    });

    test("an override file wins, trimmed", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), "  my-custom-key  \n");
      expect(machineKey()).toBe("my-custom-key");
      rmSync(home, { recursive: true, force: true });
    });

    test("an override file that is empty after trim falls through to the hostname slug", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), "   \n");
      mock.module("os", () => ({ ...osReal, hostname: () => "Real-Host" }));
      expect(machineKey()).toBe("real-host");
      rmSync(home, { recursive: true, force: true });
    });

    // An override becomes a directory name directly under user/local/, so a
    // value that isn't a safe single path segment must not be honored — it
    // would escape that directory (a separator) or resolve to a no-op/parent
    // segment (".", "..") instead of a distinct machine's namespace.
    test.each([
      ["a forward slash", "evil/key"],
      ["a backslash", "evil\\key"],
      ["exactly \".\"", "."],
      ["exactly \"..\"", ".."],
    ])("an override value containing %s is rejected — falls through to the hostname slug", (_label, unsafe) => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), unsafe);
      mock.module("os", () => ({ ...osReal, hostname: () => "Safe-Host" }));
      expect(machineKey()).toBe("safe-host");
      rmSync(home, { recursive: true, force: true });
    });

    test("no override file at all: falls through to the hostname slug", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "Some-Host" }));
      expect(machineKey()).toBe("some-host");
      rmSync(home, { recursive: true, force: true });
    });

    test("hostname slug: lowercased, trailing .local stripped", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "Matts-MacBook-Pro.local" }));
      expect(machineKey()).toBe("matts-macbook-pro");
      rmSync(home, { recursive: true, force: true });
    });

    test("hostname slug: illegal characters collapse to single dashes, edges trimmed", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "  weird_host!!name@@ " }));
      expect(machineKey()).toBe("weird-host-name");
      rmSync(home, { recursive: true, force: true });
    });

    test("hostname slug: an all-illegal hostname slugs to empty and falls back to \"default\"", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "!!!" }));
      expect(machineKey()).toBe("default");
      rmSync(home, { recursive: true, force: true });
    });
  });

  describe("isSafeMachineKeySegment", () => {
    test.each([
      ["a plain slug", "mbp-14", true],
      ["empty", "", false],
      ["exactly \".\"", ".", false],
      ["exactly \"..\"", "..", false],
      ["a forward slash", "evil/key", false],
      ["a backslash", "evil\\key", false],
    ])("%s -> %s", (_label, value, expected) => {
      expect(isSafeMachineKeySegment(value)).toBe(expected);
    });
  });

  // ── migrateLegacyRtDir ───────────────────────────────────────────────────────

  const makeHome = () => mkdtempSync(join(tmpdir(), "rt-paths-migrate-"));

  test("migrate: no ~/.rt at all → none, nothing created", () => {
    const home = makeHome();
    process.env.HOME = home;
    expect(migrateLegacyRtDir()).toBe("none");
    expect(existsSync(join(home, ".mattstack"))).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: ~/.rt is a symlink → none, symlink untouched", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    symlinkSync(join(home, ".mattstack", "rt"), join(home, ".rt"));
    expect(migrateLegacyRtDir()).toBe("none");
    expect(lstatSync(join(home, ".rt")).isSymbolicLink()).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: real ~/.rt, no ~/.mattstack/rt → renamed, contents intact", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt", "repos"), { recursive: true });
    writeFileSync(join(home, ".rt", "repos.json"), "{}");
    expect(migrateLegacyRtDir()).toBe("migrated");
    expect(existsSync(join(home, ".rt"))).toBe(false);
    expect(readFileSync(join(home, ".mattstack", "rt", "repos.json"), "utf8")).toBe("{}");
    expect(statSync(join(home, ".mattstack", "rt", "repos")).isDirectory()).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: real ~/.rt AND ~/.mattstack/rt exists → conflict, both untouched", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt"), { recursive: true });
    writeFileSync(join(home, ".rt", "repos.json"), "{}"); // rt signature marker (S099)
    writeFileSync(join(home, ".rt", "old.json"), "old");
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    writeFileSync(join(home, ".mattstack", "rt", "new.json"), "new");
    expect(migrateLegacyRtDir()).toBe("conflict");
    expect(readFileSync(join(home, ".rt", "old.json"), "utf8")).toBe("old");
    expect(readFileSync(join(home, ".mattstack", "rt", "new.json"), "utf8")).toBe("new");
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate is idempotent: second call after a migration is a no-op", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt"), { recursive: true });
    writeFileSync(join(home, ".rt", "repos.json"), "{}"); // rt signature marker (S099)
    expect(migrateLegacyRtDir()).toBe("migrated");
    expect(migrateLegacyRtDir()).toBe("none");
    rmSync(home, { recursive: true, force: true });
  });

  // S099: a new user who has never run rt, but has another tool that also
  // uses ~/.rt as its config dir, must not have that directory silently
  // annexed as rt state (parsed, quarantined, or renamed) — only a
  // directory carrying an actual rt signature is ever touched.
  test("migrate: a foreign ~/.rt with no rt signature is left alone, no ~/.mattstack/rt materializes (S099)", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt"), { recursive: true });
    writeFileSync(join(home, ".rt", "config.toml"), "some-other-tools-config");
    const result = migrateLegacyRtDir();
    expect(result).not.toBe("migrated");
    expect(result).not.toBe("conflict");
    expect(readFileSync(join(home, ".rt", "config.toml"), "utf8")).toBe("some-other-tools-config");
    expect(existsSync(join(home, ".mattstack", "rt"))).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: a foreign ~/.rt is left alone even when ~/.mattstack/rt already exists — not reported as a conflict (S099)", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt"), { recursive: true });
    writeFileSync(join(home, ".rt", "config.toml"), "some-other-tools-config");
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    const result = migrateLegacyRtDir();
    expect(result).not.toBe("conflict");
    expect(readFileSync(join(home, ".rt", "config.toml"), "utf8")).toBe("some-other-tools-config");
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: a bare 'logs' dir alone is a sufficient rt signature", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt", "logs"), { recursive: true });
    expect(migrateLegacyRtDir()).toBe("migrated");
    rmSync(home, { recursive: true, force: true });
  });

  test("migrate: a bare 'state.db' file alone is a sufficient rt signature", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(join(home, ".rt"), { recursive: true });
    writeFileSync(join(home, ".rt", "state.db"), "");
    expect(migrateLegacyRtDir()).toBe("migrated");
    rmSync(home, { recursive: true, force: true });
  });

  // ── legacyDirsPresent (the canary probe) ────────────────────────────────────

  test("canary: reports real legacy dirs, ignores symlinks, skips absent", () => {
    const home = makeHome();
    process.env.HOME = home;

    // Nothing there at all.
    expect(legacyDirsPresent()).toEqual({ real: [], symlinks: [] });

    // ~/.rt as a symlink (compat shim) + ~/.shepherdr as a real dir.
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    symlinkSync(join(home, ".mattstack", "rt"), join(home, ".rt"));
    mkdirSync(join(home, ".shepherdr"), { recursive: true });
    expect(legacyDirsPresent()).toEqual({
      real: [join(home, ".shepherdr")],
      symlinks: [join(home, ".rt")],
    });

    // Both as real dirs.
    rmSync(join(home, ".rt"));
    mkdirSync(join(home, ".rt"), { recursive: true });
    expect(legacyDirsPresent()).toEqual({
      real: [join(home, ".rt"), join(home, ".shepherdr")],
      symlinks: [],
    });

    rmSync(home, { recursive: true, force: true });
  });

  // ── Tray app paths (MAT-383 §2) ─────────────────────────────────────────────

  test("tray app constants match the spec verbatim", () => {
    expect(TRAY_APP_NAME).toBe("mattstack");
    expect(DEV_TRAY_APP_NAME).toBe("mattstack-dev");
    expect(TRAY_APP_BUNDLE).toBe("mattstack.app");
    expect(DEV_TRAY_APP_BUNDLE).toBe("mattstack-dev.app");
  });

  test("trayAppPath resolves under ~/Applications at call-time HOME when that's the only candidate present", () => {
    const onlyUnderHome = (p: string) => p === join(process.env.HOME!, "Applications", TRAY_APP_BUNDLE);
    process.env.HOME = "/tmp/fake-home-tray-1";
    expect(trayAppPath(onlyUnderHome)).toBe("/tmp/fake-home-tray-1/Applications/mattstack.app");
    process.env.HOME = "/tmp/fake-home-tray-2";
    expect(trayAppPath(onlyUnderHome)).toBe("/tmp/fake-home-tray-2/Applications/mattstack.app");
  });

  test("devTrayAppPath resolves under ~/Applications at call-time HOME when that's the only candidate present", () => {
    const onlyUnderHome = (p: string) => p === join(process.env.HOME!, "Applications", DEV_TRAY_APP_BUNDLE);
    process.env.HOME = "/tmp/fake-home-dev-tray-1";
    expect(devTrayAppPath(onlyUnderHome)).toBe("/tmp/fake-home-dev-tray-1/Applications/mattstack-dev.app");
    process.env.HOME = "/tmp/fake-home-dev-tray-2";
    expect(devTrayAppPath(onlyUnderHome)).toBe("/tmp/fake-home-dev-tray-2/Applications/mattstack-dev.app");
  });

  test("trayAppPath prefers the installed bundle (machine key, /Applications, ~/Applications) and defaults to /Applications", () => {
    const none = () => false;
    expect(trayAppPath(none)).toBe("/Applications/mattstack.app");
    expect(devTrayAppPath(none)).toBe("/Applications/mattstack-dev.app");
    const userOnly = (p: string) => p === join(process.env.HOME!, "Applications", "mattstack.app");
    expect(trayAppPath(userOnly)).toBe(join(process.env.HOME!, "Applications", "mattstack.app"));
  });

  test("legacyUserAppPath and trayAppInstallDest resolve under ~/Applications at call-time HOME", () => {
    process.env.HOME = "/tmp/fake-home-legacy-user-app-1";
    expect(legacyUserAppPath()).toBe("/tmp/fake-home-legacy-user-app-1/Applications/mattstack.app");
    expect(trayAppInstallDest()).toBe("/tmp/fake-home-legacy-user-app-1/Applications/mattstack.app");
    process.env.HOME = "/tmp/fake-home-legacy-user-app-2";
    expect(legacyUserAppPath()).toBe("/tmp/fake-home-legacy-user-app-2/Applications/mattstack.app");
    expect(trayAppInstallDest()).toBe("/tmp/fake-home-legacy-user-app-2/Applications/mattstack.app");
  });

  test("legacyTrayAppPaths is a function (call-time HOME rule, not a const)", () => {
    // The module docblock's call-time-HOME rule forbids baking HOME at module
    // load — legacyTrayAppPaths must be callable, not a top-level array.
    expect(typeof legacyTrayAppPaths).toBe("function");
  });

  test("legacyTrayAppPaths tracks HOME at call time and includes the old ~/Applications/rt-tray.app", () => {
    process.env.HOME = "/tmp/fake-home-legacy-1";
    const first = legacyTrayAppPaths();
    expect(first).toContain("/tmp/fake-home-legacy-1/Applications/rt-tray.app");

    process.env.HOME = "/tmp/fake-home-legacy-2";
    const second = legacyTrayAppPaths();
    expect(second).toContain("/tmp/fake-home-legacy-2/Applications/rt-tray.app");
    expect(second).not.toContain("/tmp/fake-home-legacy-1/Applications/rt-tray.app");
  });

  test("legacyTrayAppPaths also carries the binary-relative candidates (mirrors verify.ts/post-install.ts)", () => {
    process.env.HOME = "/tmp/fake-home-legacy-3";
    const candidates = legacyTrayAppPaths();
    const rtExec = process.execPath;
    expect(candidates).toContain(join(rtExec, "../rt-tray.app"));
    expect(candidates).toContain(join(rtExec, "../../rt-tray.app"));
  });

  test("legacyTrayAppPaths sweeps both /Applications and ~/Applications", () => {
    process.env.HOME = "/tmp/fake-home-legacy-4";
    const candidates = legacyTrayAppPaths();
    expect(candidates).toContain("/Applications/rt-tray.app");
    expect(candidates).toContain("/tmp/fake-home-legacy-4/Applications/rt-tray.app");
  });

  // ── installedTrayAppPath (Item 5: rt hardcodes ~/Applications in four places) ──

  describe("installedTrayAppPath", () => {
    const makeHome = () => mkdtempSync(join(tmpdir(), "rt-paths-installed-tray-"));
    const bundle = "mattstack.app";

    test("the mattstack.appPath machine setting wins over both fixed locations", () => {
      const home = makeHome();
      process.env.HOME = home;
      mkdirSync(dirname(machineSettingsPath()), { recursive: true });
      writeFileSync(machineSettingsPath(), JSON.stringify({ "mattstack.appPath": "/custom/place/mattstack.app" }));

      const exists = (p: string) => p === "/custom/place/mattstack.app" || p === "/Applications/mattstack.app";
      expect(installedTrayAppPath(bundle, exists)).toBe("/custom/place/mattstack.app");

      rmSync(home, { recursive: true, force: true });
    });

    test("a machine setting naming a different bundle is never trusted for this lookup, even if it exists on disk", () => {
      const home = makeHome();
      process.env.HOME = home;
      mkdirSync(dirname(machineSettingsPath()), { recursive: true });
      // The setting names the PROD bundle; this call asks for the dev bundle.
      writeFileSync(machineSettingsPath(), JSON.stringify({ "mattstack.appPath": "/Applications/mattstack.app" }));

      const exists = (p: string) => p === "/Applications/mattstack.app" || p === join(home, "Applications", "mattstack-dev.app");
      expect(installedTrayAppPath("mattstack-dev.app", exists)).toBe(join(home, "Applications", "mattstack-dev.app"));

      rmSync(home, { recursive: true, force: true });
    });

    test("a machine setting pointing at a bundle that no longer exists is not trusted — falls through to the fixed locations", () => {
      const home = makeHome();
      process.env.HOME = home;
      mkdirSync(dirname(machineSettingsPath()), { recursive: true });
      writeFileSync(machineSettingsPath(), JSON.stringify({ "mattstack.appPath": "/gone/mattstack.app" }));

      const exists = (p: string) => p === "/Applications/mattstack.app";
      expect(installedTrayAppPath(bundle, exists)).toBe("/Applications/mattstack.app");

      rmSync(home, { recursive: true, force: true });
    });

    test("/Applications/<bundle> beats ~/Applications/<bundle> when no machine setting is present", () => {
      const home = makeHome();
      process.env.HOME = home;

      const exists = (p: string) => p === "/Applications/mattstack.app" || p === join(home, "Applications", "mattstack.app");
      expect(installedTrayAppPath(bundle, exists)).toBe("/Applications/mattstack.app");

      rmSync(home, { recursive: true, force: true });
    });

    test("falls back to ~/Applications/<bundle> when only that one exists", () => {
      const home = makeHome();
      process.env.HOME = home;

      const userPath = join(home, "Applications", "mattstack.app");
      const exists = (p: string) => p === userPath;
      expect(installedTrayAppPath(bundle, exists)).toBe(userPath);

      rmSync(home, { recursive: true, force: true });
    });

    test("null when the bundle is nowhere: no machine setting, not in /Applications, not in ~/Applications", () => {
      const home = makeHome();
      process.env.HOME = home;

      expect(installedTrayAppPath(bundle, () => false)).toBeNull();

      rmSync(home, { recursive: true, force: true });
    });
  });

});

describe("worktreePoolRoot (friendly PATH-safe identity segment)", () => {
  test("github remote gets the gh alias: gh-<org>-<repo>", () => {
    expect(basename(worktreePoolRoot("remote:github.com%2Fm4ttstack%2Frt"))).toBe("gh-m4ttstack-rt");
  });

  test("gitlab remote gets the gl alias", () => {
    expect(basename(worktreePoolRoot("remote:gitlab.com%2Facme%2Facme-dev"))).toBe("gl-acme-acme-dev");
  });

  test("unknown host falls back to the dash-safe hostname", () => {
    expect(basename(worktreePoolRoot("remote:bitbucket.org%2Fteam%2Frepo"))).toBe("bitbucket-org-team-repo");
  });

  test("nested groups and host ports flatten to dashes, no raw colon survives", () => {
    const root = worktreePoolRoot("remote:gitlab.example.com%3A8443%2Fteam%2Fsub%2Frepo");
    expect(basename(root)).toBe("gitlab-example-com-8443-team-sub-repo");
    expect(root.includes(":")).toBe(false);
  });

  test("segments are percent-free and colon-free: colons split PATH, %2F breaks node's ESM loader, %25 breaks import.meta.url pathname", () => {
    for (const wire of [
      "remote:github.com%2Facme%2Frepo",
      "remote:gitlab.example.com%3A8443%2Fteam%2Fsub%2Frepo",
      "path:%2FUsers%2Fdev%2Fscratch",
      "not-a-wire-with-%25-junk",
    ]) {
      const root = worktreePoolRoot(wire);
      expect(root.includes(":")).toBe(false);
      expect(root.includes("%")).toBe(false);
    }
  });

  test("path-kind identity becomes local-<basename>-<hash>, distinct paths never collide", () => {
    const a = basename(worktreePoolRoot("path:%2FUsers%2Fdev%2Fscratch"));
    const b = basename(worktreePoolRoot("path:%2Ftmp%2Fscratch"));
    expect(a).toMatch(/^local-scratch-[0-9a-f]{6}$/);
    expect(b).toMatch(/^local-scratch-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });

  test("an unparseable wire degrades to a sanitized copy, never throws", () => {
    const root = worktreePoolRoot("not-a-wire");
    expect(basename(root)).toBe("not-a-wire");
    expect(root.includes(":")).toBe(false);
  });

  test("legacyWorktreePoolRoots lists both prior forms, colon then %3A", () => {
    const id = "remote:github.com%2Facme%2Frepo";
    expect(legacyWorktreePoolRoots(id).map((p) => basename(p))).toEqual([
      "remote:github.com%2Facme%2Frepo",
      "remote%3Agithub.com%2Facme%2Frepo",
    ]);
  });
});

describe("goldenRoot", () => {
  test("lives under <rtDir>/golden with the same segment as the pool root", () => {
    const id = "github.com/m4ttstack/rt";
    const seg = worktreePoolRoot(id).split("/").pop();
    expect(goldenRoot(id)).toBe(`${rtDir()}/golden/${seg}`);
    expect(goldenRoot(id).startsWith(worktreePoolRoot(id))).toBe(false);
  });
});
