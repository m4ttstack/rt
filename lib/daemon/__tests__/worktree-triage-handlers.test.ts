import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { closeStateDb } from "../../state/index.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createWorktreeTriageHandlers } from "../handlers/worktree-triage.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { fakeStore } from "./fake-cache-store.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const sh = (c: string, cwd?: string) => execSync(c, { cwd, shell: "/bin/zsh", stdio: "pipe" }).toString().trim();
const repoName = `remote:${encodeURIComponent("github.com/acme/app")}`;

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

function buildHandlers(entries: Record<string, unknown>, liveRuns: Set<string> = new Set()) {
  const ctx: Pick<HandlerContext, "repoIndex" | "cache" | "log"> = {
    repoIndex: () => ({ [repoName]: repo }),
    cache: fakeStore(entries as any),
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} } as unknown as Logger,
  };
  return createWorktreeTriageHandlers(ctx, {
    findRunningRunByWorktree: (wt: string) =>
      liveRuns.has(wt) ? { kind: "match" as const, run: { id: "run-1", currentStage: "implement" } } : { kind: "none" as const },
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

describe("triage action verbs", () => {
  let entries: Record<string, unknown>;
  let liveRuns: Set<string>;
  let handlers: any;

  beforeEach(() => {
    entries = {};
    liveRuns = new Set();
    handlers = buildHandlers(entries, liveRuns);
  });

  function stuck(name: string, opts: { push?: boolean } = {}): TreeRecord {
    const rec = tree(name, opts);
    entries[composeKey(repoName, `feat-${name}`)] = { repoName, mr: { iid: 7, state: "merged", title: `T ${name}`, sha: null } };
    return rec;
  }

  async function rowFor(name: string): Promise<any> {
    const res = await handlers["worktree:triage"]({ repoName });
    const row = res.data.rows.find((r: any) => r.tree === name);
    if (!row) throw new Error(`no triage row for ${name}`);
    return row;
  }

  test("a safe junk-only tree disposes unforced, and its junk travels into the trash", async () => {
    const rec = stuck("golf");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "a b.png"), "x");
    const r = await rowFor("golf");
    expect([r.group, r.dirt.kind]).toEqual(["safe", "junk"]);
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "golf", fingerprint: r.fingerprint, discard: "classified" });
    expect(res.ok).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "golf")).toBeUndefined();
    expect(existsSync(rec.path)).toBe(false);
    expect(readFileSync(join(res.data.trash.path, ".visual", "a b.png"), "utf8")).toBe("x");
    expect(JSON.parse(readFileSync(join(res.data.trash.path, "manifest.json"), "utf8")).reason).toBe("manual");
  });

  test("a stale fingerprint is refused as changed", async () => {
    const rec = stuck("hotel");
    const r = await rowFor("hotel");
    writeFileSync(join(rec.path, "new.ts"), "x");
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "hotel", fingerprint: r.fingerprint, discard: "classified" });
    expect(res).toEqual({ ok: false, error: "changed" });
    expect(existsSync(join(rec.path, "new.ts"))).toBe(true);
  });

  test("a missing fingerprint is refused as changed", async () => {
    stuck("hotel2");
    expect(await handlers["worktree:triage-dispose"]({ repoName, tree: "hotel2" })).toEqual({ ok: false, error: "changed" });
  });

  test("an unknown tree is refused as tree-unknown", async () => {
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "nope", fingerprint: { headSha: "", dirtHash: "", mrState: null } });
    expect(res).toEqual({ ok: false, error: "tree-unknown" });
  });

  test("discard all is refused on a safe row, allowed on a look row, and the look dirt lands in the trash", async () => {
    stuck("india");
    const r1 = await rowFor("india");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "india", fingerprint: r1.fingerprint, discard: "all" })).error).toBe("discard-not-allowed");
    const look = stuck("juliet");
    writeFileSync(join(look.path, "evidence.test.ts"), "x");
    const r2 = await rowFor("juliet");
    expect(r2.group).toBe("look");
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "juliet", fingerprint: r2.fingerprint, discard: "all" });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(res.data.trash.path, "evidence.test.ts"), "utf8")).toBe("x");
  });

  test("a look row without discard all is refused as review-first", async () => {
    const look = stuck("juliet2");
    writeFileSync(join(look.path, "evidence.test.ts"), "x");
    const r = await rowFor("juliet2");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "juliet2", fingerprint: r.fingerprint })).error).toBe("review-first");
    expect(existsSync(join(look.path, "evidence.test.ts"))).toBe(true);
  });

  test("an only-copy row refuses dispose without confirmOnlyCopy", async () => {
    stuck("kilo", { push: false });
    const r = await rowFor("kilo");
    expect(r.group).toBe("only-copy");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "kilo", fingerprint: r.fingerprint })).error).toBe("only-copy");
    expect((await handlers["worktree:triage-dispose"]({ repoName, tree: "kilo", fingerprint: r.fingerprint, confirmOnlyCopy: true })).ok).toBe(true);
  });

  test("a safe row whose run went live after the panel read is refused, tree intact", async () => {
    const rec = stuck("kilo2");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "shot.png"), "x");
    const r = await rowFor("kilo2");
    expect(r.group).toBe("safe");
    liveRuns.add(rec.path);
    const res = await handlers["worktree:triage-dispose"]({ repoName, tree: "kilo2", fingerprint: r.fingerprint });
    expect(res).toEqual({ ok: false, error: "not-disposable:waiting" });
    expect(existsSync(join(rec.path, ".visual", "shot.png"))).toBe(true);
  });

  test("keep holds until the tree changes, then the row needs a decision again", async () => {
    const rec = stuck("lima", { push: false });
    const r = await rowFor("lima");
    expect((await handlers["worktree:keep"]({ repoName, tree: "lima", fingerprint: r.fingerprint })).ok).toBe(true);
    expect((await rowFor("lima")).group).toBe("kept");
    writeFileSync(join(rec.path, "more.ts"), "x");
    expect((await rowFor("lima")).group).not.toBe("kept");
  });

  test("keep refuses a stale fingerprint; unkeep returns a kept row to its group", async () => {
    const rec = stuck("lima2", { push: false });
    const r = await rowFor("lima2");
    writeFileSync(join(rec.path, "more.ts"), "x");
    expect(await handlers["worktree:keep"]({ repoName, tree: "lima2", fingerprint: r.fingerprint })).toEqual({ ok: false, error: "changed" });
    const r2 = await rowFor("lima2");
    await handlers["worktree:keep"]({ repoName, tree: "lima2", fingerprint: r2.fingerprint });
    expect((await rowFor("lima2")).group).toBe("kept");
    expect(await handlers["worktree:unkeep"]({ repoName, tree: "lima2" })).toEqual({ ok: true, data: { tree: "lima2" } });
    expect((await rowFor("lima2")).group).toBe("only-copy");
  });

  test("push-branch turns an only-copy row safe", async () => {
    stuck("mike", { push: false });
    const r = await rowFor("mike");
    const res = await handlers["worktree:push-branch"]({ repoName, tree: "mike", fingerprint: r.fingerprint });
    expect(res.ok).toBe(true);
    expect(res.data.row.group).toBe("safe");
  });

  test("push-branch commitDirty commits exactly the row's dirty files, spaces and all", async () => {
    const rec = stuck("mike2", { push: false });
    sh(`git config user.email t@t && git config user.name t`, rec.path);
    writeFileSync(join(rec.path, "a b.ts"), "x");
    writeFileSync(join(rec.path, "mike2.txt"), "changed\n");
    const r = await rowFor("mike2");
    const res = await handlers["worktree:push-branch"]({ repoName, tree: "mike2", fingerprint: r.fingerprint, commitDirty: true, message: "keep leftovers" });
    expect(res.ok).toBe(true);
    expect(res.data.row.group).toBe("safe");
    expect(res.data.row.dirt.kind).toBe("none");
    expect(sh(`git log -1 --format=%s`, rec.path)).toBe("keep leftovers");
    expect(sh(`git show --name-only --format= HEAD`, rec.path).split("\n").sort()).toEqual(["a b.ts", "mike2.txt"]);
  });

  test("triage-diff shows untracked file content and caps long files", async () => {
    const rec = stuck("november");
    writeFileSync(join(rec.path, "long.ts"), Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n"));
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "november" });
    const f = res.data.files.find((x: any) => x.path === "long.ts");
    expect([f.status, f.truncated]).toEqual(["untracked", true]);
    expect(f.diff.split("\n").length).toBeLessThanOrEqual(401);
  });

  test("triage-diff skips binary and oversized untracked files, and shows a deleted tracked file as modified", async () => {
    const rec = stuck("november2");
    writeFileSync(join(rec.path, "blob.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(join(rec.path, "huge.txt"), "a".repeat(1_000_001));
    unlinkSync(join(rec.path, "november2.txt"));
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "november2" });
    const by = (p: string) => res.data.files.find((x: any) => x.path === p);
    expect(by("blob.bin")).toEqual({ path: "blob.bin", status: "untracked", diff: "(binary or larger than 1 MB)", truncated: true });
    expect(by("huge.txt").diff).toBe("(binary or larger than 1 MB)");
    expect(by("november2.txt").status).toBe("modified");
    expect(by("november2.txt").diff).toContain("-w");
  });

  test("triage-remove only removes a broken row", async () => {
    const rec = stuck("oscar");
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).error).toBe("not-broken");
    rmSync(rec.path, { recursive: true, force: true });
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).ok).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "oscar")).toBeUndefined();
  });

  test("stop-holders refuses a tree no process is holding", async () => {
    stuck("papa");
    expect(await handlers["worktree:stop-holders"]({ repoName, tree: "papa" })).toEqual({ ok: false, error: "not-held" });
  });
});
