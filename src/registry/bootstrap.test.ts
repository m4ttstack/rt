import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-boot-"));
process.env.LOCAL_REGISTRY_PATH = join(dir, "registry.json");
process.env.LOCAL_STATE_DIR = dir;
process.env.LOCAL_APPS_ROUTES_PATH = join(dir, "routes.json");
process.env.LOCAL_AGENTS_DIR = join(dir, "agents"); // isolate from this machine's real LaunchAgents (see Task 1.6)
writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH, "[]");

const { bootstrapSelf } = await import("./bootstrap.ts");
const { FakeServiceManager } = await import("../services/fake.ts");
const { FakeEdgeProxy } = await import("../edge/portless.ts");
const { getRecord, reloadRegistry } = await import("./records.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
});

test("bootstrap: agent + aliases first, then the record catches up as managedBy local", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/local", entry: null, tlds: ["localhost", "mattstack"],
  });
  expect(result.port).toBe(11000);
  expect(result.label).toBe("com.mattstack.local");
  const spec = manager.installed.get("com.mattstack.local")!;
  expect(spec.programArguments).toEqual(["/usr/local/bin/local", "serve"]);
  expect(spec.environment.PORT).toBe("11000");
  // mattstack TLD active: the single alias covers local.mattstack
  expect(result.aliases).toEqual(["local"]);
  expect(edge.aliases.get("local")).toBe(11000);
  const rec = getRecord("local")!;
  expect(rec.managedBy).toBe("local");
  expect(rec.label).toBe("com.mattstack.local");
});

test("without the mattstack TLD, the fallback alias local.mattstack is added", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/bin/bun", entry: "/repo/src/main.ts", tlds: ["localhost"],
  });
  expect(result.aliases).toEqual(["local", "local.mattstack"]);
  const spec = manager.installed.get("com.mattstack.local")!;
  expect(spec.programArguments).toEqual(["/usr/bin/bun", "/repo/src/main.ts", "serve"]);
});

test("bootstrap survives its own alias already being in routes.json (the real-driver ordering)", async () => {
  // The REAL PortlessCli writes the alias into routes.json before the record
  // catch-up runs. Simulate that: the route exists BEFORE bootstrapSelf's
  // adopt call. This is the exact shape that once 409'd and crashed setup.
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "local.localhost", port: 11000, pid: 0 }]),
  );
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/local", entry: null, tlds: ["localhost", "mattstack"],
  });
  // No record yet, so allocation treats the stray route's port as taken and
  // picks the next free one; the alias write then repoints "local" at it.
  expect(result.port).toBe(11001);
  expect(edge.aliases.get("local")).toBe(11001);
  // The invariant that once broke: the adopt catch-up must NOT 409 on the
  // pre-existing route — bootstrap completes and the record exists.
  const rec = getRecord("local")!;
  expect(rec.managedBy).toBe("local");
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
});
