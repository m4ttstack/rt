import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import type { Logger } from "pino";
import { writeJson } from "../../../json-store.ts";
import { machineSettingsPath, rtDir } from "../../../rt-paths.ts";
import { deriveRepoIdentity } from "../../../settings/identity.ts";
import { closeStateDb } from "../../../state/index.ts";
import { createTree } from "../../../worktree/create.ts";
import { headSha } from "../../../worktree/git-async.ts";
import { loadRegistry, saveRegistry } from "../../../worktree/registry.ts";
import { freshenRepo } from "../freshen.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";

function sh(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" });
}

function fakeLog(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtfreshen-")));
  sh("git init -b main && git -c user.email=t@t -c user.name=t commit --allow-empty -m init", dir);
  return dir;
}

function addBareOrigin(repo: string): void {
  const bare = mkdtempSync(join(tmpdir(), "rtfreshen-bare-"));
  sh(`git clone --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch origin`);
}

function cloneOrigin(repo: string): string {
  const originUrl = execSync(`git -C ${repo} remote get-url origin`, { encoding: "utf8" }).trim();
  const clone = realpathSync(mkdtempSync(join(tmpdir(), "rtfreshen-clone-")));
  sh(`git clone -q ${originUrl} ${clone}`);
  return clone;
}

function pushFile(clone: string, relPath: string, contents: string): string {
  writeFileSync(join(clone, relPath), contents);
  sh(`git add -A && git ${GIT_ID} commit -m ${relPath}`, clone);
  sh(`git push -q origin main`, clone);
  return execSync("git rev-parse HEAD", { cwd: clone, encoding: "utf8" }).trim();
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

// A team-authored `ready` ladder is gated behind ready-approve; declaring it
// in the machine store (rather than the repo config) is the user/machine
// rung, which evaluateReadyGate does not hold.
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

describe("freshen.ts: freshenRepo", () => {
  const repoName = "acme";
  let repo: string;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtfreshen-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    writeJson(join(rtDir(), "worktrees.json"), { enabled: true, killProcesses: false });
  });

  test("idle main behind origin gets ff'd; worktree:freshened emitted", async () => {
    saveRegistry(repoName, [
      { name: basename(repo), path: repo, kind: "main", branch: "main", createdAt: new Date().toISOString() },
    ]);

    const clone = cloneOrigin(repo);
    const sha1 = pushFile(clone, "feature.txt", "hi\n");

    const events: Array<{ type: string; data: unknown }> = [];
    const ran = await freshenRepo({
      repoName,
      repoPath: repo,
      emit: (type: string, data: unknown) => events.push({ type, data }),
      log: fakeLog(),
    });

    expect(ran).toContain(basename(repo));
    expect(await headSha(repo)).toBe(sha1);
    expect(events.some((e) => e.type === "worktree:freshened")).toBe(true);
  });

  test("dirty non-idle main is left untouched", async () => {
    writeFileSync(join(repo, "dirty.txt"), "uncommitted\n");
    saveRegistry(repoName, [
      { name: basename(repo), path: repo, kind: "main", branch: "main", createdAt: new Date().toISOString() },
    ]);

    const beforeSha = await headSha(repo);
    const ran = await freshenRepo({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() });

    expect(ran).toEqual([]);
    expect(await headSha(repo)).toBe(beforeSha);
    expect(existsSync(join(repo, "dirty.txt"))).toBe(true);
    const rec = loadRegistry(repoName).find((t) => t.path === repo)!;
    expect(rec.readyAt).toBeUndefined();
  });

  test("golden is a candidate and is freshened before members", async () => {
    // A `changed:` step whose glob the bump touches: freshenOne only advances
    // readyStamp when at least one step actually ran (toRun.length > 0), so an
    // empty ladder would leave every stamp untouched and prove nothing.
    await declareWorktrees(repo, repoName, {
      onDeck: 1,
      root: join(repo, ".worktrees"),
      ready: [{ run: "touch .freshened", when: "changed:tracked.txt" }],
    });
    // Member created before the golden, so the registry's natural (creation)
    // order is [member, golden]: ran[0] === "golden" can only pass if
    // freshenRepo's sort actually reorders it.
    const m = await createTree({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() as never });
    const g = await createTree({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() as never, target: "golden" });
    if (!g.ok || !m.ok) throw new Error("setup");
    writeFileSync(join(repo, "tracked.txt"), "bump\n");
    execSync("git add tracked.txt && git -c user.email=t@t -c user.name=t commit -qm bump && git push -q origin HEAD", { cwd: repo, shell: "/bin/zsh" });
    const newSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();

    const ran = await freshenRepo({ repoName, repoPath: repo, emit: () => {}, log: fakeLog() });

    expect(ran[0]).toBe("golden");
    expect(ran).toContain(m.tree.name);
    const after = loadRegistry(repoName);
    expect(after.find((t) => t.kind === "golden")?.readyStamp).toBe(newSha);
    expect(after.find((t) => t.name === m.tree.name)?.readyStamp).toBe(newSha);
    expect(existsSync(join(g.tree.path, ".freshened"))).toBe(true);
  });
});
