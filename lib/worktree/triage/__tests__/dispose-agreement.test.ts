import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../../state/index.ts";
import { disposeTree } from "../../dispose.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../registry.ts";
import { collectFacts } from "../facts.ts";
import { triageRow, type TriageGroup } from "../verdict.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (c: string, cwd?: string) => execSync(c, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();
const repoName = "github.com/acme/app";

let repo: string;

function commit(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), `${file}\n`);
  sh(`git add -A && git ${GIT_ID} commit -q -m ${file}`, cwd);
  return sh("git rev-parse HEAD", cwd);
}

function tree(name: string): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b feat-${name} ${path} origin/main`);
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: "claimed", branch: `feat-${name}`, disposal: "merge", createdAt: "2026-09-20T00:00:00Z", claimedAt: "2026-09-20T00:00:00Z" };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}

type Mr = { iid: number; state: string; title: string; sha: string | null };
type Scenario = { name: string; group: TriageGroup; build: (rec: TreeRecord) => Mr | null };

const merged = (sha: string): Mr => ({ iid: 7, state: "merged", title: "t", sha });

const SCENARIOS: Scenario[] = [
  { name: "pushed branch", group: "safe", build: (rec) => {
    commit(rec.path, "a.txt");
    sh(`git push -q origin ${rec.branch}`, rec.path);
    return null;
  } },
  { name: "pushed branch with an uncommitted file", group: "look", build: (rec) => {
    commit(rec.path, "a.txt");
    sh(`git push -q origin ${rec.branch}`, rec.path);
    writeFileSync(join(rec.path, "notes.txt"), "wip\n");
    return null;
  } },
  { name: "unpushed branch", group: "only-copy", build: (rec) => {
    commit(rec.path, "a.txt");
    return null;
  } },
  { name: "squash-merged, branch never pushed", group: "safe", build: (rec) => merged(commit(rec.path, "a.txt")) },
  { name: "rebased before merge", group: "safe", build: (rec) => {
    commit(rec.path, "a.txt");
    commit(repo, "other.txt");
    sh(`git checkout -q -b rebased-${rec.name} && git ${GIT_ID} cherry-pick ${rec.branch} && git push -q origin HEAD:main && git checkout -q main && git fetch -q origin`, repo);
    return merged(sh(`git rev-parse rebased-${rec.name}`, repo));
  } },
  { name: "HEAD in a local branch named origin/main", group: "only-copy", build: (rec) => {
    commit(rec.path, "a.txt");
    sh(`git branch origin/main ${rec.branch}`, repo);
    return null;
  } },
  { name: "HEAD on main, branch holding an unpushed commit", group: "only-copy", build: (rec) => {
    commit(rec.path, "a.txt");
    sh("git checkout -q --detach origin/main", rec.path);
    return null;
  } },
  { name: "HEAD in the merged MR, branch holding a commit it lacks", group: "only-copy", build: (rec) => {
    const mrSha = commit(rec.path, "a.txt");
    commit(rec.path, "later.txt");
    sh(`git checkout -q --detach ${mrSha}`, rec.path);
    return merged(mrSha);
  } },
];

beforeEach(() => {
  process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtagree-home-")));
  closeStateDb();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rtagree-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rtagree-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
});

describe("triage offers dispose exactly where dispose's containment guard passes", () => {
  for (const s of SCENARIOS) {
    test(s.name, async () => {
      const rec = tree(s.name.replace(/[^a-z]+/gi, "-").toLowerCase());
      const mr = s.build(rec);
      const cacheEntries = mr ? { [rec.branch!]: { repoName, mr } } : {};

      const row = triageRow(await collectFacts(repoName, repo, rec, {
        cacheEntries, jobTreeHold: () => null, findRunningRun: () => ({ kind: "none" }), fetch: async () => false,
      }));
      const outcome = await disposeTree({
        repoName, repoPath: repo, cacheEntries, emit: () => {}, log: { info: () => {}, warn: () => {} },
        killProcesses: false, findRunningRun: () => ({ kind: "none" }),
      }, rec, { acceptDirty: s.group === "look" });

      expect(row.group).toBe(s.group);
      expect(outcome.disposed ? "disposed" : outcome.refusal).toBe(s.group === "only-copy" ? "unpushed" : "disposed");
    });
  }
});
