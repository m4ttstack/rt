import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildLock } from "../../lib/settings/schema-lock.ts";
import { settingsSchemaLock } from "../settings-schema.ts";

describe("settingsSchemaLock", () => {
  let dir: string;
  let logs: string[];
  let errors: string[];
  const origLog = console.log;
  const origError = console.error;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-schema-lock-")));
    logs = [];
    errors = [];
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    process.exitCode = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes the built lock to --out and prints its path", async () => {
    const out = join(dir, "schema.lock.json");

    await settingsSchemaLock(["--out", out]);

    expect(readFileSync(out, "utf8")).toBe(`${JSON.stringify(buildLock(), null, 2)}\n`);
    expect(logs).toEqual([out]);
  });

  test("a compiled-binary lock path refuses to write and exits 1", async () => {
    const bunfsPath = "/$bunfs/nope/schema.lock.json";

    await settingsSchemaLock([], { lockPath: bunfsPath });

    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("run from source"))).toBe(true);
  });
});
