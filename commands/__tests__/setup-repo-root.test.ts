import { afterAll, describe, test, expect } from "bun:test";
import { join } from "path";
import { setupRepoRootSet, type RepoRootDeps } from "../setup.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { readStagedRepoRoot } from "../../lib/setup/repo-root.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { setSetting } from "../../lib/settings/write.ts";
import type { Probes } from "../../lib/setup/probes.ts";

const HOME = "/fake-home";
const DIR = { isDirectory: true, writable: true };
const FILE = { isDirectory: false, writable: true };
const RO = { isDirectory: true, writable: false };
const GIT_DIR = join(HOME, ".mattstack", "user", ".git");

function neverCalled<T extends unknown[], R>(name: string) {
  return async (..._args: T): Promise<R> => {
    throw new Error(`unexpected call: ${name}`);
  };
}

function baseDeps(overrides: Partial<RepoRootDeps> & { probes?: Probes } = {}): RepoRootDeps & { lines: string[]; exitCodes: number[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({ home: HOME }),
    print: (s: string) => lines.push(s),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    stdin: neverCalled("stdin"),
    writeSetting: neverCalled("writeSetting"),
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

// This file's direct-write cases leave a real value in the shared per-process
// test store; reset so file ordering cannot couple a later reader to it.
afterAll(() => setSetting("rt.repoRoots", [], "machine"));

describe("setupRepoRootSet: no home repo yet (stage only)", () => {
  test("a valid directory stages the expanded path and writes no setting", async () => {
    const dev = join(HOME, "dev");
    const probes = fakeProbes({ home: HOME, statPaths: { [dev]: DIR } });
    const deps = baseDeps({ probes });

    await setupRepoRootSet([dev, "--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    expect(readStagedRepoRoot(probes)).toBe(dev);
    expect(getSetting<string[]>("rt.repoRoots").value).toEqual([]);
  });

  test("~/dev is staged expanded, not as ~/dev", async () => {
    const dev = join(HOME, "dev");
    const probes = fakeProbes({ home: HOME, statPaths: { [dev]: DIR } });
    const deps = baseDeps({ probes });

    await setupRepoRootSet(["~/dev", "--json"], {}, deps);

    expect(readStagedRepoRoot(probes)).toBe(dev);
  });

  test("staging twice replaces the first value rather than appending", async () => {
    const first = join(HOME, "dev");
    const second = join(HOME, "code");
    const probes = fakeProbes({ home: HOME, statPaths: { [first]: DIR, [second]: DIR } });
    const deps = baseDeps({ probes });

    await setupRepoRootSet([first, "--json"], {}, deps);
    await setupRepoRootSet([second, "--json"], {}, deps);

    expect(readStagedRepoRoot(probes)).toBe(second);
  });

  test("a nonexistent path stages nothing and raises the user-actionable error", async () => {
    const nope = join(HOME, "nope");
    const probes = fakeProbes({ home: HOME });
    const deps = baseDeps({ probes });

    await expectExit(() => setupRepoRootSet([nope, "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(readStagedRepoRoot(probes)).toBeNull();
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.message).toContain("does not exist");
  });

  test("a file is refused and stages nothing", async () => {
    const notes = join(HOME, "notes.txt");
    const probes = fakeProbes({ home: HOME, statPaths: { [notes]: FILE } });
    const deps = baseDeps({ probes });

    await expectExit(() => setupRepoRootSet([notes, "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(readStagedRepoRoot(probes)).toBeNull();
    const payload = JSON.parse(deps.lines[0]!) as { error: { message: string } };
    expect(payload.error.message).toContain("is not a directory");
  });

  test("an unwritable directory is refused and stages nothing", async () => {
    const locked = join(HOME, "locked");
    const probes = fakeProbes({ home: HOME, statPaths: { [locked]: RO } });
    const deps = baseDeps({ probes });

    await expectExit(() => setupRepoRootSet([locked, "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(readStagedRepoRoot(probes)).toBeNull();
    const payload = JSON.parse(deps.lines[0]!) as { error: { message: string } };
    expect(payload.error.message).toContain("is not writable");
  });
});

describe("setupRepoRootSet: home repo already initialised (write directly)", () => {
  test("the same call writes the store and stages nothing", async () => {
    const dev = join(HOME, "dev");
    const probes = fakeProbes({ home: HOME, statPaths: { [dev]: DIR }, dirs: { [GIT_DIR]: [] } });
    const written: [string, unknown, string][] = [];
    const deps = baseDeps({
      probes,
      writeSetting: ((key: string, value: unknown, scope: string) => {
        written.push([key, value, scope]);
      }) as unknown as RepoRootDeps["writeSetting"],
    });

    await setupRepoRootSet([dev, "--json"], {}, deps);

    expect(written).toEqual([["rt.repoRoots", [dev], "machine"]]);
    expect(readStagedRepoRoot(probes)).toBeNull();
  });

  test("a real write lands in getSetting, not merely a staged file", async () => {
    const dev = join(HOME, "dev");
    const probes = fakeProbes({ home: HOME, statPaths: { [dev]: DIR }, dirs: { [GIT_DIR]: [] } });
    const deps = baseDeps({ probes, writeSetting: setSetting });

    await setupRepoRootSet([dev, "--json"], {}, deps);

    expect(getSetting<string[]>("rt.repoRoots").value).toEqual([dev]);
    expect(readStagedRepoRoot(probes)).toBeNull();
  });

  // The tail entries are a supported hand-authored state, and this test exists
  // because a version of the preservation shipped untested: a swallowed
  // ReferenceError inside the read's try/catch made rest silently [] while
  // every other case stayed green.
  test("re-picking replaces only the primary root and preserves hand-added tail roots", async () => {
    const c = join(HOME, "c");
    setSetting("rt.repoRoots", [join(HOME, "a"), join(HOME, "b")], "machine");
    const probes = fakeProbes({ home: HOME, statPaths: { [c]: DIR }, dirs: { [GIT_DIR]: [] } });
    const deps = baseDeps({ probes, writeSetting: setSetting });

    await setupRepoRootSet([c, "--json"], {}, deps);

    expect(getSetting<string[]>("rt.repoRoots").value).toEqual([c, join(HOME, "b")]);
  });
});

describe("setupRepoRootSet: no-prompt argument/TTY/stdin ordering", () => {
  test("a TTY with no argument prints usage and does not read stdin", async () => {
    const deps = baseDeps({ isTTY: () => true, stdin: neverCalled("stdin") });

    await expectExit(() => setupRepoRootSet(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string } };
    expect(payload.error.code).toBe("usage");
  });

  test("a piped {root: ...} with no argument is accepted", async () => {
    const dev = join(HOME, "dev");
    const probes = fakeProbes({ home: HOME, statPaths: { [dev]: DIR } });
    const deps = baseDeps({ probes, isTTY: () => false, stdin: async () => ({ root: dev }) });

    await setupRepoRootSet(["--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    expect(readStagedRepoRoot(probes)).toBe(dev);
  });

  test("empty stdin with no argument, not a TTY, raises a usage/bad-stdin error rather than hanging or prompting", async () => {
    const deps = baseDeps({ isTTY: () => false, stdin: async () => null });

    await expectExit(() => setupRepoRootSet(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });
});
