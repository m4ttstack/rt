import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PackInfo } from "../packs.ts";
import { bumpPatchVersion, type RunResult, type SyncDeps, syncPack } from "../sync.ts";

type Call = { cmd: string; args: string[]; cwd?: string };

function tmp(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function fixturePack(name: string, marketplace: string | null, version: string): PackInfo {
  const dir = tmp(`rt-sync-${name}-`);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }, null, 2) + "\n");
  writeFileSync(join(dir, "surface.jsonc"), `{ "public": [] }\n`);
  return { name, dir, layout: "flat", surfacePath: join(dir, "surface.jsonc"), marketplace };
}

function pluginId(info: PackInfo): string {
  return `${info.name}@${info.marketplace}`;
}

function readVersion(dir: string): string {
  return JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).version as string;
}

type World = {
  calls: Call[];
  gitStatus?: Record<string, string>;
  statusFail?: Record<string, string>;
  branch?: string;
  branchByDir?: Record<string, string>;
  branchFail?: Record<string, string>;
  installed?: Record<string, string>;
  drift?: boolean[];
  checkThrows?: boolean;
  compileOk?: boolean;
  compileErrors?: string[];
  pullFail?: Record<string, string>;
  pullBumps?: Record<string, string>;
  updateFail?: Record<string, string>;
  cswapSessionsDir?: string;
  configDir?: string;
  claudeBinOverride?: string | null;
};

/**
 * Simulates the real world closely enough that verify-installed sees a
 * matching version after a successful "claude plugin update": the fake
 * update handler copies the current source manifest into the fake
 * installed copy, the same effect the real CLI has on disk.
 */
function makeDeps(pack: PackInfo, engine: PackInfo, world: World): SyncDeps {
  const claudeBin = world.claudeBinOverride === undefined ? "/usr/local/bin/claude" : world.claudeBinOverride;
  const installedVersions = new Map<string, string>(Object.entries(world.installed ?? {}));
  const installDirs = new Map<string, string>();
  const driftAnswers = [...(world.drift ?? [])];

  function installDirFor(id: string): string {
    let dir = installDirs.get(id);
    if (!dir) {
      dir = tmp("rt-sync-installed-");
      installDirs.set(id, dir);
    }
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: id.split("@")[0], version: installedVersions.get(id) }, null, 2) + "\n",
    );
    return dir;
  }

  function sourceDirFor(id: string): string | null {
    if (id === pluginId(pack)) return pack.dir;
    if (id === pluginId(engine)) return engine.dir;
    return null;
  }

  for (const id of installedVersions.keys()) installDirFor(id);

  const run = async (cmd: string, args: string[], opts?: { cwd?: string }): Promise<RunResult> => {
    world.calls.push({ cmd, args, cwd: opts?.cwd });

    if (cmd === "git") {
      const cwd = opts?.cwd ?? "";
      if (args[0] === "status") {
        const stderr = world.statusFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        return { code: 0, stdout: world.gitStatus?.[cwd] ?? "", stderr: "" };
      }
      if (args[0] === "branch") {
        const stderr = world.branchFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        const value = world.branchByDir ? (world.branchByDir[cwd] ?? "main") : (world.branch ?? "main");
        return { code: 0, stdout: value, stderr: "" };
      }
      if (args[0] === "pull") {
        const stderr = world.pullFail?.[cwd];
        if (stderr) return { code: 1, stdout: "", stderr };
        const bumpTo = world.pullBumps?.[cwd];
        if (bumpTo) {
          const manifestPath = join(cwd, ".claude-plugin", "plugin.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: bumpTo }, null, 2) + "\n");
          return { code: 0, stdout: `Updating to ${bumpTo}`, stderr: "" };
        }
        return { code: 0, stdout: "Already up to date.", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }

    if (cmd === claudeBin) {
      if (args[0] === "plugin" && args[1] === "list") {
        const list = [...installedVersions.keys()].map((id) => ({ id, installPath: installDirFor(id) }));
        return { code: 0, stdout: JSON.stringify(list), stderr: "" };
      }
      if (args[0] === "plugin" && args[1] === "update") {
        const id = args[2]!;
        const stderr = world.updateFail?.[id];
        if (stderr) return { code: 2, stdout: "", stderr };
        const sourceDir = sourceDirFor(id);
        if (sourceDir) {
          installedVersions.set(id, readVersion(sourceDir));
          installDirFor(id);
        }
        return { code: 0, stdout: "", stderr: "" };
      }
    }

    return { code: 0, stdout: "", stderr: "" };
  };

  return {
    run,
    claudeBin,
    checkPack: async () => {
      if (world.checkThrows) throw new Error("checkPack: manifest discovery found nothing");
      const next = driftAnswers.shift();
      if (next === undefined) throw new Error("checkPack: fixture ran out of configured drift answers");
      return { drift: next };
    },
    compilePack: async () => ({ ok: world.compileOk ?? true, errors: world.compileErrors ?? [] }),
    configDir: world.configDir ?? tmp("rt-sync-config-"),
    cswapSessionsDir: world.cswapSessionsDir ?? join(tmpdir(), "rt-sync-no-such-cswap-dir"),
  };
}

function stepNames(steps: { name: string }[]): string[] {
  return steps.map((s) => s.name);
}

describe("syncPack", () => {
  test("1: no-op ends the chain at check", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "check"]);
    expect(report.ok).toBe(true);
    expect(report.restartNeeded).toBe(false);
    expect(calls.some((c) => c.args.includes("update"))).toBe(false);
  });

  test("2: lag only skips the compile leg but still updates the pack", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
    });

    const report = await syncPack(pack, engine, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName.bump).toBe("skipped");
    expect(byName.compile).toBe("skipped");
    expect(byName.recheck).toBe("skipped");
    expect(byName["commit-push"]).toBe("skipped");
    expect(byName["update-pack"]).toBe("ran");
    expect(byName["verify-installed"]).toBe("ran");
    expect(report.restartNeeded).toBe(true);
    expect(report.ok).toBe(true);
  });

  test("3: drift bumps, compiles, commits, pushes, and updates", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
    });

    const report = await syncPack(pack, engine, deps);

    expect(readVersion(pack.dir)).toBe("0.5.3");
    const commitPush = calls.filter((c) => c.cwd === pack.dir && c.cmd === "git");
    expect(commitPush.some((c) => c.args[0] === "push")).toBe(true);
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName.bump).toBe("ran");
    expect(byName.compile).toBe("ran");
    expect(byName["commit-push"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(report.ok).toBe(true);
  });

  test("4: drift surviving recompile refuses at recheck", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "check", "bump", "compile", "recheck"]);
    const recheck = report.steps.find((s) => s.name === "recheck")!;
    expect(recheck.status).toBe("refused");
    expect(recheck.detail).toContain("mattstack:editing-skills");
    expect(report.ok).toBe(false);
  });

  test("5: dirty pack checkout refuses guards with no further calls", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, gitStatus: { [pack.dir]: " M x.ts" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("refused");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "branch")).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("6: engine off main refuses guards", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branch: "feature" });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain('engine checkout on branch "feature"');
    expect(report.steps[0]!.detail).toContain("main");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("7: missing marketplace refuses guards naming the pack", async () => {
    const pack = fixturePack("acme", null, "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain('"acme"');
    expect(report.steps[0]!.detail).toContain("marketplace");
    expect(calls).toEqual([]);
  });

  test("8: claudeBin null refuses guards naming the probed locations", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, claudeBinOverride: null });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain(".claude/local/claude");
    expect(report.steps[0]!.detail).toContain("/opt/homebrew/bin/claude");
    expect(report.steps[0]!.detail).toContain("install the Claude CLI or put it on PATH, then re-run");
    expect(calls).toEqual([]);
  });

  test("9: update-engine is skipped when current and runs otherwise", async () => {
    const pack1 = fixturePack("acme", "local", "1.0.0");
    const engine1 = fixturePack("beacon", "local", "2.0.0");
    const calls1: Call[] = [];
    const deps1 = makeDeps(pack1, engine1, {
      calls: calls1,
      installed: { [pluginId(pack1)]: "1.0.0", [pluginId(engine1)]: "2.0.0" },
      drift: [false],
    });
    const report1 = await syncPack(pack1, engine1, deps1);
    expect(report1.steps.find((s) => s.name === "update-engine")!.status).toBe("skipped");
    expect(calls1.some((c) => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === pluginId(engine1))).toBe(false);

    const pack2 = fixturePack("acme", "local", "1.0.0");
    const engine2 = fixturePack("beacon", "local", "2.0.0");
    const calls2: Call[] = [];
    const deps2 = makeDeps(pack2, engine2, {
      calls: calls2,
      installed: { [pluginId(pack2)]: "1.0.0", [pluginId(engine2)]: "1.9.0" },
      drift: [false],
    });
    const report2 = await syncPack(pack2, engine2, deps2);
    expect(report2.steps.find((s) => s.name === "update-engine")!.status).toBe("ran");
    expect(calls2.some((c) => c.args[0] === "plugin" && c.args[1] === "update" && c.args[2] === pluginId(engine2))).toBe(true);
  });

  test("10: the mattstack pack case runs one pull and one update, not two", async () => {
    const mattstack = fixturePack("mattstack", "local", "1.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(mattstack, mattstack, {
      calls,
      installed: { [pluginId(mattstack)]: "0.9.0" },
      drift: [false],
    });

    const report = await syncPack(mattstack, mattstack, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName["pull-engine"]).toBe("skipped");
    expect(byName["update-engine"]).toBe("skipped");
    expect(byName["pull-pack"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(calls.filter((c) => c.args[0] === "pull").length).toBe(1);
    expect(calls.filter((c) => c.args[0] === "plugin" && c.args[1] === "update").length).toBe(1);
  });

  test("11: cswap sweep warns about exactly the divergent session", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const configDir = tmp("rt-sync-config-");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const cswapSessionsDir = tmp("rt-sync-cswap-");
    mkdirSync(join(cswapSessionsDir, "aligned"), { recursive: true });
    symlinkSync(join(configDir, "plugins"), join(cswapSessionsDir, "aligned", "plugins"));
    mkdirSync(join(cswapSessionsDir, "stale", "plugins"), { recursive: true });

    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      configDir,
      cswapSessionsDir,
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain("stale");
    expect(report.steps.find((s) => s.name === "cswap-sweep")!.status).toBe("ran");
  });

  test("12: a failed update-pack fails the step with stderr in the detail", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      updateFail: { [pluginId(pack)]: "boom: registry unreachable" },
    });

    const report = await syncPack(pack, engine, deps);

    const updatePack = report.steps.find((s) => s.name === "update-pack")!;
    expect(updatePack.status).toBe("failed");
    expect(updatePack.detail).toContain("boom: registry unreachable");
    expect(report.ok).toBe(false);
    expect(report.steps.some((s) => s.name === "verify-installed")).toBe(false);
  });

  test("13: bumpPatchVersion increments the patch and rewrites the manifest", () => {
    const pack = fixturePack("acme", "local", "0.5.9");

    const { before, after } = bumpPatchVersion(pack.dir);

    expect(before).toBe("0.5.9");
    expect(after).toBe("0.5.10");
    const raw = readFileSync(join(pack.dir, ".claude-plugin", "plugin.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "version": "0.5.10"');
  });

  test("14: a throwing checkPack fails the check step without escaping syncPack", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "1.0.0", [pluginId(engine)]: "2.0.0" },
      checkThrows: true,
    });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards", "pull-engine", "pull-pack", "update-engine", "check"]);
    const check = report.steps.find((s) => s.name === "check")!;
    expect(check.status).toBe("failed");
    expect(check.detail).toContain("manifest discovery found nothing");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "plugin" && c.args[1] === "update")).toBe(false);
  });

  test("15: a worktrees directory refuses guards before any calls", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    mkdirSync(join(pack.dir, ".worktrees"), { recursive: true });
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain(join(pack.dir, ".worktrees"));
    expect(report.steps[0]!.detail).toContain("prune");
    expect(calls).toEqual([]);
  });

  test("16: a pull that rewrites the manifest to a higher version is read post-pull, not stale from guards", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      pullBumps: { [pack.dir]: "0.5.3", [engine.dir]: "2.1.0" },
    });

    const report = await syncPack(pack, engine, deps);

    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName["update-engine"]).toBe("ran");
    expect(byName["update-pack"]).toBe("ran");
    expect(byName["verify-installed"]).toBe("ran");
    expect(report.versions.engine).toEqual({ before: "2.0.0", after: "2.1.0" });
    expect(report.versions.pack).toEqual({ source: "0.5.3", installedBefore: "0.5.2", installedAfter: "0.5.3" });
    expect(report.ok).toBe(true);
  });

  test("17: a failing git status fails guards (not refuses) carrying stderr", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, statusFail: { [engine.dir]: "fatal: not a git repository" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("fatal: not a git repository");
    expect(report.ok).toBe(false);
  });

  test("18: a failing git branch fails guards carrying stderr", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branchFail: { [engine.dir]: "fatal: ambiguous HEAD" } });

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("fatal: ambiguous HEAD");
    expect(report.ok).toBe(false);
  });

  test("19: a failing claude plugin list fails guards with stderr, not a JSON parse error", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls });
    const originalRun = deps.run;
    deps.run = async (cmd, args, opts) => {
      if (args[0] === "plugin" && args[1] === "list") return { code: 1, stdout: "", stderr: "claude: command not found" };
      return originalRun(cmd, args, opts);
    };

    const report = await syncPack(pack, engine, deps);

    expect(stepNames(report.steps)).toEqual(["guards"]);
    expect(report.steps[0]!.status).toBe("failed");
    expect(report.steps[0]!.detail).toContain("claude: command not found");
    expect(report.steps[0]!.detail).not.toContain("Unexpected end of JSON input");
  });

  test("20: pack checkout off main refuses guards", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, { calls, branchByDir: { [engine.dir]: "main", [pack.dir]: "feature" } });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps[0]!.status).toBe("refused");
    expect(report.steps[0]!.detail).toContain('pack checkout on branch "feature"');
    expect(report.steps[0]!.detail).toContain("main");
    expect(report.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "pull")).toBe(false);
  });

  test("21: a compile refusal reverts the version bump write-back so the tree stays clean", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true],
      compileOk: false,
      compileErrors: ["boom: template placeholder unresolved"],
    });

    const report = await syncPack(pack, engine, deps);

    const compile = report.steps.find((s) => s.name === "compile")!;
    expect(compile.status).toBe("refused");
    expect(compile.detail).toContain("boom: template placeholder unresolved");
    expect(compile.detail).toContain("reverted plugin.json to 0.5.2");
    expect(readVersion(pack.dir)).toBe("0.5.2");
    expect(report.ok).toBe(false);
  });

  test("22: a recheck refusal names the uncommitted bump and compiled output", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    const recheck = report.steps.find((s) => s.name === "recheck")!;
    expect(recheck.status).toBe("refused");
    expect(recheck.detail).toContain("0.5.2 -> 0.5.3");
    expect(recheck.detail).toContain("uncommitted version bump");
    expect(recheck.detail).toContain("compiled output");
    expect(recheck.detail).toContain("continuing from this working tree");
    // the tree is left as-is (no write-back) on a recheck refusal
    expect(readVersion(pack.dir)).toBe("0.5.3");
  });

  test("23: commit-push scopes git add to plugin.json and the compiled output dirs, never -A", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    mkdirSync(join(pack.dir, "skills"), { recursive: true });
    const engine = fixturePack("beacon", "local", "2.0.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "2.0.0" },
      drift: [true, false],
    });

    const report = await syncPack(pack, engine, deps);

    const add = calls.find((c) => c.cwd === pack.dir && c.cmd === "git" && c.args[0] === "add")!;
    expect(add.args).not.toContain("-A");
    expect(add.args).toEqual(["add", "--", join(".claude-plugin", "plugin.json"), "skills"]);
    expect(report.steps.find((s) => s.name === "commit-push")!.status).toBe("ran");
  });

  test("24: installedEngineAfter is honest when the chain stops after update-engine", async () => {
    const pack = fixturePack("acme", "local", "0.5.2");
    const engine = fixturePack("beacon", "local", "1.9.0");
    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.5.2", [pluginId(engine)]: "1.8.0" },
      drift: [true, true],
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.steps.find((s) => s.name === "update-engine")!.status).toBe("ran");
    expect(report.steps.find((s) => s.name === "recheck")!.status).toBe("refused");
    expect(report.versions.engine).toEqual({ before: "1.8.0", after: "1.9.0" });
  });

  test("25: a dangling cswap plugins symlink warns instead of silently skipping", async () => {
    const pack = fixturePack("acme", "local", "1.0.0");
    const engine = fixturePack("beacon", "local", "2.0.0");
    const configDir = tmp("rt-sync-config-");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    const cswapSessionsDir = tmp("rt-sync-cswap-dangling-");
    const missingTarget = join(cswapSessionsDir, "no-such-target");
    mkdirSync(join(cswapSessionsDir, "dangling"), { recursive: true });
    symlinkSync(missingTarget, join(cswapSessionsDir, "dangling", "plugins"));

    const calls: Call[] = [];
    const deps = makeDeps(pack, engine, {
      calls,
      installed: { [pluginId(pack)]: "0.9.0", [pluginId(engine)]: "2.0.0" },
      drift: [false],
      configDir,
      cswapSessionsDir,
    });

    const report = await syncPack(pack, engine, deps);

    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain("dangling");
  });
});
