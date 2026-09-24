import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../setup/errors.ts";
import { devAppStagePaths, stageLocalDevApp, type StageSeams } from "../dev-app-stage.ts";

const ok = (stdout = "") => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom") => Promise.resolve({ stdout: "", stderr, exitCode: 1 });

function fakeSeams(opts: { dirty?: boolean; buildExit?: number; hasDeps?: boolean; failCmd?: string } = {}) {
  const calls: string[] = [];
  const writes: Record<string, string> = {};
  const seams: StageSeams = {
    home: "/Users/t",
    now: () => new Date(2026, 8, 24, 9, 41, 2),
    scratchDir: () => "/scratch",
    pathExists: (p) => p === "/src/tree/rt-tray/build.sh" || (p === "/src/tree/rt-tray/deps" && (opts.hasDeps ?? true)),
    writeFile: (p, content) => {
      writes[p] = content;
    },
    exec: (argv) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      if (opts.failCmd && cmd.startsWith(opts.failCmd)) return fail();
      if (cmd === "git rev-parse --show-toplevel") return ok("/src/tree\n");
      if (cmd === "git rev-parse --short HEAD") return ok("abc1234\n");
      if (cmd === "git status --porcelain") return ok(opts.dirty ? " M rt-tray/Sources/AppDelegate.swift\n" : "");
      if (cmd === "git describe --tags --abbrev=0") return ok("v2.11.0\n");
      if (cmd.includes("rt-tray/build.sh dev")) return opts.buildExit ? fail("build broke") : ok();
      return ok();
    },
  };
  return { seams, calls, writes };
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
    expect(copy).toContain("--filter=:- .gitignore");
    expect(calls).toContain("cp -R /src/tree/rt-tray/deps /scratch/rt-tray/deps");
    expect(calls.some((c) => c.startsWith("scripts/fetch-deps.sh"))).toBe(false);
    expect(calls).toContain("env MS_BUILD_STAMP=2026-09-24 09:41:02 abc1234+dirty tree RT_VERSION=v2.11.0 rt-tray/build.sh dev");

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

  test("a clean tree has no +dirty and fetches deps when the tree has none", async () => {
    const { seams, calls } = fakeSeams({ dirty: false, hasDeps: false });
    const { stamp } = await stageLocalDevApp(seams, "/src/tree");
    expect(stamp).toBe("2026-09-24 09:41:02 abc1234 tree");
    expect(calls).toContain("scripts/fetch-deps.sh arm64");
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
});
