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
const { getRecord, putRecord, reloadRegistry } = await import("./records.ts");
const { LEGACY_PLATFORM_LABEL } = await import("../services/manager.ts");

beforeEach(() => {
  rmSync(process.env.LOCAL_REGISTRY_PATH!, { force: true });
  reloadRegistry();
});

test("bootstrap: agent + aliases first, then the record catches up as managedBy deck", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"],
  });
  expect(result.port).toBe(11000);
  expect(result.label).toBe("com.mattstack.deck");
  const spec = manager.installed.get("com.mattstack.deck")!;
  expect(spec.programArguments).toEqual(["/usr/local/bin/deck", "serve"]);
  expect(spec.environment.PORT).toBe("11000");
  // mattstack TLD active: the single alias covers deck.mattstack
  expect(result.aliases).toEqual(["deck"]);
  expect(edge.aliases.get("deck")).toBe(11000);
  const rec = getRecord("deck")!;
  expect(rec.managedBy).toBe("deck");
  expect(rec.label).toBe("com.mattstack.deck");
});

test("the platform's own plist carries PATH captured from the installing shell", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const savedPath = process.env.PATH;
  process.env.PATH = "/fake/installer/bin:/usr/bin";
  try {
    await bootstrapSelf({ manager, edge }, {
      execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"],
    });
    const spec = manager.installed.get("com.mattstack.deck")!;
    expect(spec.environment.PATH).toBe("/fake/installer/bin:/usr/bin");
  } finally {
    process.env.PATH = savedPath;
  }
});

test("bootstrap is idempotent: a second run (reinstall/upgrade/retry) does not throw", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const opts = { execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"] };
  const first = await bootstrapSelf({ manager, edge }, opts);
  const second = await bootstrapSelf({ manager, edge }, opts);
  expect(second.port).toBe(first.port);
  expect(second.label).toBe(first.label);
  expect(second.aliases).toEqual(first.aliases);
  // The drivers stay unconditional: that is the self-heal/reinstall behavior.
  expect(manager.installed.get("com.mattstack.deck")!.environment.PORT).toBe(String(first.port));
  expect(edge.aliases.get("deck")).toBe(first.port);
  const rec = getRecord("deck")!;
  expect(rec.managedBy).toBe("deck");
  expect(rec.kind).toBe("service");
  expect(rec.port).toBe(first.port);
});

test("without the mattstack TLD, the fallback alias deck.mattstack is added", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/bin/bun", entry: "/repo/src/main.ts", tlds: ["localhost"],
  });
  expect(result.aliases).toEqual(["deck", "deck.mattstack"]);
  const spec = manager.installed.get("com.mattstack.deck")!;
  expect(spec.programArguments).toEqual(["/usr/bin/bun", "/repo/src/main.ts", "serve"]);
});

test("bootstrap survives its own alias already being in routes.json (the real-driver ordering)", async () => {
  // The REAL PortlessCli writes the alias into routes.json before the record
  // catch-up runs. Simulate that: the route exists BEFORE bootstrapSelf's
  // adopt call. This is the exact shape that once 409'd and crashed setup.
  writeFileSync(
    process.env.LOCAL_APPS_ROUTES_PATH!,
    JSON.stringify([{ hostname: "deck.localhost", port: 11000, pid: 0 }]),
  );
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"],
  });
  // No record yet, so allocation treats the stray route's port as taken and
  // picks the next free one; the alias write then repoints "deck" at it.
  expect(result.port).toBe(11001);
  expect(edge.aliases.get("deck")).toBe(11001);
  // The invariant that once broke: the adopt catch-up must NOT 409 on the
  // pre-existing route — bootstrap completes and the record exists.
  const rec = getRecord("deck")!;
  expect(rec.managedBy).toBe("deck");
  writeFileSync(process.env.LOCAL_APPS_ROUTES_PATH!, "[]");
});

// Migration requirement #3: an upgrading machine's self-row may still be on
// disk under the pre-rename identity (name "local", managedBy "local").
test("migration: a pre-rename self-row (name/managedBy local) is adopted under the new deck identity, same port", async () => {
  putRecord({
    name: "local", managedBy: "local", port: 11005, kind: "service",
    label: LEGACY_PLATFORM_LABEL, createdAt: "2026-01-01T00:00:00Z",
  });
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();

  const result = await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"],
  });

  expect(result.port).toBe(11005); // the pre-existing port is reused, not re-allocated
  expect(getRecord("local")).toBeUndefined(); // the old key is gone, not left as a duplicate row
  const rec = getRecord("deck")!;
  expect(rec.managedBy).toBe("deck");
  expect(rec.label).toBe("com.mattstack.deck");
  expect(rec.port).toBe(11005);
});

// Migration requirement #4: the pre-rename platform label may still be a
// loaded launchd agent (running the OLD binary) when `deck setup` runs.
test("migration: boots out the pre-rename platform label (com.mattstack.local) before installing the new one", async () => {
  const manager = new FakeServiceManager();
  const edge = new FakeEdgeProxy();
  // Simulate the old agent already being installed, as it would be on a
  // machine that ran the platform before this rename.
  await manager.install({
    label: LEGACY_PLATFORM_LABEL,
    programArguments: ["/usr/local/bin/deck-old-binary", "serve"],
    workingDirectory: dir,
    environment: { PORT: "11000" },
    stdoutPath: join(dir, "old.out.log"),
    stderrPath: join(dir, "old.err.log"),
  });
  expect(manager.installed.has(LEGACY_PLATFORM_LABEL)).toBe(true);

  await bootstrapSelf({ manager, edge }, {
    execPath: "/usr/local/bin/deck", entry: null, tlds: ["localhost", "mattstack"],
  });

  expect(manager.installed.has(LEGACY_PLATFORM_LABEL)).toBe(false); // booted out
  expect(manager.installed.has("com.mattstack.deck")).toBe(true); // new one installed
});
