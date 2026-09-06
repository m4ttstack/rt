import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-portless-"));
process.env.LOCAL_PORTLESS_TLDS_PATH = join(dir, "proxy.tlds");
const { PortlessCli, FakeEdgeProxy, readProxyTlds } = await import("./portless.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// An empty scratch dir as PATH: guarantees Bun.which("portless") finds
// nothing, regardless of whether the machine running these tests happens to
// have portless installed for real, so PortlessCli falls back to the literal
// command name deterministically.
const emptyPathDir = mkdtempSync(join(tmpdir(), "local-portless-empty-path-"));
afterAll(() => rmSync(emptyPathDir, { recursive: true, force: true }));

function withPath<T>(fakePath: string, fn: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = fakePath;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

test("PortlessCli shells the alias verbs, never touches portless files", async () => {
  const calls: string[][] = [];
  const cli = withPath(emptyPathDir, () => new PortlessCli(async (argv) => { calls.push(argv); return { code: 0, output: "" }; }));
  await cli.alias("myapp", 11007);
  await cli.removeAlias("myapp");
  expect(calls).toEqual([
    ["portless", "alias", "myapp", "11007"],
    ["portless", "alias", "--remove", "myapp"],
  ]);
});

test("a nonzero exit becomes a thrown error naming the command", async () => {
  const cli = withPath(emptyPathDir, () => new PortlessCli(async () => ({ code: 1, output: "boom" })));
  await expect(cli.alias("myapp", 11007)).rejects.toThrow(/portless alias myapp/);
});

test("resolves portless to its absolute path when present on PATH, at construction time", async () => {
  const binDir = mkdtempSync(join(tmpdir(), "local-portless-bin-"));
  const stub = join(binDir, "portless");
  writeFileSync(stub, "#!/bin/sh\nexit 0\n");
  chmodSync(stub, 0o755);
  try {
    const calls: string[][] = [];
    const cli = withPath(binDir, () => new PortlessCli(async (argv) => { calls.push(argv); return { code: 0, output: "" }; }));
    await cli.alias("myapp", 11007);
    expect(calls[0]![0]).toBe(stub);
    expect(calls[0]).toEqual([stub, "alias", "myapp", "11007"]);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("falls back to the bare command name when portless isn't found on PATH", async () => {
  const calls: string[][] = [];
  const cli = withPath(emptyPathDir, () => new PortlessCli(async (argv) => { calls.push(argv); return { code: 0, output: "" }; }));
  await cli.removeAlias("myapp");
  expect(calls[0]![0]).toBe("portless");
});

test("removeAlias is idempotent: portless reporting No alias found is success, not a failure", async () => {
  const cli = withPath(emptyPathDir, () => new PortlessCli(async () => ({ code: 1, output: "No alias found for myapp\n" })));
  await expect(cli.removeAlias("myapp")).resolves.toBeUndefined();
});

test("removeAlias still throws on a genuine portless failure (not the already-gone message)", async () => {
  const cli = withPath(emptyPathDir, () => new PortlessCli(async () => ({ code: 1, output: "permission denied writing routes.json\n" })));
  await expect(cli.removeAlias("myapp")).rejects.toThrow(/portless alias --remove myapp/);
});

test("readProxyTlds parses the newline list, defaults to localhost", () => {
  writeFileSync(process.env.LOCAL_PORTLESS_TLDS_PATH!, "localhost\nmattstack\n");
  expect(readProxyTlds()).toEqual(["localhost", "mattstack"]);
  rmSync(process.env.LOCAL_PORTLESS_TLDS_PATH!);
  expect(readProxyTlds()).toEqual(["localhost"]);
});

test("fake records aliases and can fail on demand", async () => {
  const fake = new FakeEdgeProxy();
  await fake.alias("a", 11000);
  expect(fake.aliases.get("a")).toBe(11000);
  fake.failNext = "b";
  await expect(fake.alias("b", 11001)).rejects.toThrow();
  await fake.removeAlias("a");
  expect(fake.aliases.size).toBe(0);
});
