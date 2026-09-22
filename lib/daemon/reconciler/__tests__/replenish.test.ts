import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { closeStateDb } from "../../../state/index.ts";
import { machineSettingsPath, goldenRoot } from "../../../rt-paths.ts";
import { deriveRepoIdentity } from "../../../settings/identity.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../../worktree/registry.ts";
import { tryLockTree } from "../../../worktree/locks.ts";
import type { WorktreeAppConfig } from "../../../worktree/config.ts";
import { clonePath, cloneExitCode } from "../../../worktree/clonefile.ts";
import type { CloneRunner } from "../../../worktree/hydrate.ts";
import {
  withCreateLock,
  poolCounts,
  hasFreeDiskGb,
  replenishAndShrink,
  createBackoff,
  chooseCreateMode,
  findGolden,
} from "../replenish.ts";

function onDeckEntry(path: string, overrides: Partial<TreeRecord> = {}): TreeRecord {
  return {
    name: path,
    path,
    kind: "ephemeral",
    state: "on-deck",
    branch: "feature",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeLog(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
}

function fakeAppConfig(overrides: Partial<WorktreeAppConfig> = {}): WorktreeAppConfig {
  return { enabled: true, killProcesses: false, ...overrides };
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtreplenish-repo-")));
  execSync(
    "git init -b main && git -c user.email=t@t -c user.name=t commit --allow-empty -m init",
    { cwd: dir, shell: "/bin/zsh" },
  );
  return dir;
}

function addBareOrigin(repo: string): void {
  const bare = mkdtempSync(join(tmpdir(), "rtreplenish-bare-"));
  execSync(
    `git clone --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch origin`,
    { shell: "/bin/zsh" },
  );
}

function readMachineStore(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(machineSettingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeMachineStore(obj: Record<string, unknown>): void {
  mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
  writeFileSync(machineSettingsPath(), JSON.stringify(obj));
}

async function declareWorktrees(repoPath: string, repoName: string, declared: unknown): Promise<void> {
  let remote: string | null = null;
  try {
    remote = execSync("git config --get remote.origin.url", { cwd: repoPath, encoding: "utf8" }).trim() || null;
  } catch { /* no origin yet */ }
  if (!remote) {
    remote = `git@rttest:${repoName}.git`;
    execSync(`git remote add origin ${remote}`, { cwd: repoPath, shell: "/bin/zsh" });
  }
  let identity: string;
  const direct = await deriveRepoIdentity(repoPath);
  if (direct.kind === "remote") {
    identity = direct.id;
  } else {
    identity = `rttest.local/${repoName}`;
    const store = readMachineStore();
    const overrides = { ...(store["rt.repoIdentityOverrides"] as Record<string, string> ?? {}), [remote]: identity };
    writeMachineStore({ ...store, "rt.repoIdentityOverrides": overrides });
  }
  const store = readMachineStore();
  const repos = { ...(store.repos as Record<string, unknown> ?? {}), [identity]: { "rt.worktrees": declared } };
  writeMachineStore({ ...store, repos });
}

describe("replenish.ts: withCreateLock", () => {
  test("serializes concurrent calls for the same repoPath: never two holders at once", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const run = (id: string) => withCreateLock("/repo/a", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${id}`);
      active--;
    });
    await Promise.all([run("1"), run("2"), run("3")]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
  });

  test("different repoPaths are not serialized against each other", async () => {
    let active = 0;
    let maxActive = 0;
    const run = (path: string) => withCreateLock(path, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    await Promise.all([run("/repo/b"), run("/repo/c")]);
    expect(maxActive).toBe(2);
  });

  test("a holder that throws still releases the lock for the next caller", async () => {
    await expect(withCreateLock("/repo/d", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    let ran = false;
    await withCreateLock("/repo/d", async () => { ran = true; });
    expect(ran).toBe(true);
  });
});

describe("replenish.ts: poolCounts", () => {
  const repoName = "acme";
  let priorHome: string | undefined;

  beforeEach(() => {
    priorHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtreplenish-home-")));
    closeStateDb();
  });
  afterEach(() => {
    closeStateDb();
    if (priorHome !== undefined) process.env.HOME = priorHome;
  });

  test("counts on-deck and creating entries, ready gated on nextRetryAt", () => {
    saveRegistry(repoName, [
      onDeckEntry("/t/a"),
      onDeckEntry("/t/b", { nextRetryAt: new Date(Date.now() + 60_000).toISOString() }),
      onDeckEntry("/t/c", { state: "creating" }),
      onDeckEntry("/t/claimed", { state: "claimed" }),
    ]);

    const counts = poolCounts(repoName);
    expect(counts.ready).toBe(1);
    expect(counts.totalUnclaimed).toBe(3);
    expect(counts.onDeckEntries.map((t) => t.path).sort()).toEqual(["/t/a", "/t/b"]);
  });
});

describe("replenish.ts: hasFreeDiskGb", () => {
  test("a probe failure on an unresolvable path degrades to true", async () => {
    expect(await hasFreeDiskGb("/no/such/path/at/all", 5)).toBe(true);
  });
});

describe("replenish.ts: per-instance backoff", () => {
  const repoName = "acme";
  let repo: string;
  let priorHome: string | undefined;

  beforeEach(() => {
    priorHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtbackoff-home-")));
    closeStateDb();
    createBackoff.clear();
    repo = makeRepo();
    addBareOrigin(repo);
  });
  afterEach(() => {
    closeStateDb();
    if (priorHome !== undefined) process.env.HOME = priorHome;
  });

  test("a create failure lands on the backoff map threaded via deps.backoff, not the module-scope default", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [{ run: "exit 1" }] });
    const instanceBackoff = new Map<string, { failures: number; nextRetryAt: string }>();

    await replenishAndShrink(
      { repoName, repoPath: repo, emit: () => {}, log: fakeLog(), backoff: instanceBackoff, findRunningRun: () => ({ kind: "none" }) },
      new Map(),
      fakeAppConfig(),
    );

    expect(instanceBackoff.get(repoName)?.failures).toBe(1);
    // The module-scope default two instances would otherwise share stays clean.
    expect(createBackoff.has(repoName)).toBe(false);
  });

  test("two instances' backoff maps are independent: one's active backoff does not gate the other", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [{ run: "exit 1" }] });
    const a = new Map<string, { failures: number; nextRetryAt: string }>();
    const b = new Map<string, { failures: number; nextRetryAt: string }>();
    const deps = { repoName, repoPath: repo, emit: () => {}, log: fakeLog(), findRunningRun: () => ({ kind: "none" as const }) };

    await replenishAndShrink({ ...deps, backoff: a }, new Map(), fakeAppConfig());
    // A now holds an active backoff deadline. A shared map would make B skip its
    // create; independent maps let B attempt and charge its own failure.
    await replenishAndShrink({ ...deps, backoff: b }, new Map(), fakeAppConfig());

    expect(Date.parse(a.get(repoName)!.nextRetryAt)).toBeGreaterThan(Date.now());
    expect(a.get(repoName)?.failures).toBe(1);
    expect(b.get(repoName)?.failures).toBe(1);
  });
});

const inProcessClone: CloneRunner = async (src, dst) => {
  const r = clonePath(src, dst);
  return { exitCode: cloneExitCode(r), stderr: r.ok ? "" : `clonefile: ${r.message}` };
};

describe("replenish.ts: chooseCreateMode", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const same = () => true;
  const golden: TreeRecord = { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: "golden", createdAt: "2026-09-01T00:00:00.000Z", readyStamp: "abc", readyAt: "2026-09-01T00:10:00.000Z" };

  test("ready golden on the same volume hydrates", () => {
    expect(chooseCreateMode([golden], "/pool", now, same)).toEqual({ mode: "hydrate", golden });
  });
  test("no golden is cold", () => {
    expect(chooseCreateMode([], "/pool", now, same)).toEqual({ mode: "cold", why: "no golden" });
  });
  test("creating golden is cold", () => {
    expect(chooseCreateMode([{ ...golden, state: "creating" }], "/pool", now, same).mode).toBe("cold");
  });
  test("golden in backoff is cold", () => {
    expect(chooseCreateMode([{ ...golden, nextRetryAt: "2026-09-21T13:00:00.000Z" }], "/pool", now, same).mode).toBe("cold");
  });
  test("golden without readyStamp is cold", () => {
    expect(chooseCreateMode([{ ...golden, readyStamp: undefined }], "/pool", now, same).mode).toBe("cold");
  });
  test("a golden with recorded failures is cold even with no live backoff deadline", () => {
    expect(chooseCreateMode([{ ...golden, retryFailures: 1 }], "/pool", now, same).mode).toBe("cold");
  });
  test("different volume is cold", () => {
    expect(chooseCreateMode([golden], "/pool", now, () => false)).toEqual({ mode: "cold", why: "golden and pool root are on different volumes" });
  });
});

describe("replenish.ts: golden lifecycle", () => {
  const repoName = "acme";
  let repo: string;
  let priorHome: string | undefined;

  beforeEach(() => {
    priorHome = process.env.HOME;
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtgolden-home-")));
    closeStateDb();
    createBackoff.clear();
    repo = makeRepo();
    addBareOrigin(repo);
  });
  afterEach(() => {
    closeStateDb();
    if (priorHome !== undefined) process.env.HOME = priorHome;
  });

  type Created = { tree: string; kind?: string; hydratedFrom?: string };

  function deps(clone: CloneRunner = inProcessClone, created: Created[] = []) {
    return {
      repoName,
      repoPath: repo,
      emit: (type: string, data: unknown) => {
        if (type === "worktree:created") created.push(data as Created);
      },
      log: fakeLog(),
      findRunningRun: () => ({ kind: "none" as const }),
      clone,
    };
  }

  test("the first pass tops members up before it builds the golden", async () => {
    // Ordering, not timing: the golden's build is a full cold create holding
    // the repo's create lock, and a provision queued on that same lock gives
    // up at its own timeout. Anything the pass does after the golden waits
    // behind it, so member top-up must come first.
    await declareWorktrees(repo, repoName, { onDeck: 2, root: join(repo, ".worktrees"), ready: [] });
    const created: Created[] = [];
    await replenishAndShrink(deps(inProcessClone, created), new Map(), fakeAppConfig());

    expect(created.map((c) => c.kind)).toEqual(["ephemeral", "ephemeral", "golden"]);
    // No golden existed while the members were built, so both are cold.
    expect(created.filter((c) => c.hydratedFrom)).toHaveLength(0);

    const trees = loadRegistry(repoName);
    expect(findGolden(trees)?.state).toBe("on-deck");
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(2);
  });

  test("a later pass fills the pool by hydration from the golden", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    const golden = findGolden(loadRegistry(repoName))!;
    expect(golden.readyStamp).toBeTruthy();

    // `hydratedFrom` on the event, not the stamps on the row: with `ready: []`
    // a cold create lands on the same commit and so the same readyStamp, and
    // only the emitting call site tells the two builds apart.
    await declareWorktrees(repo, repoName, { onDeck: 2, root: join(repo, ".worktrees"), ready: [] });
    const created: Created[] = [];
    await replenishAndShrink(deps(inProcessClone, created), new Map(), fakeAppConfig());

    expect(created).toHaveLength(1);
    expect(created[0]!.hydratedFrom).toBe(golden.name);
    const members = loadRegistry(repoName).filter((t) => t.kind === "ephemeral" && t.state === "on-deck");
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m.readyStamp).toBe(golden.readyStamp);
    }
  });

  test("a pass with nothing to build never creates cfg.root", async () => {
    // Nothing for this pass to do: a placeholder golden row (any row
    // satisfies findGolden, so the ensure-golden build is skipped) and a
    // pool already at onDeck (so the member loop is never entered). If the
    // volume probe ever materialized cfg.root as a side effect, it would be
    // the only thing in this pass able to create it: ensure-golden touches
    // goldenRoot, a different path, and the member loop never runs.
    const cfgRoot = join(repo, ".worktrees");
    await declareWorktrees(repo, repoName, { onDeck: 1, root: cfgRoot, ready: [] });
    saveRegistry(repoName, [
      { name: "golden", path: goldenRoot(repoName), kind: "golden", state: "on-deck", branch: "golden", createdAt: new Date().toISOString() },
      { name: "existing", path: join(cfgRoot, "existing"), kind: "ephemeral", state: "on-deck", branch: "on-deck/existing", createdAt: new Date().toISOString() },
    ]);
    expect(existsSync(cfgRoot)).toBe(false);

    await replenishAndShrink(deps(), new Map(), fakeAppConfig());

    expect(existsSync(cfgRoot)).toBe(false);
  });

  test("hydration still chooses correctly when cfg.root does not exist yet", async () => {
    const cfgRoot = join(repo, ".worktrees");
    // A single-entry namePool makes hydrateTree's own path deterministic,
    // so the pre-lock below targets exactly the path it will try.
    await declareWorktrees(repo, repoName, { onDeck: 1, root: cfgRoot, ready: [], namePool: ["fixedname"] });
    expect(existsSync(cfgRoot)).toBe(false);

    // A successful hydrate's own `git worktree add` would create cfg.root
    // as a side effect, which would make a post-pass existsSync check pass
    // for the wrong reason (git created it, not the probe). Pre-locking the
    // member's path blocks hydrateTree's git worktree add without touching
    // chooseCreateMode's decision above it, which is what this test needs
    // to isolate: the volume probe itself never creates cfg.root, even when
    // it runs for real against a healthy golden and picks hydrate.
    const release = tryLockTree(join(cfgRoot, "fixedname"));
    try {
      // Two passes: the first has no golden yet, so it never consults the
      // volume probe at all. The second does, against a real golden, which
      // is the pass this test is about.
      await replenishAndShrink(deps(), new Map(), fakeAppConfig());
      expect(findGolden(loadRegistry(repoName))?.readyStamp).toBeTruthy();
      await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    } finally {
      release?.();
    }

    expect(existsSync(cfgRoot)).toBe(false);
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)?.readyStamp).toBeTruthy();
    expect(trees.find((t) => t.kind === "ephemeral" && t.state === "on-deck")).toBeUndefined();
  });

  test("a golden create failure backs off and members still cold-create", async () => {
    // createTree keys the golden path off the repoName it is handed, verbatim,
    // so the gate script must be built from that same call, not from a
    // re-derived identity.
    const gRoot = goldenRoot(repoName);
    await declareWorktrees(repo, repoName, {
      onDeck: 1,
      root: join(repo, ".worktrees"),
      ready: [{ run: `case "$PWD" in ${gRoot}*) exit 1;; *) exit 0;; esac` }],
    });
    const backoff = new Map<string, { failures: number; nextRetryAt: string }>();
    await replenishAndShrink({ ...deps(), backoff }, new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)).toBeUndefined();
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
    expect(backoff.get(`${repoName}#golden`)?.failures).toBe(1);
  });

  /**
   * A golden with something to clone, plus one member, as the second pass of
   * these fallback tests needs them. Without a git-ignored artifact in the
   * donor there is nothing for a clone runner to be asked about, and a
   * failing runner would never be called at all.
   */
  async function passOneWithArtifact(): Promise<TreeRecord> {
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    execSync(
      "git add .gitignore && git -c user.email=t@t -c user.name=t commit -qm ignore && git push -q origin HEAD",
      { cwd: repo, shell: "/bin/zsh" },
    );
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    const golden = findGolden(loadRegistry(repoName))!;
    mkdirSync(join(golden.path, "node_modules"), { recursive: true });
    writeFileSync(join(golden.path, "node_modules", "a.js"), "module.exports = 1;\n");
    await declareWorktrees(repo, repoName, { onDeck: 2, root: join(repo, ".worktrees"), ready: [] });
    return golden;
  }

  test("a clone exit that maps to hydrate-unavailable falls back to cold create", async () => {
    await passOneWithArtifact();
    let calls = 0;
    const exdev: CloneRunner = async () => { calls++; return { exitCode: 3, stderr: "clonefile: Cross-device link" }; };
    const created: Created[] = [];
    await replenishAndShrink(deps(exdev, created), new Map(), fakeAppConfig());

    expect(calls).toBeGreaterThan(0);
    expect(created).toHaveLength(1);
    expect(created[0]!.hydratedFrom).toBeUndefined();
    expect(loadRegistry(repoName).filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(2);
  });

  test("a hydrate failure that is not 'unavailable' falls back too, and charges no backoff", async () => {
    // Exit 5 (EEXIST) is the reachable one: a path ignored at the golden's
    // HEAD but tracked at its readyStamp is already on disk in the member.
    await passOneWithArtifact();
    const eexist: CloneRunner = async () => ({ exitCode: 5, stderr: "clonefile: File exists" });
    const backoff = new Map<string, { failures: number; nextRetryAt: string }>();
    const created: Created[] = [];
    await replenishAndShrink({ ...deps(eexist, created), backoff }, new Map(), fakeAppConfig());

    expect(created).toHaveLength(1);
    expect(created[0]!.hydratedFrom).toBeUndefined();
    expect(loadRegistry(repoName).filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(2);
    expect(backoff.has(repoName)).toBe(false);
  });

  test("the member backoff is charged only when the cold-create fallback fails too", async () => {
    const golden = await passOneWithArtifact();
    // A ready step only a cold create ever runs: hydration inherits the
    // golden's stamp and runs no ladder, so the sentinel is proof the
    // fallback happened rather than the hydrate failure ending the attempt.
    const sentinel = join(repo, "cold-create-ran");
    await declareWorktrees(repo, repoName, {
      onDeck: 2,
      root: join(repo, ".worktrees"),
      ready: [{ run: `touch ${sentinel}; exit 1` }],
    });
    const boom: CloneRunner = async () => ({ exitCode: 1, stderr: "clonefile: Input/output error" });
    const backoff = new Map<string, { failures: number; nextRetryAt: string }>();
    await replenishAndShrink({ ...deps(boom), backoff }, new Map(), fakeAppConfig());

    expect(existsSync(sentinel)).toBe(true);
    // One charge for the attempt, not one per build it tried.
    expect(backoff.get(repoName)?.failures).toBe(1);
    expect(loadRegistry(repoName).filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
    expect(findGolden(loadRegistry(repoName))?.path).toBe(golden.path);
  });

  test("onDeck 0 scraps the golden and nothing else", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    expect(findGolden(loadRegistry(repoName))).toBeDefined();
    await declareWorktrees(repo, repoName, { onDeck: 0, root: join(repo, ".worktrees"), ready: [] });
    await replenishAndShrink(deps(), new Map(), fakeAppConfig());
    const trees = loadRegistry(repoName);
    expect(findGolden(trees)).toBeUndefined();
    expect(trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck")).toHaveLength(1);
  });
});
