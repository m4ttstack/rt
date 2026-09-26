import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { alwaysRun, alwaysRunPaths, CHANGED_ARGS, collectSources, decide, ROOT, unitDirs, type ScopeInput } from "../test-scope.ts";

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

// The real unit sources, for cases that depend on what an actual rt test reads.
const real = collectSources();
function prInput(changed: string[]): ScopeInput {
  return { event: "pull_request", changed, ...real };
}

describe("decide", () => {
  test("a push is always full", () => {
    expect(decide({ ...pr(["docs/a.md"]), event: "push" }).mode).toBe("full");
  });

  test("an empty diff skips with its own reason", () => {
    const decision = decide(pr([]));
    expect(decision.mode).toBe("skip");
    expect(decision.reason).toBe("no changed files");
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

  test("a tray plist nothing names is full", () => {
    expect(decide(pr(["rt-tray/LaunchAgent.plist"])).mode).toBe("full");
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

  test("the vm helpers tree is typescript, not tray", () => {
    expect(decide(pr(["rt-tray/vm/run/helpers/x.ts"])).mode).toBe("changed");
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

  test("an apps-only PR skips the unit shards", () => {
    const d = decide(prInput(["apps/board/src/App.tsx", "packages/ui/src/index.ts", "docs/apps/README.md"]));
    expect(d.mode).toBe("skip");
  });

  test("apps root config read by a unit test still runs", () => {
    // scripts/__tests__/turbo-inputs.test.ts reads turbo.json
    const d = decide(prInput(["turbo.json"]));
    expect(d.mode).not.toBe("skip");
  });

  test("an apps fixture does not force the full suite", () => {
    const d = decide(prInput(["apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json"]));
    expect(d.mode).toBe("skip");
  });

  test("an apps package.json skips too, since //#turbo:test covers it", () => {
    const d = decide(prInput(["apps/board/package.json"]));
    expect(d.mode).toBe("skip");
  });

  test("a glance source change runs rt's unit suite", () => {
    expect(decide(prInput(["packages/glance/src/index.ts"])).mode).toBe("full");
  });

  test("glance-react and typescript-config are apps trees", () => {
    expect(
      decide(
        prInput(["packages/glance-react/lib/x.tsx", "packages/typescript-config/base.json", "docs/glance/README.md"])
      ).mode
    ).toBe("skip");
  });
});

describe("unitDirs", () => {
  test("parses the directory list from the test script", () => {
    expect(unitDirs({ scripts: { test: "bun test lib commands scripts" } })).toEqual(["lib", "commands", "scripts"]);
  });

  test("refuses a test script that is not a bare bun test run", () => {
    expect(() => unitDirs({ scripts: { test: "vitest run" } })).toThrow(/bare bun test/);
    expect(() => unitDirs({ scripts: { test: "bun test --timeout 20000 lib" } })).toThrow(/bare bun test/);
  });

  test("the real script parses and test:timings, test:watch and test:all delegate to it", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const dirs = unitDirs(pkg);
    // Every dir keeps its "./" prefix: this is what lands in the dirs=
    // GITHUB_OUTPUT line CI runs as `bun test $DIRS`, and a bare name there
    // is a substring filter that sweeps in any path containing it.
    for (const dir of dirs) expect(dir.startsWith("./")).toBe(true);
    expect(dirs).toContain("./lib");
    expect(dirs).toContain("./commands");
    expect(pkg.scripts["test:timings"]).toMatch(/\bbun run test\b/);
    expect(pkg.scripts["test:watch"]).toMatch(/\bbun run test\b/);
    expect(pkg.scripts["test:all"]).toMatch(/\bbun run test\b/);
    const dirsList = dirs.join(" ");
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name === "test") continue;
      expect(script).not.toContain(dirsList);
    }
  });
});

describe("alwaysRun", () => {
  test("resolves every no-* guard across the unit directories and every file exists", () => {
    const files = alwaysRun();
    for (const name of ["no-ui-in-cli", "no-eager-tui", "no-url-pathname", "no-top-level-await", "no-daemon-sync-exec"]) {
      expect(files).toContain(`lib/__tests__/${name}.test.ts`);
    }
    for (const f of [
      "lib/__tests__/no-spawn-without-env.test.ts",
      "lib/__tests__/no-hand-built-repo-paths.test.ts",
      "lib/state/__tests__/no-legacy-state-sources.test.ts",
      "packages/rt-client/test/no-unlisted-command-call-sites.test.ts",
    ]) {
      expect(files).toContain(f);
    }
    for (const f of files) expect(existsSync(join(ROOT, f))).toBe(true);
  });
});

describe("alwaysRunPaths", () => {
  test("every token in the emitted always= line keeps its \"./\" prefix", () => {
    const line = alwaysRunPaths().join(" ");
    const tokens = line.split(" ");
    expect(tokens.length).toBe(alwaysRun().length);
    for (const token of tokens) expect(token.startsWith("./")).toBe(true);
  });
});

describe("CHANGED_ARGS", () => {
  test("the diff lists both paths of a rename", () => {
    expect(CHANGED_ARGS).toContain("--no-renames");
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
