import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../../state/index.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../registry.ts";
import { collectFacts, isStuck, linkedGitdir, triageRepo, type TriageDeps } from "../facts.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (c: string, cwd?: string) => execSync(c, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();
const repoName = "github.com/acme/app";

let repo: string;
function tree(name: string, opts: { push?: boolean; state?: "claimed" | "disposable"; reason?: string } = {}): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b feat-${name} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "w\n");
  sh(`git add -A && git ${GIT_ID} commit -q -m w`, path);
  if (opts.push !== false) sh(`git push -q origin feat-${name}`, path);
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: opts.state ?? "claimed", branch: `feat-${name}`, disposal: "merge", createdAt: "2026-09-20T00:00:00Z", claimedAt: "2026-09-20T00:00:00Z", ...(opts.reason ? { disposableReason: opts.reason } : {}) };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}
const deps = (entries: Record<string, any> = {}): TriageDeps => ({
  cacheEntries: entries, jobTreeHold: () => null, findRunningRun: () => ({ kind: "none" }), fetch: async () => false,
});
const merged = (name: string, extra: object = {}) => ({ [`feat-${name}`]: { repoName, mr: { iid: 7, state: "merged", title: `T ${name}`, sha: null, ...extra } } });

beforeEach(() => {
  process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-home-")));
  closeStateDb();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rttriage-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
});

describe("isStuck", () => {
  const rec = { kind: "ephemeral", state: "claimed" } as TreeRecord;
  test("claimed with merged/closed MR, any disposable, or broken", () => {
    expect(isStuck(rec, "merged", false)).toBe(true);
    expect(isStuck(rec, "closed", false)).toBe(true);
    expect(isStuck(rec, "opened", false)).toBe(false);
    expect(isStuck(rec, null, false)).toBe(false);
    expect(isStuck({ ...rec, state: "disposable" }, null, false)).toBe(true);
    expect(isStuck(rec, null, true)).toBe(true);
    expect(isStuck({ ...rec, kind: "main" }, "merged", false)).toBe(false);
  });

  test("a creating or on-deck tree is never stuck, even when it reads as broken", () => {
    expect(isStuck({ ...rec, state: "creating" }, null, true)).toBe(false);
    expect(isStuck({ ...rec, state: "on-deck" }, "merged", true)).toBe(false);
  });
});

describe("collectFacts", () => {
  test("a pushed merged tree with a screenshot folder: on-remote, junk, MR joined", async () => {
    const rec = tree("alpha");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "a.png"), "x");
    const f = await collectFacts(repoName, repo, rec, deps(merged("alpha")));
    expect([f.containment, f.dirt.kind, f.mr?.title, f.broken]).toEqual(["on-remote", "junk", "T alpha", null]);
  });

  test("an unpushed tree reports how far ahead it is", async () => {
    const rec = tree("bravo", { push: false });
    const f = await collectFacts(repoName, repo, rec, deps(merged("bravo")));
    expect([f.containment, f.remoteBranchExists, f.ahead]).toEqual(["none", false, 1]);
  });

  test("ahead counts against the remote default branch, never a local branch named origin/main", async () => {
    const rec = tree("delta", { push: false });
    sh("git branch origin/main feat-delta", repo);
    const f = await collectFacts(repoName, repo, rec, deps());
    expect([f.containment, f.ahead]).toEqual(["none", 1]);
  });

  test("a tree whose directory vanished is broken", async () => {
    const rec = tree("charlie");
    rmSync(rec.path, { recursive: true, force: true });
    expect((await collectFacts(repoName, repo, rec, deps(merged("charlie")))).broken).toBe("gone");
  });

  test("a tree whose gitdir vanished but whose folder remains is unlinked, not gone", async () => {
    const rec = tree("charlie2");
    rmSync(join(repo, ".git", "worktrees", "charlie2"), { recursive: true, force: true });
    expect((await collectFacts(repoName, repo, rec, deps(merged("charlie2")))).broken).toBe("unlinked");
  });

  test("a relative gitdir (worktree.useRelativePaths) resolves against the tree, not the cwd", async () => {
    const rec = tree("charlie3");
    writeFileSync(join(rec.path, ".git"), "gitdir: ../../.git/worktrees/charlie3\n");
    const f = await collectFacts(repoName, repo, rec, deps(merged("charlie3")));
    expect(f.broken).toBeNull();
    expect(linkedGitdir(rec.path)).toBe(join(repo, ".git", "worktrees", "charlie3"));
  });

  test("an unreadable run scan holds the tree as waiting on the run", async () => {
    const rec = tree("delta2");
    const f = await collectFacts(repoName, repo, rec, { ...deps(merged("delta2")), findRunningRun: () => ({ kind: "incomplete" }) });
    expect(f.hold).toEqual({ kind: "run", detail: "run state unreadable" });
  });

  test("a held tree carries its hold: reactor held reason, then herd, then live run", async () => {
    const rec = tree("delta");
    saveRegistry(repoName, loadRegistry(repoName).map((t) => (t.path === rec.path ? { ...t, heldReason: "pid 7 (vim) has its cwd inside" } : t)));
    const f1 = await collectFacts(repoName, repo, { ...rec, heldReason: "pid 7 (vim) has its cwd inside" }, deps(merged("delta")));
    expect(f1.hold).toEqual({ kind: "process", detail: "pid 7 (vim) has its cwd inside" });
    const jobRec = { ...rec, disposal: "job" as const, owner: "herd:h1" };
    const f2 = await collectFacts(repoName, repo, jobRec, { ...deps(merged("delta")), jobTreeHold: () => "herd job h1/delta is at-gate" });
    expect(f2.hold).toEqual({ kind: "herd", detail: "herd job h1/delta is at-gate" });
    const f3 = await collectFacts(repoName, repo, rec, { ...deps(merged("delta")), findRunningRun: () => ({ kind: "match", run: { id: "r1", currentStage: "implement" } }) as any });
    expect(f3.hold).toEqual({ kind: "run", detail: "pipeline run r1 is live at implement" });
  });
});

describe("triageRepo", () => {
  test("lists only stuck trees", async () => {
    tree("echo");
    tree("foxtrot");
    const rows = await triageRepo(repoName, repo, deps(merged("echo")));
    expect(rows.map((r) => r.tree)).toEqual(["echo"]);
  });

  test("one tree with an unreadable .git is left out with one warning; the rest of the repo still lists", async () => {
    const bad = tree("golf");
    tree("hotel");
    chmodSync(join(bad.path, ".git"), 0o000);
    const warnings: object[] = [];
    try {
      const rows = await triageRepo(repoName, repo, { ...deps({ ...merged("golf"), ...merged("hotel") }), log: { warn: (o) => { warnings.push(o); } } });
      expect(rows.map((r) => r.tree)).toEqual(["hotel"]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ tree: "golf" });
    } finally {
      chmodSync(join(bad.path, ".git"), 0o644);
    }
  });
});
