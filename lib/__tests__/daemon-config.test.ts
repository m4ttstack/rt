/**
 * lib/daemon-config.ts: activeLaunchdLabel() follows this process's own
 * flavor (MATTSTACK_FLAVOR, else the build), never a file on disk.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { activeLaunchdLabel, resolveApiPort } from "../daemon-config.ts";
import { DEV_MODE_TAG } from "../dev-mode.ts";

const WRAPPER_PATH = join(process.env.HOME!, ".local", "bin", "rt");

describe("activeLaunchdLabel", () => {
  afterEach(() => {
    process.env.MATTSTACK_FLAVOR = "prod";
    rmSync(WRAPPER_PATH, { force: true });
  });

  test("a prod-labelled process names the prod daemon job", () => {
    process.env.MATTSTACK_FLAVOR = "prod";
    expect(activeLaunchdLabel()).toBe("com.mattstack.daemon");
  });

  test("a dev-labelled process names the dev daemon job", () => {
    process.env.MATTSTACK_FLAVOR = "dev";
    expect(activeLaunchdLabel()).toBe("com.mattstack.daemon.dev");
  });

  test("the dev wrapper on disk does not decide it", () => {
    mkdirSync(join(process.env.HOME!, ".local", "bin"), { recursive: true });
    writeFileSync(WRAPPER_PATH, `#!/bin/sh\n${DEV_MODE_TAG}\nexit 0\n`, { mode: 0o755 });
    process.env.MATTSTACK_FLAVOR = "prod";
    expect(activeLaunchdLabel()).toBe("com.mattstack.daemon");
  });
});

describe("resolveApiPort", () => {
  test("env wins, then setting, then 9401", () => {
    const prev = process.env.RT_API_PORT;
    process.env.RT_API_PORT = "12345";
    expect(resolveApiPort()).toBe(12345);
    delete process.env.RT_API_PORT;
    expect(resolveApiPort()).toBe(9401); // default setting value
    if (prev !== undefined) process.env.RT_API_PORT = prev;
    else delete process.env.RT_API_PORT;
  });

  // R2: RT_API_PORT="0" is a deliberate override (bind an OS-assigned
  // ephemeral port), not "unset" — `Number("0") || 9401`-style falsy checks
  // silently drop it and fall through to the setting/default instead.
  test("RT_API_PORT=0 is honored, not treated as unset", () => {
    const prev = process.env.RT_API_PORT;
    process.env.RT_API_PORT = "0";
    try {
      expect(resolveApiPort()).toBe(0);
    } finally {
      if (prev !== undefined) process.env.RT_API_PORT = prev;
      else delete process.env.RT_API_PORT;
    }
  });
});
