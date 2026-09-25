import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { alwaysRun, collectSources, decide, ROOT, unitDirs, type ScopeInput } from "../test-scope.ts";

// Synthetic unit test sources: one parity test that reads a Swift file and a
// tray shell script by path, and one plain test.
const sources = new Map<string, string>([
  [
    "lib/__tests__/dev-mode.test.ts",
    `const swift = readFileSync(join(ROOT, "rt-tray/Sources-core/Flavor/FlavorLaunch.swift"), "utf8");
     const build = readFileSync(join(ROOT, "rt-tray", "build.sh"), "utf8");`,
  ],
  ["lib/__tests__/plain.test.ts", `expect(add(1, 2)).toBe(3);`],
]);
const preloadImports = new Set(["packages/rt-client/src/test-isolation.ts", "lib/__tests__/home-env.ts"]);

function pr(changed: string[]): ScopeInput {
  return { event: "pull_request", changed, sources, preloadImports };
}

describe("decide", () => {
  test("a push is always full", () => {
    expect(decide({ ...pr(["docs/a.md"]), event: "push" }).mode).toBe("full");
  });

  test("docs nothing reads skip", () => {
    expect(decide(pr(["docs/architecture.md", "AGENTS.md"])).mode).toBe("skip");
  });

  test("swift nothing reads skips", () => {
    expect(decide(pr(["rt-tray/Sources-core/Tray/Menu.swift"])).mode).toBe("skip");
  });

  test("a swift file a parity test reads by path is full", () => {
    expect(decide(pr(["rt-tray/Sources-core/Flavor/FlavorLaunch.swift"])).mode).toBe("full");
  });

  test("a tray file a test reads by basename is full", () => {
    expect(decide(pr(["rt-tray/build.sh"])).mode).toBe("full");
  });

  test("a markdown fixture is full even when nothing names it", () => {
    expect(decide(pr(["lib/__tests__/fixtures/compile-native/pack/notes.md"])).mode).toBe("full");
  });

  test("a markdown file next to a typescript change is full", () => {
    expect(decide(pr(["README.md", "lib/x.ts"])).mode).toBe("full");
  });

  test("skills are never docs", () => {
    expect(decide(pr(["skills/rt-chat/notes.md"])).mode).toBe("full");
  });

  test("the stub-rt tree is typescript, not swift", () => {
    expect(decide(pr(["rt-tray/Tests/stub-rt/stub.ts"])).mode).toBe("changed");
  });

  test("a preload import is full", () => {
    expect(decide(pr(["packages/rt-client/src/test-isolation.ts"])).mode).toBe("full");
  });

  test("the preload itself and the scope script are full", () => {
    expect(decide(pr(["test-setup.ts"])).mode).toBe("full");
    expect(decide(pr(["scripts/ci/test-scope.ts"])).mode).toBe("full");
  });

  test("a shell script or json anywhere is full", () => {
    expect(decide(pr(["scripts/repo-purity.sh"])).mode).toBe("full");
    expect(decide(pr(["lib/__tests__/example.json", "lib/x.ts"])).mode).toBe("full");
  });

  test("typescript the import graph can see is changed", () => {
    expect(decide(pr(["lib/x.ts", "commands/y.ts"])).mode).toBe("changed");
  });

  test("every decision carries a reason", () => {
    for (const changed of [["docs/a.md"], ["lib/x.ts"], ["rt-tray/build.sh"]]) {
      expect(decide(pr(changed)).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("unitDirs", () => {
  test("parses the directory list from the test script", () => {
    expect(unitDirs({ scripts: { test: "bun test lib commands scripts" } })).toEqual(["lib", "commands", "scripts"]);
  });

  test("refuses a test script that is not a bare bun test run", () => {
    expect(() => unitDirs({ scripts: { test: "vitest run" } })).toThrow(/bare bun test/);
  });

  test("the real script parses and test:timings names the same directories", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const dirs = unitDirs(pkg);
    expect(dirs).toContain("lib");
    expect(dirs).toContain("commands");
    for (const dir of dirs) expect(pkg.scripts["test:timings"]).toContain(` ${dir}`);
  });
});

describe("alwaysRun", () => {
  test("resolves the scanner guards and every file exists", () => {
    const files = alwaysRun();
    for (const name of ["no-ui-in-cli", "no-eager-tui", "no-url-pathname", "no-top-level-await", "no-daemon-sync-exec"]) {
      expect(files).toContain(`lib/__tests__/${name}.test.ts`);
    }
    for (const f of files) expect(existsSync(join(ROOT, f))).toBe(true);
  });
});

describe("collectSources", () => {
  test("reaches the preload's imports and the tray parity reads, and leaves itself out", () => {
    const { sources, preloadImports } = collectSources();
    expect(preloadImports.has("packages/rt-client/src/test-isolation.ts")).toBe(true);
    expect(preloadImports.has("lib/__tests__/home-env.ts")).toBe(true);
    expect(sources.get("lib/__tests__/dev-mode.test.ts")).toContain("FlavorLaunch.swift");
    expect(sources.has("scripts/ci/__tests__/test-scope.test.ts")).toBe(false);
    expect(sources.has("commands/worktree.ts")).toBe(true);
  });
});
