import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTreeRows, WORKSPACE_BUILD_ARGS } from "../build-apps.ts";

function fakeApp(root: string, name: string, opts: { skills?: boolean; serve?: boolean } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  const homeFile = join(dir, "dist", `${name}.home`);
  writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
    name, displayName: name, icon: "icon.svg",
    ...(opts.serve ? { port: 11090, includeInBundle: true } : {}),
    bundle: {
      build: `printf '#!/bin/sh\\necho ${name} 0.0.0\\nprintf %%s "$HOME" > ${homeFile}\\n' > dist/${name} && chmod 755 dist/${name}`,
      artifact: `dist/${name}`,
    },
  }));
  writeFileSync(join(dir, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  if (opts.skills) {
    mkdirSync(join(dir, "skills", "hello"), { recursive: true });
    writeFileSync(join(dir, "skills", "hello", "SKILL.md"), "# hello\n");
  }
  return dir;
}

describe("build-apps", () => {
  test("lands every tree row like fetch-deps would", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    fakeApp(apps, "alpha", { skills: true, serve: true });
    fakeApp(apps, "beta");
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "alpha", version: "", license: "MIT", source: "tree", skills: true, archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/alpha", exec: ["Contents/Helpers/alpha"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper", serve: { port: 11090, args: [] } },
      { name: "beta", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/beta", exec: ["Contents/Helpers/beta"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" },
      { name: "jq", version: "1", license: "MIT", url: "https://example.invalid/jq", sha256: "0".repeat(64),
        archive: "raw", extract: "", bundlePath: "Contents/Helpers/jq", exec: ["Contents/Helpers/jq"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper" },
    ] }));
    const deps = join(work, "deps");
    const built = await buildTreeRows({ appsRoot: apps, depsRoot: deps, lockPath: lock, arch: "arm64", log: () => {} });
    expect(built).toEqual(["alpha", "beta"]);
    expect(readFileSync(join(deps, "arm64", "alpha"), "utf8")).toContain("alpha 0.0.0");
    expect(existsSync(join(deps, "arm64", "alpha-identity", "mattstack.deck.json"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "alpha-skills", "hello", "SKILL.md"))).toBe(true);
    expect(existsSync(join(deps, "arm64", "beta-skills"))).toBe(false);
    expect(existsSync(join(deps, "arm64", "jq"))).toBe(false);
    const smokeHome = readFileSync(join(apps, "alpha", "dist", "alpha.home"), "utf8");
    expect(smokeHome).not.toBe(process.env.HOME);
    expect(smokeHome.startsWith(tmpdir())).toBe(true);
  });

  test("refuses an artifact the recipe did not produce", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const dir = fakeApp(apps, "gamma");
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({ name: "gamma", bundle: { build: "true", artifact: "dist/gamma" } }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "gamma", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/gamma", exec: ["Contents/Helpers/gamma"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" } ] }));
    await expect(buildTreeRows({ appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {} }))
      .rejects.toThrow(/gamma: dist\/gamma missing or not executable/);
  });

  test("calls buildPackages once, before any recipe build runs", async () => {
    const work = mkdtempSync(join(tmpdir(), "build-apps-"));
    const apps = join(work, "apps");
    const marker = join(work, "packages-built");
    const dir = join(apps, "delta");
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "mattstack.deck.json"), JSON.stringify({
      name: "delta",
      bundle: {
        build: `test -f ${marker} && printf '#!/bin/sh\\necho delta 0.0.0\\n' > dist/delta && chmod 755 dist/delta`,
        artifact: "dist/delta",
      },
    }));
    const lock = join(work, "deps.lock");
    writeFileSync(lock, JSON.stringify({ schema: 1, arch: "arm64", tools: [
      { name: "delta", version: "", license: "MIT", source: "tree", archive: "raw", extract: "",
        bundlePath: "Contents/Helpers/delta", exec: ["Contents/Helpers/delta"], exposeByDefault: false,
        entitlements: "jit", status: "bundled", kind: "helper" },
    ] }));
    let calls = 0;
    const built = await buildTreeRows({
      appsRoot: apps, depsRoot: join(work, "deps"), lockPath: lock, arch: "arm64", log: () => {},
      buildPackages: () => { calls++; writeFileSync(marker, ""); },
    });
    expect(calls).toBe(1);
    expect(built).toEqual(["delta"]);
  });

  test("the workspace build filter excludes glance-react", () => {
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=!@mattstack/glance-react");
    expect(WORKSPACE_BUILD_ARGS).toContain("--filter=./packages/*");
  });
});
