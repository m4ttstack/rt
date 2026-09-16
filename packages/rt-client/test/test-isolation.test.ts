import { describe, expect, test } from "bun:test";
import { join } from "path";
import { guardTestDaemonEnv } from "../src/test-isolation.ts";

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
