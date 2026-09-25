import { describe, expect, test } from "bun:test";
import { isAbsolute, join } from "path";
import { accountHome, guardTestDaemonEnv, isTestRun, parsePasswdHome, realStoreRefusal } from "../src/test-isolation.ts";

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

describe("isTestRun", () => {
  test("NODE_ENV=test is a test run, whatever the entry module", () => {
    expect(isTestRun({ NODE_ENV: "test" }, "/repo/cli.ts")).toBe(true);
    expect(isTestRun({ NODE_ENV: "test" }, undefined)).toBe(true);
  });

  test("a test-file entry module is a test run even when NODE_ENV was preset to something else", () => {
    for (const main of ["/r/lib/a.test.ts", "/r/a_test.tsx", "/r/a.spec.js", "/r/a_spec.mjs", "/r/a.test.cts"]) {
      expect(isTestRun({ NODE_ENV: "production" }, main)).toBe(true);
    }
  });

  test("vitest is a test run", () => {
    expect(isTestRun({ VITEST: "true" }, undefined)).toBe(true);
  });

  test("a plain script, the compiled binary and a daemon are not test runs", () => {
    expect(isTestRun({}, "/repo/cli.ts")).toBe(false);
    expect(isTestRun({}, "/$bunfs/root/rt")).toBe(false);
    expect(isTestRun({ NODE_ENV: "production" }, "/repo/lib/testing.ts")).toBe(false);
    expect(isTestRun({}, undefined)).toBe(false);
  });
});

describe("realStoreRefusal", () => {
  const account = "/Users/someone";

  test("refuses every store under the account's real ~/.mattstack and names the fix", () => {
    for (const target of [
      "/Users/someone/.mattstack/user/settings.user.jsonc",
      "/Users/someone/.mattstack/user/local/mac/settings.local.jsonc",
      "/Users/someone/.mattstack/teams/acme/mattstack/settings.team.jsonc",
    ]) {
      const refusal = realStoreRefusal(target, account, account);
      expect(refusal).toContain(target);
      expect(refusal).toMatch(/Run bun test from the repo root/);
    }
  });

  test("normalizes the paths it compares", () => {
    expect(realStoreRefusal("/Users/someone/x/../.mattstack/user/settings.user.jsonc", "/Users/someone/", account)).not.toBeNull();
  });

  test("allows a store under a scratch HOME, including one nested inside the account home", () => {
    expect(realStoreRefusal("/tmp/rt-tests/1-home-x/.mattstack/user/settings.user.jsonc", account, "/tmp/rt-tests/1-home-x")).toBeNull();
    expect(realStoreRefusal("/Users/someone/scratch/.mattstack/user/settings.user.jsonc", account, "/Users/someone/scratch")).toBeNull();
  });

  test("a sibling that only shares the prefix is not the real store", () => {
    expect(realStoreRefusal("/Users/someone/.mattstack-old/user/settings.user.jsonc", account, account)).toBeNull();
  });

  test("names the HOME the run had, so an unset HOME is visible in the error", () => {
    expect(realStoreRefusal("/Users/someone/.mattstack/user/settings.user.jsonc", account, undefined)).toContain("HOME is unset");
    expect(realStoreRefusal("/Users/someone/.mattstack/user/settings.user.jsonc", account, account)).toContain(`HOME is ${account}`);
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
  test("is absolute and ignores a HOME repointed at runtime", () => {
    const saved = process.env.HOME;
    process.env.HOME = join("/tmp", "not-the-account-home");
    try {
      const home = accountHome();
      expect(isAbsolute(home)).toBe(true);
      expect(home).not.toBe(process.env.HOME);
    } finally {
      process.env.HOME = saved;
    }
  });
});
