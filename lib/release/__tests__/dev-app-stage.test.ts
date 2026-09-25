import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { UserActionableError } from "../../setup/errors.ts";
import { CLEAN_DIFF_HASH } from "../dev-app-cache.ts";
import { devAppStagePaths, stageLocalDevApp, type StageSeams } from "../dev-app-stage.ts";

const ok = (stdout = "") => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom") => Promise.resolve({ stdout: "", stderr, exitCode: 1 });

type SourceDeps = "full" | "partial" | "none";

const FULL_SHA = "abc1234".padEnd(40, "0");
const RUNNING_APP = "/Apps/mattstack-dev.app";
const BUILDS = "/Users/t/.mattstack/rt/dev-app/builds";
const cleanKey = {
  MSBuildTree: "/src/tree",
  MSBuildSha: FULL_SHA,
  MSBuildDiffHash: CLEAN_DIFF_HASH,
  MSBuildVersion: "v2.11.0",
};

function fakeSeams(
  opts: {
    dirty?: boolean;
    buildExit?: number;
    sourceDeps?: SourceDeps;
    failCmd?: string;
    plists?: Record<string, Record<string, string>>;
    cacheEntries?: string[];
    untracked?: string;
    diffAfterCopy?: string;
  } = {},
) {
  const calls: string[] = [];
  const cwds: (string | undefined)[] = [];
  const writes: Record<string, string> = {};
  const logs: string[] = [];
  const sourceDeps = opts.sourceDeps ?? "full";
  const scratchDeps = new Set<string>();
  const plists = opts.plists ?? {};
  const seams: StageSeams = {
    home: "/Users/t",
    runningApp: RUNNING_APP,
    now: () => new Date(2026, 8, 24, 9, 41, 2),
    scratchDir: () => "/scratch",
    listDir: (p) => (p === BUILDS ? (opts.cacheEntries ?? []) : []),
    readBytes: () => null,
    readLink: () => null,
    pathExists: (p) =>
      Object.keys(plists).some((b) => `${b}/Contents/Info.plist` === p) ||
      p === "/src/tree/rt-tray/build.sh" ||
      (p === "/src/tree/rt-tray/deps" && sourceDeps !== "none") ||
      (p === "/src/tree/rt-tray/deps/arm64" && sourceDeps === "full") ||
      scratchDeps.has(p),
    writeFile: (p, content) => {
      writes[p] = content;
    },
    log: (line) => {
      logs.push(line);
    },
    exec: (argv, execOpts) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      cwds.push(execOpts?.cwd);
      if (opts.failCmd && cmd.startsWith(opts.failCmd)) return fail();
      if (cmd === "cp -R /src/tree/rt-tray/deps /scratch/rt-tray/deps") {
        scratchDeps.add("/scratch/rt-tray/deps/tools");
        if (sourceDeps === "full") scratchDeps.add("/scratch/rt-tray/deps/arm64");
      }
      if (cmd === "git rev-parse --show-toplevel") return ok("/src/tree\n");
      if (cmd === "git rev-parse --short HEAD") return ok("abc1234\n");
      if (cmd === "git rev-parse HEAD") return ok(`${FULL_SHA}\n`);
      if (cmd.startsWith("git diff HEAD")) {
        const copied = calls.some((c) => c.startsWith("rsync"));
        if (copied && opts.diffAfterCopy !== undefined) return ok(opts.diffAfterCopy);
        return ok(opts.dirty ? "diff --git a/x b/x\n+1\n" : "");
      }
      if (cmd === "git ls-files -z --cached") return ok("cli.ts\0rt-tray/build.sh\0");
      if (cmd === "git ls-files -z --deleted") return ok("");
      if (cmd === "git ls-files -z --others --exclude-standard") return ok(opts.untracked ?? "");
      if (argv[0] === "plutil" && argv[1] === "-extract") {
        const bundle = argv[argv.length - 1]!.replace(/\/Contents\/Info\.plist$/, "");
        const v = plists[bundle]?.[argv[2]!];
        return v === undefined ? fail() : ok(`${v}\n`);
      }
      if (cmd === "git status --porcelain") return ok(opts.dirty ? " M rt-tray/Sources/AppDelegate.swift\n" : "");
      if (cmd === "git describe --tags --abbrev=0") return ok("v2.11.0\n");
      if (cmd.includes("rt-tray/build.sh dev")) return opts.buildExit ? fail("build broke") : ok();
      return ok();
    },
  };
  return { seams, calls, cwds, writes, logs };
}

describe("stageLocalDevApp", () => {
  test("builds the working tree in a scratch copy and stages it by rename", async () => {
    const { seams, calls, writes } = fakeSeams({ dirty: true });
    const { stamp, stagedPath } = await stageLocalDevApp(seams, "/src/tree/rt-tray");
    expect(stamp).toBe("2026-09-24 09:41:02 abc1234+dirty tree");
    const paths = devAppStagePaths("/Users/t");
    expect(stagedPath).toBe(`${paths.stagedDir}/mattstack-dev.app`);

    const copy = calls.find((c) => c.startsWith("rsync"))!;
    expect(copy).toContain("/src/tree/ /scratch/");
    expect(copy).toContain("--exclude=.git");
    expect(calls).toContain("cp -R /src/tree/rt-tray/deps /scratch/rt-tray/deps");
    const build = calls.find((c) => c.includes("rt-tray/build.sh dev"))!;
    expect(build.startsWith("env MS_BUILD_STAMP=2026-09-24 09:41:02 abc1234+dirty tree ")).toBe(true);
    expect(build.endsWith(" RT_VERSION=v2.11.0 rt-tray/build.sh dev")).toBe(true);

    const ditto = calls.findIndex((c) => c.startsWith("ditto /scratch/rt-tray/mattstack-dev.app"));
    const swap = calls.findIndex((c) => c.startsWith("mv ") && c.endsWith(` ${paths.stagedDir}`));
    expect(ditto).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(ditto);
    expect(writes[paths.lastSourceFile]).toBe("/src/tree");
  });

  test("the live staged dir is retired by rename, never deleted in place, so a restart mid-stage sees a whole bundle or none", async () => {
    const { seams, calls } = fakeSeams();
    await stageLocalDevApp(seams, "/src/tree");
    const paths = devAppStagePaths("/Users/t");
    expect(calls).not.toContain(`rm -rf ${paths.stagedDir}`);
    const retire = calls.findIndex((c) => c.startsWith(`mv -f ${paths.stagedDir} ${paths.root}/.retired-`));
    const install = calls.findIndex((c) => c.startsWith(`mv ${paths.root}/.incoming-`) && c.endsWith(` ${paths.stagedDir}`));
    expect(retire).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(retire);
    expect(calls.findIndex((c) => c.startsWith(`rm -rf ${paths.root}/.retired-`))).toBeGreaterThan(install);
  });

  test("a staged dir that could not be retired fails staging instead of nesting the new bundle inside it", async () => {
    const { seams, calls } = fakeSeams();
    const paths = devAppStagePaths("/Users/t");
    const exists = seams.pathExists;
    seams.pathExists = (p) => p === paths.stagedDir || exists(p);
    await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow("could not retire");
    expect(calls.some((c) => c.startsWith("mv ") && c.includes(".incoming-") && c.endsWith(` ${paths.stagedDir}`))).toBe(false);
    expect(calls.some((c) => c.startsWith(`rm -rf ${paths.root}/.incoming-`))).toBe(true);
  });

  test("a checkout that is not repo-tools is refused before copying", async () => {
    const { seams, calls } = fakeSeams();
    seams.pathExists = () => false;
    await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow("not a repo-tools checkout");
    expect(calls.some((c) => c.startsWith("rsync"))).toBe(false);
  });

  test("a build failure names what build.sh printed on stdout, where its errors go", async () => {
    const { seams } = fakeSeams();
    const exec = seams.exec;
    seams.exec = (argv, opts) =>
      argv.join(" ").includes("rt-tray/build.sh dev")
        ? Promise.resolve({ stdout: "  ✗ deck-dev-shim not built\n", stderr: "warning: noise\n", exitCode: 1 })
        : exec(argv, opts);
    await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow("deck-dev-shim not built");
  });

  test("a clean tree has no +dirty", async () => {
    const { seams } = fakeSeams({ dirty: false });
    const { stamp } = await stageLocalDevApp(seams, "/src/tree");
    expect(stamp).toBe("2026-09-24 09:41:02 abc1234 tree");
  });

  test("a tree with a full deps folder still reconciles it against deps.lock after the copy", async () => {
    const { seams, calls, cwds } = fakeSeams({ sourceDeps: "full" });
    await stageLocalDevApp(seams, "/src/tree");
    const copy = calls.indexOf("cp -R /src/tree/rt-tray/deps /scratch/rt-tray/deps");
    const fetch = calls.indexOf("bash scripts/fetch-deps.sh arm64");
    const build = calls.findIndex((c) => c.includes("rt-tray/build.sh dev"));
    expect(copy).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(copy);
    expect(cwds[fetch]).toBe("/scratch");
    expect(build).toBeGreaterThan(fetch);
  });

  test("a tree without deps fetches them with bash in the scratch copy, before the build", async () => {
    const { seams, calls, cwds } = fakeSeams({ sourceDeps: "none" });
    await stageLocalDevApp(seams, "/src/tree");
    const fetch = calls.indexOf("bash scripts/fetch-deps.sh arm64");
    const build = calls.findIndex((c) => c.includes("rt-tray/build.sh dev"));
    expect(fetch).toBeGreaterThan(-1);
    expect(cwds[fetch]).toBe("/scratch");
    expect(build).toBeGreaterThan(fetch);
    expect(calls.some((c) => c.startsWith("cp -R"))).toBe(false);
  });

  test("a tree whose deps lack arm64 still copies them, then fetches the rest in the scratch copy", async () => {
    const { seams, calls, cwds } = fakeSeams({ sourceDeps: "partial" });
    await stageLocalDevApp(seams, "/src/tree");
    const copy = calls.indexOf("cp -R /src/tree/rt-tray/deps /scratch/rt-tray/deps");
    const fetch = calls.indexOf("bash scripts/fetch-deps.sh arm64");
    expect(copy).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(copy);
    expect(cwds[fetch]).toBe("/scratch");
  });

  test("the fetch gets a generous timeout, since it downloads and compiles helpers", async () => {
    const { seams } = fakeSeams({ sourceDeps: "none" });
    let timeoutMs: number | undefined;
    const exec = seams.exec;
    seams.exec = (argv, opts) => {
      if (argv.join(" ") === "bash scripts/fetch-deps.sh arm64") timeoutMs = opts?.timeoutMs;
      return exec(argv, opts);
    };
    await stageLocalDevApp(seams, "/src/tree");
    expect(timeoutMs).toBeGreaterThanOrEqual(1_200_000);
  });

  test("a failed fetch fails the stage naming the step and never builds", async () => {
    const { seams, calls } = fakeSeams({ sourceDeps: "none", failCmd: "bash scripts/fetch-deps.sh" });
    const err = await stageLocalDevApp(seams, "/src/tree").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as Error).message).toContain("scripts/fetch-deps.sh arm64 failed");
    expect(calls.some((c) => c.includes("rt-tray/build.sh dev"))).toBe(false);
  });

  test("a failed build is a UserActionableError and never touches the staged build", async () => {
    const { seams, calls } = fakeSeams({ buildExit: 1 });
    await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow(UserActionableError);
    const paths = devAppStagePaths("/Users/t");
    expect(calls.some((c) => c.includes(paths.stagedDir))).toBe(false);
  });

  test("outside a git checkout it refuses before copying anything", async () => {
    const { seams, calls } = fakeSeams({ failCmd: "git rev-parse --show-toplevel" });
    await expect(stageLocalDevApp(seams, "/nowhere")).rejects.toThrow(UserActionableError);
    expect(calls.some((c) => c.startsWith("rsync"))).toBe(false);
  });

  test("the build carries the tree's identity for build.sh to bake into Info.plist", async () => {
    const { seams, calls } = fakeSeams();
    await stageLocalDevApp(seams, "/src/tree");
    const build = calls.find((c) => c.includes("rt-tray/build.sh dev"))!;
    expect(build).toContain(
      ` MS_BUILD_TREE=/src/tree MS_BUILD_SHA=${FULL_SHA} MS_BUILD_DIFF_HASH=${CLEAN_DIFF_HASH} MS_BUILD_VERSION=v2.11.0 `,
    );
  });

  test("build.sh bakes every identity variable the stage passes into a dev bundle's Info.plist", () => {
    const script = readFileSync(join(import.meta.dir, "../../../rt-tray/build.sh"), "utf8");
    for (const [env, key] of [
      ["MS_BUILD_TREE", "MSBuildTree"],
      ["MS_BUILD_SHA", "MSBuildSha"],
      ["MS_BUILD_DIFF_HASH", "MSBuildDiffHash"],
      ["MS_BUILD_VERSION", "MSBuildVersion"],
    ]) {
      expect(script).toContain(`plutil -replace ${key} -string "$${env}" "$INFO"`);
    }
  });

  test("a cached build of the same tree, sha and diff is cloned into staging instead of rebuilt", async () => {
    const entry = `${BUILDS}/tree-abc`;
    const { seams, calls, writes } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${entry}/bundle`]: { ...cleanKey, MSBuildStamp: "2026-09-20 08:00:00 abc1234 tree" } },
    });
    const result = await stageLocalDevApp(seams, "/src/tree");
    const paths = devAppStagePaths("/Users/t");
    expect(result).toEqual({
      outcome: "cached",
      stamp: "2026-09-20 08:00:00 abc1234 tree",
      stagedPath: `${paths.stagedDir}/mattstack-dev.app`,
    });
    expect(calls.some((c) => c.startsWith("rsync") || c.includes("build.sh") || c.includes("fetch-deps"))).toBe(false);
    const clone = calls.findIndex((c) => c.startsWith(`cp -cR ${entry}/bundle ${paths.root}/.incoming-`));
    const install = calls.findIndex((c) => c.startsWith(`mv ${paths.root}/.incoming-`) && c.endsWith(` ${paths.stagedDir}`));
    expect(clone).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(clone);
    expect(writes[paths.lastSourceFile]).toBe("/src/tree");
  });

  test("a clone the volume refuses falls back to a plain copy", async () => {
    const entry = `${BUILDS}/tree-abc`;
    const { seams, calls } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${entry}/bundle`]: { ...cleanKey, MSBuildStamp: "s" } },
      failCmd: "cp -cR",
    });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("cached");
    const paths = devAppStagePaths("/Users/t");
    expect(calls.some((c) => c.startsWith(`ditto ${entry}/bundle ${paths.root}/.incoming-`))).toBe(true);
  });

  test("a cached build whose uncommitted state differs is not reused", async () => {
    const { seams, calls } = fakeSeams({
      dirty: true,
      cacheEntries: ["tree-abc"],
      plists: { [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildStamp: "s" } },
    });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    expect(calls.some((c) => c.includes("rt-tray/build.sh dev"))).toBe(true);
    expect(calls.some((c) => c.startsWith("cp -cR"))).toBe(false);
  });

  test("when the running app is already this tree's build, nothing is built or staged", async () => {
    const { seams, calls } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: {
        [RUNNING_APP]: { ...cleanKey, MSBuildStamp: "running stamp" },
        [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildStamp: "s" },
      },
    });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result).toEqual({ outcome: "running", stamp: "running stamp", stagedPath: null, clearedStaged: false });
    expect(calls.some((c) => c.startsWith("rsync") || c.startsWith("cp ") || c.startsWith("mv ") || c.startsWith("ditto"))).toBe(
      false,
    );
  });

  test("a tree with no identity (git could not describe it) still builds, without identity variables", async () => {
    const { seams, calls } = fakeSeams({ failCmd: "git diff HEAD" });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    const build = calls.find((c) => c.includes("rt-tray/build.sh dev"))!;
    expect(build).not.toContain("MS_BUILD_SHA");
  });

  test("a cached build made before HEAD was tagged is not reused, since it carries the old version", async () => {
    const { seams, calls } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildVersion: "v2.10.0", MSBuildStamp: "s" } },
    });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    expect(calls.some((c) => c.startsWith("cp -cR"))).toBe(false);
  });

  test("a cached bundle is only staged once its signature verifies", async () => {
    const { seams, calls } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildStamp: "s" } },
    });
    const paths = devAppStagePaths("/Users/t");
    await stageLocalDevApp(seams, "/src/tree");
    const verify = calls.findIndex((c) => /^codesign --verify --strict .*\/\.incoming-\d+\/mattstack-dev\.app$/.test(c));
    const clone = calls.findIndex((c) => c.startsWith("cp -cR"));
    const install = calls.findIndex((c) => c.startsWith(`mv ${paths.root}/.incoming-`) && c.endsWith(` ${paths.stagedDir}`));
    expect(verify).toBeGreaterThan(clone);
    expect(install).toBeGreaterThan(verify);
  });

  test("a cached bundle whose signature fails is dropped and the tree is built instead, saying why", async () => {
    const { seams, calls, logs } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildStamp: "s" } },
      failCmd: "codesign --verify",
    });
    const paths = devAppStagePaths("/Users/t");
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    const verify = calls.findIndex((c) => c.startsWith("codesign --verify"));
    const cleanup = calls.findIndex((c, i) => i > verify && c.startsWith(`rm -rf ${paths.root}/.incoming-`));
    const build = calls.findIndex((c) => c.includes("rt-tray/build.sh dev"));
    expect(cleanup).toBeGreaterThan(verify);
    expect(build).toBeGreaterThan(cleanup);
    expect(logs.some((l) => l.includes("signature") && l.includes(`${BUILDS}/tree-abc/bundle`))).toBe(true);
    const drop = calls.indexOf(`rm -rf ${BUILDS}/tree-abc`);
    expect(drop).toBeGreaterThan(verify);
    expect(build).toBeGreaterThan(drop);
  });

  test("a cached bundle that cannot be copied at all is built instead, and the entry is kept", async () => {
    const { seams, calls, logs } = fakeSeams({
      cacheEntries: ["tree-abc"],
      plists: { [`${BUILDS}/tree-abc/bundle`]: { ...cleanKey, MSBuildStamp: "s" } },
    });
    const exec = seams.exec;
    seams.exec = (argv, o) =>
      (argv[0] === "cp" || argv[0] === "ditto") && argv.includes(`${BUILDS}/tree-abc/bundle`)
        ? (calls.push(argv.join(" ")), Promise.resolve({ stdout: "", stderr: "disk full", exitCode: 1 }))
        : exec(argv, o);
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    expect(calls).not.toContain(`rm -rf ${BUILDS}/tree-abc`);
    expect(logs.some((l) => l.includes("could not copy") && l.includes("disk full"))).toBe(true);
  });

  test("the copy is driven by the same git listing the key hashes, not by .gitignore alone", async () => {
    const { seams, calls, writes } = fakeSeams({ untracked: "new.ts\0" });
    const paths = devAppStagePaths("/Users/t");
    await stageLocalDevApp(seams, "/src/tree");
    const copy = calls.find((c) => c.startsWith("rsync"))!;
    expect(copy).not.toContain(".gitignore");
    expect(copy).toContain(" -r ");
    expect(copy).toContain(" --from0 ");
    const listFile = copy.match(/--files-from=(\S+)/)![1]!;
    expect(listFile.startsWith(`${paths.root}/`)).toBe(true);
    expect(writes[listFile]).toBe("cli.ts\0new.ts\0rt-tray/build.sh\0");
    const removed = calls.findIndex((c) => c === `rm -f ${listFile}`);
    expect(removed).toBeGreaterThan(calls.indexOf(copy));
  });

  test("a tree with an untracked nested repo still builds, uncached, and says why", async () => {
    const { seams, calls, logs } = fakeSeams({ untracked: "vendor/thing/\0" });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    expect(calls.find((c) => c.includes("rt-tray/build.sh dev"))).not.toContain("MS_BUILD_SHA");
    expect(logs.some((l) => l.includes("not be cached") && l.includes("vendor/thing/"))).toBe(true);
  });

  test("a tree git cannot list is refused before copying", async () => {
    const { seams, calls } = fakeSeams({ failCmd: "git ls-files -z --cached" });
    await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow(UserActionableError);
    expect(calls.some((c) => c.startsWith("rsync"))).toBe(false);
  });

  test("a tree edited while it was copied still builds, but without an identity it no longer matches", async () => {
    const { seams, calls, logs } = fakeSeams({ diffAfterCopy: "diff --git a/y b/y\n+edited\n" });
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result.outcome).toBe("built");
    const copy = calls.findIndex((c) => c.startsWith("rsync"));
    const recheck = calls.findIndex((c, i) => i > copy && c.startsWith("git diff HEAD"));
    expect(recheck).toBeGreaterThan(copy);
    const build = calls.find((c) => c.includes("rt-tray/build.sh dev"))!;
    for (const v of ["MS_BUILD_TREE", "MS_BUILD_SHA", "MS_BUILD_DIFF_HASH", "MS_BUILD_VERSION"]) expect(build).not.toContain(v);
    expect(build).toContain("MS_BUILD_STAMP=");
    expect(logs.some((l) => l.includes("changed while it was copied"))).toBe(true);
  });

  test("an unchanged tree keeps its identity through the copy", async () => {
    const { seams, calls } = fakeSeams({ diffAfterCopy: "" });
    await stageLocalDevApp(seams, "/src/tree");
    expect(calls.find((c) => c.includes("rt-tray/build.sh dev"))).toContain("MS_BUILD_SHA=");
  });

  test("when the running app is already this build, a different staged build is retired so Restart stops offering it", async () => {
    const { seams, calls } = fakeSeams({ plists: { [RUNNING_APP]: { ...cleanKey, MSBuildStamp: "running stamp" } } });
    const paths = devAppStagePaths("/Users/t");
    const exists = seams.pathExists;
    let staged = true;
    seams.pathExists = (p) => (p === paths.stagedDir ? staged : exists(p));
    const exec = seams.exec;
    seams.exec = (argv, o) => {
      if (argv[0] === "mv" && argv[2] === paths.stagedDir) staged = false;
      return exec(argv, o);
    };
    const result = await stageLocalDevApp(seams, "/src/tree");
    expect(result).toEqual({ outcome: "running", stamp: "running stamp", stagedPath: null, clearedStaged: true });
    const retire = calls.findIndex((c) => c.startsWith(`mv -f ${paths.stagedDir} ${paths.root}/.retired-`));
    expect(retire).toBeGreaterThan(-1);
    expect(calls.findIndex((c) => c.startsWith(`rm -rf ${paths.root}/.retired-`))).toBeGreaterThan(retire);
    expect(calls).not.toContain(`rm -rf ${paths.stagedDir}`);
    expect(calls.some((c) => c.startsWith("rsync"))).toBe(false);
  });

  for (const code of [23, 24]) {
    test(`a file that vanishes mid-copy (rsync exit ${code}) is retried once from a fresh listing, and left uncached`, async () => {
      const { seams, calls, writes } = fakeSeams({ untracked: "gone.ts\0" });
      const exec = seams.exec;
      let rsyncs = 0;
      seams.exec = (argv, o) => {
        const cmd = argv.join(" ");
        if (argv[0] === "rsync") {
          calls.push(cmd);
          rsyncs++;
          return Promise.resolve({ stdout: "", stderr: "gone.ts: stat: No such file", exitCode: rsyncs === 1 ? code : 0 });
        }
        if (cmd === "git ls-files -z --others --exclude-standard" && rsyncs > 0) {
          calls.push(cmd);
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        }
        return exec(argv, o);
      };
      const result = await stageLocalDevApp(seams, "/src/tree");
      expect(result.outcome).toBe("built");
      const copies = calls.filter((c) => c.startsWith("rsync"));
      expect(copies.length).toBe(2);
      const second = copies[1]!.match(/--files-from=(\S+)/)![1]!;
      expect(writes[second]).toBe("cli.ts\0rt-tray/build.sh\0");
      expect(calls.indexOf("rm -rf /scratch")).toBeGreaterThan(calls.indexOf(copies[0]!));
      expect(calls.find((c) => c.includes("rt-tray/build.sh dev"))).not.toContain("MS_BUILD_SHA");
    });
  }

  test("a copy that fails again after the retry, or fails some other way, still fails the stage", async () => {
    for (const codes of [[23, 23], [12]]) {
      const { seams, calls } = fakeSeams();
      const exec = seams.exec;
      let n = 0;
      seams.exec = (argv, o) =>
        argv[0] === "rsync"
          ? (calls.push(argv.join(" ")), Promise.resolve({ stdout: "", stderr: "broke", exitCode: codes[Math.min(n++, codes.length - 1)]! }))
          : exec(argv, o);
      await expect(stageLocalDevApp(seams, "/src/tree")).rejects.toThrow("copying /src/tree failed");
      expect(calls.filter((c) => c.startsWith("rsync")).length).toBe(codes.length);
    }
  });
});
