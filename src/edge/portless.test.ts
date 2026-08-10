import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-portless-"));
process.env.LOCAL_PORTLESS_TLDS_PATH = join(dir, "proxy.tlds");
const { PortlessCli, FakeEdgeProxy, readProxyTlds } = await import("./portless.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("PortlessCli shells the alias verbs, never touches portless files", async () => {
  const calls: string[][] = [];
  const cli = new PortlessCli(async (argv) => { calls.push(argv); return 0; });
  await cli.alias("myapp", 11007);
  await cli.removeAlias("myapp");
  expect(calls).toEqual([
    ["portless", "alias", "myapp", "11007"],
    ["portless", "alias", "--remove", "myapp"],
  ]);
});

test("a nonzero exit becomes a thrown error naming the command", async () => {
  const cli = new PortlessCli(async () => 1);
  await expect(cli.alias("myapp", 11007)).rejects.toThrow(/portless alias myapp/);
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
