import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { closeStateDb } from "../../state/index.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createWorktreeTriageHandlers } from "../handlers/worktree-triage.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { fakeStore } from "./fake-cache-store.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (c: string, cwd?: string) => execSync(c, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();
const repoName = "github.com/acme/app";

let repo: string;
function tree(name: string): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b feat-${name} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "w\n");
  sh(`git add -A && git ${GIT_ID} commit -q -m w`, path);
  sh(`git push -q origin feat-${name}`, path);
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: "claimed", branch: `feat-${name}`, disposal: "merge", createdAt: "2026-09-20T00:00:00Z", claimedAt: "2026-09-20T00:00:00Z" };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}

beforeEach(() => {
  process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-handlers-home-")));
  closeStateDb();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rttriage-handlers-")));
  sh(`git init -q -b main ${repo}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, repo);
  const bare = mkdtempSync(join(tmpdir(), "rttriage-handlers-bare-"));
  sh(`git clone -q --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch -q origin`);
});

describe("createWorktreeTriageHandlers", () => {
  test("worktree:triage returns rows, counts and banners", async () => {
    const rec = tree("alpha");
    const entries = { [`feat-${rec.name}`]: { repoName, mr: { iid: 7, state: "merged", title: "T alpha", sha: null } } };
    const ctx: Pick<HandlerContext, "repoIndex" | "cache" | "log"> = {
      repoIndex: () => ({ [repoName]: repo }),
      cache: fakeStore(entries as any),
      log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} } as unknown as Logger,
    };
    const handlers = createWorktreeTriageHandlers(ctx, {
      findRunningRunByWorktree: () => ({ kind: "none" }),
      jobTreeHold: () => null,
      kick: () => {},
      emit: () => {},
    });

    const res = await (handlers["worktree:triage"] as any)({});
    expect(res.ok).toBe(true);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.counts.needsDecision).toBe(1);
    expect(Array.isArray(res.data.banners)).toBe(true);
  });
});
