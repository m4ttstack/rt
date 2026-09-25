import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { guardTestDaemonEnv, parsePasswdHome, realStoreRefusal, testRunSignal } from "../src/test-isolation.ts";

describe("guardTestDaemonEnv", () => {
  test("scrubs RT_DAEMON_SOCK and RT_APP_SOCKET and forbids both the old sock and HOME's rt.sock", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/real/home",
      RT_DAEMON_SOCK: "/live/rt.sock",
      RT_APP_SOCKET: "/live/tray.sock",
    };
    guardTestDaemonEnv(env);
    expect(env.RT_DAEMON_SOCK).toBeUndefined();
    expect(env.RT_APP_SOCKET).toBeUndefined();
    const forbidden = JSON.parse(env.RT_TEST_FORBID_SOCKS!) as string[];
    expect(forbidden).toContain("/live/rt.sock");
    expect(forbidden).toContain(join("/real/home", ".mattstack", "rt", "rt.sock"));
  });

  test("without RT_DAEMON_SOCK set, still forbids HOME's rt.sock", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/real/home" };
    guardTestDaemonEnv(env);
    const forbidden = JSON.parse(env.RT_TEST_FORBID_SOCKS!) as string[];
    expect(forbidden).toContain(join("/real/home", ".mattstack", "rt", "rt.sock"));
  });

  test("captures RT_APP_SOCKET's value on the forbidden list before deleting it", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/real/home",
      RT_APP_SOCKET: "/live/tray.sock",
    };
    guardTestDaemonEnv(env);
    const forbidden = JSON.parse(env.RT_TEST_FORBID_SOCKS!) as string[];
    expect(forbidden).toContain("/live/tray.sock");
  });

  test("an existing forbidden list that is not a string array throws instead of iterating characters", () => {
    // JSON.stringify("/x.sock") parses to a STRING, which is iterable: without
    // validation the guard would merge its characters as the forbidden list.
    const env: NodeJS.ProcessEnv = {
      HOME: "/real/home",
      RT_TEST_FORBID_SOCKS: JSON.stringify("/live/rt.sock"),
    };
    expect(() => guardTestDaemonEnv(env)).toThrow(/string array/);
  });

  test("merges with an existing forbidden list without duplicating entries", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/real/home",
      RT_DAEMON_SOCK: "/live/rt.sock",
      RT_TEST_FORBID_SOCKS: JSON.stringify(["/other/agent.sock", "/live/rt.sock"]),
    };
    guardTestDaemonEnv(env);
    const forbidden = JSON.parse(env.RT_TEST_FORBID_SOCKS!) as string[];
    expect(forbidden).toContain("/other/agent.sock");
    expect(forbidden.filter((p) => p === "/live/rt.sock")).toHaveLength(1);
  });
});

describe("testRunSignal", () => {
  test("NODE_ENV=test is a test run, whatever the entry module", () => {
    expect(testRunSignal({ NODE_ENV: "test" }, "/repo/cli.ts")).toBe("NODE_ENV=test");
    expect(testRunSignal({ NODE_ENV: "test" }, undefined)).toBe("NODE_ENV=test");
  });

  test("a test-file entry module is a test run even when NODE_ENV was preset to something else", () => {
    for (const main of ["/r/lib/a.test.ts", "/r/a_test.tsx", "/r/a.spec.js", "/r/a_spec.mjs", "/r/a.test.cts"]) {
      expect(testRunSignal({ NODE_ENV: "production" }, main)).toBe(`entry module ${main}`);
    }
  });

  test("vitest is a test run", () => {
    expect(testRunSignal({ VITEST: "true" }, undefined)).toBe("VITEST set");
  });

  test("a plain script, the compiled binary and a daemon are not test runs", () => {
    expect(testRunSignal({}, "/repo/cli.ts")).toBeNull();
    expect(testRunSignal({}, "/$bunfs/root/rt")).toBeNull();
    expect(testRunSignal({ NODE_ENV: "production" }, "/repo/lib/testing.ts")).toBeNull();
    expect(testRunSignal({}, undefined)).toBeNull();
  });
});

describe("realStoreRefusal", () => {
  const account = "/Users/someone";
  const signal = "NODE_ENV=test";

  test("refuses every store under the account's real ~/.mattstack and names the fix", () => {
    for (const target of [
      "/Users/someone/.mattstack/user/settings.user.jsonc",
      "/Users/someone/.mattstack/user/local/mac/settings.local.jsonc",
      "/Users/someone/.mattstack/teams/acme/mattstack/settings.team.jsonc",
    ]) {
      const refusal = realStoreRefusal({ target, account, home: account, signal });
      expect(refusal).toContain(target);
      expect(refusal).toMatch(/Run bun test from the repo root/);
    }
  });

  test("names the signal that made this a test run", () => {
    const target = "/Users/someone/.mattstack/user/settings.user.jsonc";
    expect(realStoreRefusal({ target, account, home: account, signal: "entry module /r/a.test.ts" })).toContain("(entry module /r/a.test.ts)");
    expect(realStoreRefusal({ target, account, home: account, signal: "VITEST set" })).toContain("(VITEST set)");
  });

  test("normalizes the paths it compares", () => {
    const target = "/Users/someone/x/../.mattstack/user/settings.user.jsonc";
    expect(realStoreRefusal({ target, account: "/Users/someone/", home: account, signal })).not.toBeNull();
  });

  test("allows a store under a scratch HOME, including one nested inside the account home", () => {
    expect(realStoreRefusal({ target: "/tmp/rt-tests/1-home-x/.mattstack/user/settings.user.jsonc", account, home: "/tmp/rt-tests/1-home-x", signal })).toBeNull();
    expect(realStoreRefusal({ target: "/Users/someone/scratch/.mattstack/user/settings.user.jsonc", account, home: "/Users/someone/scratch", signal })).toBeNull();
  });

  test("a sibling that only shares the prefix is not the real store", () => {
    expect(realStoreRefusal({ target: "/Users/someone/.mattstack-old/user/settings.user.jsonc", account, home: account, signal })).toBeNull();
  });

  test("names the HOME the run had, so an unset HOME is visible in the error", () => {
    const target = "/Users/someone/.mattstack/user/settings.user.jsonc";
    expect(realStoreRefusal({ target, account, home: undefined, signal })).toContain("HOME is unset");
    expect(realStoreRefusal({ target, account, home: account, signal })).toContain(`HOME is ${account}`);
  });
});

describe("parsePasswdHome", () => {
  test("reads the home directory from a macOS id -P line", () => {
    expect(parsePasswdHome("matt:********:501:20::0:0:Matthew Goodwin:/Users/matt:/bin/zsh\n")).toBe("/Users/matt");
  });

  test("reads the home directory from a getent passwd line", () => {
    expect(parsePasswdHome("runner:x:1001:118:,,,:/home/runner:/bin/bash\n")).toBe("/home/runner");
  });

  test("answers null for output that is not a passwd entry", () => {
    expect(parsePasswdHome("")).toBeNull();
    expect(parsePasswdHome("id: illegal option -- P")).toBeNull();
    expect(parsePasswdHome("a:b:c:d:e:relative/home:/bin/sh")).toBeNull();
  });
});

describe("accountHome", () => {
  test("a test child started with a scratch HOME writes its own store: the account home is not read from HOME", () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-account-home-")));
    try {
      const script = join(home, "write.ts");
      writeFileSync(
        script,
        `import { setSetting } from ${JSON.stringify(join(import.meta.dir, "..", "src", "settings", "write.ts"))};\n` +
          `setSetting("rt.apiPort", 50489, "user");\n`,
      );
      const child = spawnSync(process.execPath, [script], {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, NODE_ENV: "test" },
        encoding: "utf8",
      });
      expect(child.stderr).not.toMatch(/refusing to write/);
      expect(child.status).toBe(0);
      expect(readFileSync(join(home, ".mattstack", "user", "settings.user.jsonc"), "utf8")).toContain("50489");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
