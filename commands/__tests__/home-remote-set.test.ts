import { describe, expect, test } from "bun:test";
import { join } from "path";
import { homeRemoteSet, type HomeRemoteDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecResult, Probes } from "../../lib/setup/probes.ts";

const HOME = "/fake-home";
const USER_REPO = join(HOME, ".mattstack", "user");
const GIT_DIR = join(USER_REPO, ".git");
const URL = "https://github.com/me/mattstack-home.git";

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const fail = (code: number, stderr = ""): ExecResult => ({ code, stdout: "", stderr });

function neverCalled<T extends unknown[], R>(name: string) {
  return async (..._args: T): Promise<R> => {
    throw new Error(`unexpected call: ${name}`);
  };
}

/** A scripted git/gh: `origin` decides whether `remote get-url origin` finds one; every other call answers from `answers` by its first two words, else ok. */
function scripted(opts: { origin?: string; answers?: Record<string, ExecResult> } = {}) {
  return async (argv: string[]): Promise<ExecResult> => {
    if (argv[0] === "git" && argv.includes("get-url")) return opts.origin ? ok(opts.origin) : fail(2, "error: No such remote 'origin'");
    for (const [prefix, result] of Object.entries(opts.answers ?? {})) {
      if (argv.join(" ").startsWith(prefix)) return result;
    }
    return ok();
  };
}

function baseDeps(overrides: Partial<HomeRemoteDeps> & { probes?: Probes } = {}): HomeRemoteDeps & { lines: string[]; exitCodes: number[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() }),
    print: (s: string) => lines.push(s),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    stdin: neverCalled("stdin"),
    lines,
    exitCodes,
    ...overrides,
  };
}

async function expectExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    throw new Error("expected exit sentinel, function returned normally");
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "exit sentinel") throw err;
  }
}

function execCalls(probes: Probes): string[] {
  return (probes as unknown as { calls: { exec: string[][] } }).calls.exec.map((argv) => argv.join(" "));
}

function payload(deps: { lines: string[] }): Record<string, unknown> {
  return JSON.parse(deps.lines[0]!) as Record<string, unknown>;
}

describe("homeRemoteSet", () => {
  test("a URL argument on a local-only home repo adds origin, pushes, and reports both", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });

    await homeRemoteSet([URL, "--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    const calls = execCalls(probes);
    expect(calls).toContain(`git -C ${USER_REPO} remote add origin ${URL}`);
    expect(calls).toContain(`git -C ${USER_REPO} push -u origin HEAD`);
    expect(payload(deps)).toMatchObject({ url: URL, remote: "added", pushed: true, created: false });
  });

  test("an existing origin is updated, not added twice", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted({ origin: "https://old.example/x.git" }) });
    const deps = baseDeps({ probes });

    await homeRemoteSet([URL, "--json"], {}, deps);

    const calls = execCalls(probes);
    expect(calls).toContain(`git -C ${USER_REPO} remote set-url origin ${URL}`);
    expect(calls.some((c) => c.includes("remote add"))).toBe(false);
    expect(payload(deps)).toMatchObject({ remote: "updated" });
  });

  test("with no argument off a TTY, the URL comes from {\"url\"} on stdin", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes, stdin: async () => ({ url: URL }) });

    await homeRemoteSet(["--json"], {}, deps);

    expect(execCalls(probes)).toContain(`git -C ${USER_REPO} remote add origin ${URL}`);
    expect(payload(deps)).toMatchObject({ url: URL, pushed: true });
  });

  test("{\"alternative\":\"create\"} on stdin creates a private repo with gh, then sets that URL as origin", async () => {
    const created = "https://github.com/me/mattstack-home";
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ answers: { "gh repo create": ok(`${created}\n`) } }),
    });
    const deps = baseDeps({ probes, stdin: async () => ({ alternative: "create" }) });

    await homeRemoteSet(["--json"], {}, deps);

    const calls = execCalls(probes);
    expect(calls).toContain("gh repo create mattstack-home --private");
    expect(calls).toContain(`git -C ${USER_REPO} remote add origin ${created}.git`);
    expect(calls).toContain(`git -C ${USER_REPO} push -u origin HEAD`);
    expect(payload(deps)).toMatchObject({ url: `${created}.git`, created: true, pushed: true });
  });

  test("--create --name picks the repo name from the flag", async () => {
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ answers: { "gh repo create": ok("https://github.com/me/dotmattstack\n") } }),
    });
    const deps = baseDeps({ probes });

    await homeRemoteSet(["--create", "--name", "dotmattstack", "--json"], {}, deps);

    expect(execCalls(probes)).toContain("gh repo create dotmattstack --private");
    expect(deps.exitCodes).toEqual([]);
  });

  test("a gh failure is exit 2 create-failed and touches no remote", async () => {
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ answers: { "gh repo create": fail(4, "To get started with GitHub CLI, please run: gh auth login") } }),
    });
    const deps = baseDeps({ probes, stdin: async () => ({ alternative: "create" }) });

    await expectExit(() => homeRemoteSet(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(payload(deps)).toMatchObject({ error: { code: "create-failed" } });
    expect((payload(deps).error as { message: string }).message).toContain("gh auth login");
    expect(execCalls(probes).some((c) => c.includes("remote add"))).toBe(false);
  });

  test("something that is not a git URL is exit 2 bad-url before any git call", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet(["not a url", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(payload(deps)).toMatchObject({ error: { code: "bad-url" } });
    expect(execCalls(probes)).toEqual([]);
  });

  test("an ssh URL is accepted", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });

    await homeRemoteSet(["git@github.com:me/mattstack-home.git", "--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    expect(payload(deps)).toMatchObject({ url: "git@github.com:me/mattstack-home.git" });
  });

  test("a push that fails is exit 2 push-failed with git's reason, and the remote stays set", async () => {
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ answers: { [`git -C ${USER_REPO} push`]: fail(128, "remote: Permission denied") } }),
    });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet([URL, "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const err = payload(deps).error as { code: string; message: string };
    expect(err.code).toBe("push-failed");
    expect(err.message).toContain("Permission denied");
    expect(execCalls(probes)).toContain(`git -C ${USER_REPO} remote add origin ${URL}`);
  });

  test("no home repo yet is exit 2 no-home-repo", async () => {
    const probes = fakeProbes({ home: HOME, exec: scripted() });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet([URL, "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(payload(deps)).toMatchObject({ error: { code: "no-home-repo" } });
  });

  test("no argument on a TTY is a usage error, and stdin is never read", async () => {
    const deps = baseDeps({ isTTY: () => true });

    await expectExit(() => homeRemoteSet(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(payload(deps)).toMatchObject({ error: { code: "usage" } });
  });

  test("human output names the URL and the push", async () => {
    const deps = baseDeps();

    await homeRemoteSet([URL], {}, deps);

    expect(deps.lines[0]).toBe(`home remote set: origin -> ${URL}, pushed`);
  });
});
