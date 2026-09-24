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
function tree(name: string, opts: { push?: boolean } = {}): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b feat-${name} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "w\n");
  sh(`git add -A && git ${GIT_ID} commit -q -m w`, path);
  if (opts.push !== false) sh(`git push -q origin feat-${name}`, path);
  const rec: TreeRecord = { name, path, kind: "ephemeral", state: "claimed", branch: `feat-${name}`, disposal: "merge", createdAt: "2026-09-20T00:00:00Z", claimedAt: "2026-09-20T00:00:00Z" };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}

function buildHandlers(entries: Record<string, unknown>) {
  const ctx: Pick<HandlerContext, "repoIndex" | "cache" | "log"> = {
    repoIndex: () => ({ [repoName]: repo }),
    cache: fakeStore(entries as any),
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} } as unknown as Logger,
  };
  return createWorktreeTriageHandlers(ctx, {
    findRunningRunByWorktree: () => ({ kind: "none" }),
    jobTreeHold: () => null,
    kick: () => {},
    emit: () => {},
  });
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
    const handlers = buildHandlers(entries);

    const res = await (handlers["worktree:triage"] as any)({});
    expect(res.ok).toBe(true);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.counts.needsDecision).toBe(1);
    expect(Array.isArray(res.data.banners)).toBe(true);
  });

  test("never touches the network: an unfetchable MR sha against a black-hole origin still returns promptly, as only-copy", async () => {
    // A raw TCP listener that accepts but never answers: `git fetch` against
    // it blocks on the read, only returning at containment.ts's own 60s
    // subprocess-kill timeout. This is what deps().fetch must never reach
    // for real -- a renamed-away or otherwise absent origin fails fast
    // either way, which proves nothing about whether the network path ran.
    const blackHole = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open() {}, data() {}, close() {} },
    });
    try {
      sh(`git -C ${repo} remote set-url origin git://127.0.0.1:${blackHole.port}/repo.git`);

      // Unpushed, so remoteRefExists is false and containmentOf falls
      // through to the patch-identical check -- the one path that would
      // call a real `git fetch` if the handler's deps() ever dropped its
      // no-network fetch stub.
      const rec = tree("bravo", { push: false });
      const entries = { [`feat-${rec.name}`]: { repoName, mr: { iid: 7, state: "merged", title: "T bravo", sha: "1111111111111111111111111111111111abcd" } } };
      const handlers = buildHandlers(entries);

      const startedAt = Date.now();
      const res = await (handlers["worktree:triage"] as any)({});
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(5_000); // well under containment.ts's 60_000ms fetch timeout
      expect(res.ok).toBe(true);
      expect(res.data.rows).toHaveLength(1);
      expect(res.data.rows[0].group).toBe("only-copy");
      expect(res.data.rows[0].containment).toBe("none");
    } finally {
      blackHole.stop(true);
    }
  });
});
