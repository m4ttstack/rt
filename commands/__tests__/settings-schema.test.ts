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
    process.exitCode = 0;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    process.exitCode = 0;
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
  const LOCK_REL = "packages/rt-client/src/settings/schema.lock.json";
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

  const captureErrors = async (fn: () => Promise<void>): Promise<string[]> => {
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    try {
      await fn();
    } finally {
      console.error = origError;
    }
    return errors;
  };

  const writeLock = (lock: unknown): string => {
    const p = join(dir, "prev.lock.json");
    writeFileSync(p, JSON.stringify(lock));
    return p;
  };

  test("a key whose type changed without a storeVersion bump fails with the change and the problem", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { ...built[key]!.schema, type: "boolean" } } };

    await settingsSchemaDiff(["--against", writeLock(prev), "--json"], { shippedLock: null });

    const body = JSON.parse(logs.join("\n"));
    expect(body.ok).toBe(false);
    expect(body.changes).toContainEqual(expect.objectContaining({ key, kind: "breaking" }));
    expect(body.problems).toContainEqual(expect.stringContaining(key));
    expect(process.exitCode).toBe(1);
  });

  test("an empty previous lock is all additions and passes", async () => {
    await settingsSchemaDiff(["--against", writeLock({}), "--json"], { shippedLock: null });

    const body = JSON.parse(logs.join("\n"));
    expect(body.ok).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.changes.every((c: { kind: string }) => c.kind === "safe")).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  test("a missing --against file reads as an empty lock and warns naming the path", async () => {
    const absent = join(dir, "absent.json");
    const errors = await captureErrors(() => settingsSchemaDiff(["--against", absent, "--json"], { shippedLock: null }));

    expect(JSON.parse(logs.join("\n")).ok).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(errors.some((e) => e.includes(absent))).toBe(true);
  });

  test("--against and --against-ref together is a usage error", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--against", writeLock({}), "--against-ref", "HEAD", "--json"]));

    expect(process.exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors.some((e) => e.includes("--against") && e.includes("--against-ref"))).toBe(true);
  });

  test("a compiled-binary repo root refuses and exits 1", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--json"], { repoRoot: "/$bunfs/root/" }));

    expect(process.exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors.some((e) => e.includes("run from source"))).toBe(true);
  });

  test("the committed lock diffed against itself prints no changes", async () => {
    await settingsSchemaDiff(["--against", writeLock(buildLock())], { shippedLock: null });

    expect(logs).toEqual(["no schema changes"]);
    expect(process.exitCode).toBe(0);
  });

  test("an unknown --against-ref is an error, not an empty lock", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--against-ref", "refs/heads/no-such-branch-for-schema-diff", "--json"]));

    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("no-such-branch-for-schema-diff"))).toBe(true);
  });

  // "tag" is answered separately from "show" so a fake built for the against-ref path never
  // doubles as a (wrong) tag list: an unanswered tag --list must read as "no tags", not as
  // whatever the show fixture happens to return.
  const fakeGit = (show: { status: number; stdout?: string; stderr?: string }, tag: { status?: number; stdout?: string } = { status: 0, stdout: "" }) => (args: string[]) => {
    if (args[0] === "rev-parse") return { status: 0, stdout: "abc\n", stderr: "" };
    if (args[0] === "tag") return { status: tag.status ?? 0, stdout: tag.stdout ?? "", stderr: "" };
    return { stdout: "", stderr: "", ...show };
  };

  test("a ref whose tree has no lock reads as an empty lock", async () => {
    for (const stderr of [
      "fatal: path 'packages/rt-client/src/settings/schema.lock.json' does not exist in 'origin/main'",
      "fatal: path 'packages/rt-client/src/settings/schema.lock.json' exists on disk, but not in 'origin/main'",
    ]) {
      logs = [];
      await settingsSchemaDiff(["--json"], { git: fakeGit({ status: 128, stderr }) });
      expect(JSON.parse(logs.join("\n")).ok).toBe(true);
      expect(process.exitCode).toBe(0);
    }
  });

  test("any other git show failure is an error, never an empty lock", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--json"], { git: fakeGit({ status: 128, stderr: "fatal: bad object 1234abcd" }) }));

    expect(process.exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors.some((e) => e.includes("bad object"))).toBe(true);
  });

  test("--json reports the shipped ref whose lock the acknowledgement hatch reads", async () => {
    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "HEAD", "--json"]);
    expect(JSON.parse(logs.join("\n")).shipped).toBe("HEAD");
  });

  test("an unknown --shipped-ref is an error, not an empty lock", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "refs/tags/no-such-tag-for-schema-diff", "--json"]));
    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("no-such-tag-for-schema-diff"))).toBe(true);
  });

  test("no --shipped-ref resolves the highest v* tag from git tag --list, and reads that tag's lock", async () => {
    const shows: string[] = [];
    const git = (args: string[]) => {
      if (args[0] === "tag") return { status: 0, stdout: "v9.9.9\nv1.0.0\n", stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: "abc\n", stderr: "" };
      shows.push(args[1] ?? "");
      return { status: 0, stdout: "{}", stderr: "" };
    };

    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--json"], { git });

    expect(JSON.parse(logs.join("\n")).shipped).toBe("v9.9.9");
    expect(shows).toEqual([`v9.9.9:${LOCK_REL}`]);
  });

  test("a malformed lock at the ref or in --against is an error naming its source", async () => {
    const atRef = await captureErrors(() => settingsSchemaDiff(["--json"], { git: fakeGit({ status: 0, stdout: "{ not json" }) }));
    expect(process.exitCode).toBe(1);
    expect(atRef.some((e) => e.includes("origin/main"))).toBe(true);

    process.exitCode = 0;
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const atPath = await captureErrors(() => settingsSchemaDiff(["--against", bad, "--json"]));
    expect(process.exitCode).toBe(1);
    expect(atPath.some((e) => e.includes(bad))).toBe(true);
    expect(logs).toEqual([]);
  });
});
