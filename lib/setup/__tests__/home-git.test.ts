import { beforeEach, describe, expect, test } from "bun:test";
import { hasCommits, hasRemote, isGitRepo, originPushState, resetCltCacheForTests } from "../home-git.ts";
import type { Probes } from "../probes.ts";

type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });
const fail = (code = 2): Result => ({ code, stdout: "", stderr: "" });

function scriptedExec(script: (argv: string[]) => Result): { exec: Probes["exec"]; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Probes["exec"] = async (argv) => {
    calls.push(argv);
    return script(argv);
  };
  return { exec, calls };
}

beforeEach(() => resetCltCacheForTests());

describe("home-git without command line tools", () => {
  // The /usr/bin/git stub pops Apple's "install the developer tools?" dialog
  // when a GUI process (the tray's status poll) invokes it — so no helper
  // here may run git until xcode-select reports a developer dir.
  test("every probe answers its no-git shape and git is NEVER exec'd", async () => {
    const { exec, calls } = scriptedExec((argv) => (argv[0] === "xcode-select" ? fail() : ok("true\n")));

    expect(await isGitRepo(exec, "/home/user")).toBe(false);
    expect(await hasRemote(exec, "/home/user")).toBe(false);
    expect(await hasCommits(exec, "/home/user")).toBe(false);
    expect(await originPushState(exec, "/home/user")).toEqual({ kind: "unknown" });
    expect(calls.every((argv) => argv[0] !== "git")).toBe(true);
  });

  test("CLT arriving mid-session is picked up — only the positive is cached", async () => {
    let cltInstalled = false;
    const { exec, calls } = scriptedExec((argv) => {
      if (argv[0] === "xcode-select") return cltInstalled ? ok("/Library/Developer/CommandLineTools\n") : fail();
      return ok("true\n");
    });

    expect(await isGitRepo(exec, "/home/user")).toBe(false);
    cltInstalled = true;
    expect(await isGitRepo(exec, "/home/user")).toBe(true);
    // A later call rides the cached positive: no second xcode-select probe.
    const probesBefore = calls.filter((a) => a[0] === "xcode-select").length;
    expect(await hasCommits(exec, "/home/user")).toBe(true);
    expect(calls.filter((a) => a[0] === "xcode-select").length).toBe(probesBefore);
  });
});

describe("home-git with command line tools", () => {
  test("probes run git and report its answers", async () => {
    const { exec } = scriptedExec((argv) => {
      if (argv[0] === "xcode-select") return ok("/Library/Developer/CommandLineTools\n");
      if (argv.includes("--is-inside-work-tree")) return ok("true\n");
      if (argv[1] === "remote") return ok("origin\n");
      return ok();
    });
    expect(await isGitRepo(exec, "/home/user")).toBe(true);
    expect(await hasRemote(exec, "/home/user")).toBe(true);
  });
});

// RT-139: homeBackupRow needs HEAD's own committer date on the "ahead" branch
// to tell a commit still inside the daemon's push window from one it genuinely
// failed to push. originPushState is the only place that has run `git log`.
describe("home-git - originPushState ahead branch carries HEAD's committer date", () => {
  function aheadExec(opts: { count: string; logResult?: Result; logArgv?: string[] }): Probes["exec"] {
    return async (argv) => {
      if (argv[0] === "xcode-select") return ok("/Library/Developer/CommandLineTools\n");
      if (argv[1] === "symbolic-ref") return ok("main\n");
      if (argv[1] === "rev-parse" && argv.includes("HEAD") && !argv.some((a) => a.startsWith("refs/"))) return ok("deadbeef\n");
      if (argv[1] === "rev-parse" && argv.some((a) => a.startsWith("refs/"))) return ok("cafefeed\n");
      if (argv[1] === "rev-list") return ok(`${opts.count}\n`);
      if (argv[1] === "log") return opts.logResult ?? ok("2026-09-01T00:00:00-05:00\n");
      return ok();
    };
  }

  test("ahead: carries HEAD's own committer date (git log -1 HEAD, not the ref)", async () => {
    const state = await originPushState(aheadExec({ count: "2" }), "/home/user");
    expect(state).toEqual({ kind: "ahead", count: 2, committedAt: new Date("2026-09-01T00:00:00-05:00") });
  });

  test("ahead: the committer-date git log call is bound to HEAD, not the remote-tracking ref", async () => {
    const calls: string[][] = [];
    const exec: Probes["exec"] = async (argv) => {
      calls.push(argv);
      return aheadExec({ count: "1" })(argv);
    };
    await originPushState(exec, "/home/user");
    const logCall = calls.find((argv) => argv[1] === "log");
    expect(logCall).toEqual(["git", "log", "-1", "--format=%cI", "HEAD"]);
  });

  // Mirrors the up-to-date branch: a failed committer-date read degrades to a
  // null date, never to a thrown error or a guessed date. homeBackupRow
  // treats a null committedAt as "cannot confirm freshness", never as fresh.
  test("ahead: committer-date git log failing -> committedAt null, kind stays 'ahead'", async () => {
    const state = await originPushState(aheadExec({ count: "3", logResult: fail() }), "/home/user");
    expect(state).toEqual({ kind: "ahead", count: 3, committedAt: null });
  });
});
