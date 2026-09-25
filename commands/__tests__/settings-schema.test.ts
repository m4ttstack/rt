import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildLock } from "../../lib/settings/schema-lock.ts";
import { settingsSchemaDiff, settingsSchemaLock } from "../settings-schema.ts";

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

describe("settingsSchemaDiff", () => {
  let dir: string;
  let logs: string[];
  const origLog = console.log;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-schema-diff-")));
    logs = [];
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    process.exitCode = 0;
  });

  afterEach(() => {
    console.log = origLog;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLock = (lock: unknown): string => {
    const p = join(dir, "prev.lock.json");
    writeFileSync(p, JSON.stringify(lock));
    return p;
  };

  test("a key whose type changed without a storeVersion bump fails with the change and the problem", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { ...built[key]!.schema, type: "boolean" } } };

    await settingsSchemaDiff(["--against", writeLock(prev), "--json"]);

    const body = JSON.parse(logs.join("\n"));
    expect(body.ok).toBe(false);
    expect(body.changes).toContainEqual(expect.objectContaining({ key, kind: "breaking" }));
    expect(body.problems).toContainEqual(expect.stringContaining(key));
    expect(process.exitCode).toBe(1);
  });

  test("an empty previous lock is all additions and passes", async () => {
    await settingsSchemaDiff(["--against", writeLock({}), "--json"]);

    const body = JSON.parse(logs.join("\n"));
    expect(body.ok).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.changes.every((c: { kind: string }) => c.kind === "safe")).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test("a missing --against file reads as an empty lock", async () => {
    await settingsSchemaDiff(["--against", join(dir, "absent.json"), "--json"]);

    expect(JSON.parse(logs.join("\n")).ok).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test("the committed lock diffed against itself prints no changes", async () => {
    await settingsSchemaDiff(["--against", writeLock(buildLock())]);

    expect(logs).toEqual(["no schema changes"]);
    expect(process.exitCode).toBe(0);
  });

  test("an unknown --against-ref is an error, not an empty lock", async () => {
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    try {
      await settingsSchemaDiff(["--against-ref", "refs/heads/no-such-branch-for-schema-diff", "--json"]);
    } finally {
      console.error = origError;
    }

    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("no-such-branch-for-schema-diff"))).toBe(true);
  });
});
