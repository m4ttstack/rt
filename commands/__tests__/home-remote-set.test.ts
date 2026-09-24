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

  test("a URL carrying a password is refused before any git call, and the secret is not echoed", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet(["https://me:ghp_secret123@github.com/me/x.git", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const err = payload(deps).error as { code: string; message: string };
    expect(err.code).toBe("bad-url");
    expect(err.message).not.toContain("ghp_secret123");
    expect(err.message).toContain("credential helper");
    expect(execCalls(probes)).toEqual([]);
  });

  test("scp-style remotes without a user and ssh-config aliases are accepted; a leading dash is not", async () => {
    for (const good of ["github.com:me/x.git", "gh:me/x.git", "ssh://git@github.com/me/x.git"]) {
      const deps = baseDeps();
      await homeRemoteSet([good, "--json"], {}, deps);
      expect(deps.exitCodes).toEqual([]);
    }
    const deps = baseDeps();
    await expectExit(() => homeRemoteSet(["-oProxyCommand=evil", "--json"], {}, deps));
    expect(payload(deps)).toMatchObject({ error: { code: "bad-url" } });
  });

  test("a failed push after updating an existing origin restores the old URL", async () => {
    const old = "https://old.example/x.git";
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ origin: old, answers: { [`git -C ${USER_REPO} push`]: fail(128, "remote: Permission denied") } }),
    });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet([URL, "--json"], {}, deps));

    const calls = execCalls(probes);
    expect(calls).toContain(`git -C ${USER_REPO} remote set-url origin ${URL}`);
    expect(calls[calls.length - 1]).toBe(`git -C ${USER_REPO} remote set-url origin ${old}`);
    const err = payload(deps).error as { code: string; message: string };
    expect(err.code).toBe("push-failed");
    expect(err.message).toContain("origin restored");
  });

  test("push output is redacted: a token in git's stderr never reaches the message", async () => {
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({ answers: { [`git -C ${USER_REPO} push`]: fail(128, "fatal: Authentication failed for 'https://x:ghp_leak456@github.com/me/x.git/'") } }),
    });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet([URL, "--json"], {}, deps));

    const err = payload(deps).error as { message: string };
    expect(err.message).not.toContain("ghp_leak456");
  });

  test("git never gets to prompt for credentials: push and gh run with GIT_TERMINAL_PROMPT=0", async () => {
    const seen: Record<string, string | undefined>[] = [];
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: async (argv, opts) => {
        if (argv.includes("push") || argv[0] === "gh") seen.push(opts?.env ?? {});
        return scripted({ answers: { "gh repo create": ok("https://github.com/me/mattstack-home\n") } })(argv);
      },
    });
    const deps = baseDeps({ probes, stdin: async () => ({ alternative: "create" }) });

    await homeRemoteSet(["--json"], {}, deps);

    expect(seen).toHaveLength(2);
    for (const env of seen) expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  test("--name x <url> keeps the URL as the positional; --create together with a URL is a usage error; a bad --name is refused", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });
    await homeRemoteSet(["--name", "x", URL, "--json"], {}, deps);
    expect(payload(deps)).toMatchObject({ url: URL });

    const both = baseDeps();
    await expectExit(() => homeRemoteSet(["--create", URL, "--json"], {}, both));
    expect(payload(both)).toMatchObject({ error: { code: "usage" } });

    const badName = baseDeps();
    await expectExit(() => homeRemoteSet(["--create", "--name", "--json"], {}, badName));
    expect(payload(badName)).toMatchObject({ error: { code: "usage" } });
    expect(execCalls(badName.probes)).toEqual([]);
  });

  test("a token-only https userinfo is a credential too, and is refused", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted() });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet(["https://ghp_tok789@github.com/me/x.git", "--json"], {}, deps));

    const err = payload(deps).error as { code: string; message: string };
    expect(err.code).toBe("bad-url");
    expect(err.message).not.toContain("ghp_tok789");
    expect(execCalls(probes)).toEqual([]);
  });

  test("when the push fails and restoring the old origin fails too, the message says so instead of claiming a restore", async () => {
    const old = "https://old.example/x.git";
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: scripted({
        origin: old,
        answers: {
          [`git -C ${USER_REPO} push`]: fail(128, "remote: Permission denied"),
          [`git -C ${USER_REPO} remote set-url origin ${old}`]: fail(1, "fatal: could not lock config file"),
        },
      }),
    });
    const deps = baseDeps({ probes });

    await expectExit(() => homeRemoteSet([URL, "--json"], {}, deps));

    const err = payload(deps).error as { code: string; message: string };
    expect(err.code).toBe("push-failed");
    expect(err.message).not.toContain("origin restored");
    expect(err.message).toContain("could not be restored");
  });

  test("a raw URL string on stdin (not JSON) is accepted", async () => {
    const deps = baseDeps({ stdin: async () => URL });

    await homeRemoteSet(["--json"], {}, deps);

    expect(payload(deps)).toMatchObject({ url: URL });
  });

  test("gh printing no URL is exit 2 create-failed", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: scripted({ answers: { "gh repo create": ok("done\n") } }) });
    const deps = baseDeps({ probes, stdin: async () => ({ alternative: "create" }) });

    await expectExit(() => homeRemoteSet(["--json"], {}, deps));

    expect(payload(deps)).toMatchObject({ error: { code: "create-failed" } });
  });
});
