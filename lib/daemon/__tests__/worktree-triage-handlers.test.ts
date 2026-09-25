import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { closeStateDb } from "../../state/index.ts";
import { composeKey } from "../../state/branch-cache.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createWorktreeTriageHandlers, diffStats, type WorktreeTriageOpts } from "../handlers/worktree-triage.ts";
import type { RunningRunScan } from "../../runs/store.ts";
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

function buildHandlers(
  entries: Record<string, unknown>,
  liveRuns: Set<string> = new Set(),
  liveCwds: Set<string> = new Set(),
  overrides: Partial<WorktreeTriageOpts> = {},
) {
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
    liveCwds: async () => liveCwds,
    ...overrides,
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
  test("banners come only from repos with a claimed ephemeral tree, the set worktree:list uses", async () => {
    sh(`git -C ${repo} remote set-url origin https://github.com/acme/app.git`);
    const handlers = buildHandlers({});
    const onDeck: TreeRecord = { name: "idle", path: join(repo, ".worktrees", "idle"), kind: "ephemeral", state: "on-deck", branch: null, disposal: "merge", createdAt: "2026-09-20T00:00:00Z" };
    saveRegistry(repoName, [onDeck]);
    expect((await (handlers["worktree:triage"] as any)({})).data.banners).toEqual([]);
    saveRegistry(repoName, [onDeck, { ...onDeck, name: "busy", path: join(repo, ".worktrees", "busy"), state: "claimed", branch: "feat-busy" }]);
    const res = await (handlers["worktree:triage"] as any)({});
    expect(res.data.banners.map((b: any) => [b.repo, b.forge])).toEqual([[repoName, "github"]]);
  });

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
  let liveCwds: Set<string>;
  let handlers: any;

  beforeEach(() => {
    entries = {};
    liveRuns = new Set();
    liveCwds = new Set();
    handlers = buildHandlers(entries, liveRuns, liveCwds);
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
    expect(res.data.truncatedFiles).toBeUndefined();
    expect(f.diff.split("\n").length).toBeLessThanOrEqual(401);
  });

  test("triage-diff skips binary and oversized untracked files, and shows a deleted tracked file as modified", async () => {
    const rec = stuck("november2");
    writeFileSync(join(rec.path, "blob.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(join(rec.path, "huge.txt"), "a".repeat(1_000_001));
    unlinkSync(join(rec.path, "november2.txt"));
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "november2" });
    const by = (p: string) => res.data.files.find((x: any) => x.path === p);
    expect(by("blob.bin")).toEqual({ path: "blob.bin", status: "untracked", diff: "(binary or larger than 1 MB)", truncated: true, added: 0, removed: 0, totalLines: 1 });
    expect(by("huge.txt").diff).toBe("(binary or larger than 1 MB)");
    expect(by("november2.txt").status).toBe("modified");
    expect(by("november2.txt").diff).toContain("-w");
  });

  test("triage-diff counts added, removed and total lines before the cap", async () => {
    const rec = stuck("november3");
    writeFileSync(join(rec.path, "long.ts"), Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n"));
    writeFileSync(join(rec.path, "short.ts"), "a\nb\n");
    writeFileSync(join(rec.path, "november3.txt"), "---x\n+++y\nz\n");
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "november3" });
    const by = (p: string) => res.data.files.find((x: any) => x.path === p);
    expect([by("long.ts").added, by("long.ts").removed, by("long.ts").totalLines, by("long.ts").truncated]).toEqual([900, 0, 900, true]);
    expect([by("short.ts").added, by("short.ts").totalLines, by("short.ts").truncated]).toEqual([2, 2, false]);
    const tracked = by("november3.txt");
    expect([tracked.added, tracked.removed]).toEqual([3, 1]);
    expect(tracked.totalLines).toBe(tracked.diff.trimEnd().split("\n").length);
  });

  test("diffStats reads a second diff section's --- and +++ as headers, not changes", () => {
    const twoSections = [
      "diff --git a/a.ts b/a.ts", "index 1..2 100644", "--- a/a.ts", "+++ b/a.ts",
      "@@ -1,2 +1,2 @@", "-old", "+new", " same",
      "diff --git a/b.ts b/b.ts", "index 3..4 100644", "--- a/b.ts", "+++ b/b.ts",
      "@@ -1 +1,2 @@", " keep", "+added",
    ].join("\n");
    expect(diffStats(twoSections)).toEqual({ added: 2, removed: 1 });
  });

  test("triage-remove only removes a broken row", async () => {
    const rec = stuck("oscar");
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).error).toBe("not-broken");
    rmSync(rec.path, { recursive: true, force: true });
    expect((await handlers["worktree:triage-remove"]({ repoName, tree: "oscar" })).ok).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "oscar")).toBeUndefined();
  });

  function blockRetention(): void {
    writeFileSync(join(repo, ".worktrees", ".trash"), "not a directory");
  }

  function danglingGitdir(name: string): TreeRecord {
    const rec = stuck(name);
    rmSync(join(repo, ".git", "worktrees", name), { recursive: true, force: true });
    writeFileSync(join(rec.path, "notes.md"), "keep me\n");
    return rec;
  }

  test("a triage dispose refuses no-trash rather than fall back to an unretained reap", async () => {
    const rec = stuck("quebec");
    mkdirSync(join(rec.path, ".visual"));
    writeFileSync(join(rec.path, ".visual", "shot.png"), "x");
    const only = stuck("quebec2", { push: false });
    const r1 = await rowFor("quebec");
    const r2 = await rowFor("quebec2");
    blockRetention();
    expect(await handlers["worktree:triage-dispose"]({ repoName, tree: "quebec", fingerprint: r1.fingerprint })).toEqual({ ok: false, error: "no-trash" });
    expect(await handlers["worktree:triage-dispose"]({ repoName, tree: "quebec2", fingerprint: r2.fingerprint, confirmOnlyCopy: true })).toEqual({ ok: false, error: "no-trash" });
    expect(readFileSync(join(rec.path, ".visual", "shot.png"), "utf8")).toBe("x");
    expect(existsSync(only.path)).toBe(true);
    expect(readdirSync(join(repo, ".worktrees")).filter((e) => e.startsWith(".trash-"))).toEqual([]);
  });

  test("an acceptDirty dispose refuses in-use while a live cwd sits inside the tree", async () => {
    const rec = stuck("romeo");
    writeFileSync(join(rec.path, "evidence.ts"), "x");
    const r = await rowFor("romeo");
    liveCwds.add(join(rec.path, "sub"));
    expect(await handlers["worktree:triage-dispose"]({ repoName, tree: "romeo", fingerprint: r.fingerprint, discard: "all" })).toEqual({ ok: false, error: "in-use" });
    expect(existsSync(join(rec.path, "evidence.ts"))).toBe(true);
  });

  test("triage-remove retires a dangling-gitdir tree's folder into the trash, then drops the row", async () => {
    const rec = danglingGitdir("sierra");
    expect((await rowFor("sierra")).group).toBe("broken");
    const res = await handlers["worktree:triage-remove"]({ repoName, tree: "sierra" });
    expect(res.ok).toBe(true);
    expect(existsSync(rec.path)).toBe(false);
    expect(readFileSync(join(res.data.trash.path, "notes.md"), "utf8")).toBe("keep me\n");
    expect(JSON.parse(readFileSync(join(res.data.trash.path, "manifest.json"), "utf8")).reason).toBe("remove");
    expect(loadRegistry(repoName).find((t) => t.name === "sierra")).toBeUndefined();
  });

  test("triage-remove refuses remove-failed when the folder cannot be retained, leaving everything as it was", async () => {
    const rec = danglingGitdir("tango");
    blockRetention();
    expect(await handlers["worktree:triage-remove"]({ repoName, tree: "tango" })).toEqual({ ok: false, error: "remove-failed" });
    expect(readFileSync(join(rec.path, "notes.md"), "utf8")).toBe("keep me\n");
    expect(loadRegistry(repoName).find((t) => t.name === "tango")).toBeDefined();
  });

  test("triage-remove refuses mount-unavailable when the tree's parent dir is missing, keeping the row", async () => {
    const path = join(repo, "unmounted-root", "uniform");
    const rec: TreeRecord = { name: "uniform", path, kind: "ephemeral", state: "claimed", branch: "feat-uniform", disposal: "merge", createdAt: "2026-09-20T00:00:00Z" };
    saveRegistry(repoName, [...loadRegistry(repoName), rec]);
    expect((await rowFor("uniform")).group).toBe("broken");
    expect(await handlers["worktree:triage-remove"]({ repoName, tree: "uniform" })).toEqual({ ok: false, error: "mount-unavailable" });
    expect(loadRegistry(repoName).find((t) => t.name === "uniform")).toBeDefined();
  });

  test("triage-diff caps the file list at 50 and flags it", async () => {
    const rec = stuck("victor");
    for (let i = 0; i < 55; i++) writeFileSync(join(rec.path, `f${i}.ts`), "x");
    const res = await handlers["worktree:triage-diff"]({ repoName, tree: "victor" });
    expect(res.data.files).toHaveLength(50);
    expect(res.data.truncatedFiles).toBe(true);
  });

  test("dispose anyway refuses in-use while a live cwd sits inside the tree", async () => {
    const rec = stuck("whiskey", { push: false });
    const r = await rowFor("whiskey");
    expect(r.group).toBe("only-copy");
    liveCwds.add(rec.path);
    expect(await handlers["worktree:triage-dispose"]({ repoName, tree: "whiskey", fingerprint: r.fingerprint, confirmOnlyCopy: true })).toEqual({ ok: false, error: "in-use" });
    expect(existsSync(join(rec.path, "whiskey.txt"))).toBe(true);
  });

  test("dispose anyway refuses cwds-unreadable when live cwds can't be listed", async () => {
    const rec = stuck("whiskey2", { push: false });
    const r = await rowFor("whiskey2");
    const h = buildHandlers(entries, liveRuns, liveCwds, { liveCwds: async () => { throw new Error("lsof failed"); } });
    expect(await h["worktree:triage-dispose"]({ repoName, tree: "whiskey2", fingerprint: r.fingerprint, confirmOnlyCopy: true })).toEqual({ ok: false, error: "cwds-unreadable" });
    expect(existsSync(rec.path)).toBe(true);
  });

  test("dispose anyway refuses a run it can't rule out, and one it sees going live", async () => {
    const pending: RunningRunScan[] = [];
    const scan = (): RunningRunScan => pending.shift() ?? { kind: "none" };
    const h: any = buildHandlers(entries, liveRuns, liveCwds, { findRunningRunByWorktree: scan });
    const rec = stuck("xray", { push: false });
    const r = (await h["worktree:triage"]({ repoName })).data.rows.find((x: any) => x.tree === "xray");
    expect(r.group).toBe("only-copy");
    const body = { repoName, tree: "xray", fingerprint: r.fingerprint, confirmOnlyCopy: true };
    pending.push({ kind: "none" }, { kind: "incomplete" });
    expect(await h["worktree:triage-dispose"](body)).toEqual({ ok: false, error: "runs-unreadable" });
    pending.push({ kind: "none" }, { kind: "match", run: { id: "run-9", currentStage: "implement" } });
    expect(await h["worktree:triage-dispose"](body)).toEqual({ ok: false, error: "running-run:run-9 at implement" });
    expect(existsSync(rec.path)).toBe(true);
  });

  test("push-branch refuses a row that is neither only-copy nor look", async () => {
    stuck("yankee");
    const r = await rowFor("yankee");
    expect(r.group).toBe("safe");
    expect(await handlers["worktree:push-branch"]({ repoName, tree: "yankee", fingerprint: r.fingerprint })).toEqual({ ok: false, error: "not-pushable:safe" });
  });

  test("an unlinked tree's verdict says its folder still has files", async () => {
    danglingGitdir("zulu");
    const r = await rowFor("zulu");
    expect([r.group, r.verdict]).toEqual(["broken", "Its git link is broken. The folder still has files; Remove moves it to the trash."]);
  });

  test("triage-remove refuses mount-unavailable when the gitdir's repo root and its parent are both gone", async () => {
    const rec = stuck("zulu2");
    const vanished = join(realpathSync(tmpdir()), `rttriage-vanished-${process.pid}-${Date.now()}`, "repo");
    writeFileSync(join(rec.path, ".git"), `gitdir: ${join(vanished, ".git", "worktrees", "zulu2")}\n`);
    expect((await rowFor("zulu2")).group).toBe("broken");
    expect(await handlers["worktree:triage-remove"]({ repoName, tree: "zulu2" })).toEqual({ ok: false, error: "mount-unavailable" });
    expect(existsSync(join(rec.path, "zulu2.txt"))).toBe(true);
    expect(loadRegistry(repoName).find((t) => t.name === "zulu2")).toBeDefined();
  });

  test("triage-remove still removes when only the repo root is gone and its parent is readable", async () => {
    const rec = stuck("zulu3");
    writeFileSync(join(rec.path, ".git"), `gitdir: ${join(repo, "moved-clone", ".git", "worktrees", "zulu3")}\n`);
    const res = await handlers["worktree:triage-remove"]({ repoName, tree: "zulu3" });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(res.data.trash.path, "zulu3.txt"), "utf8")).toBe("w\n");
  });

  test("stop-holders refuses a tree no process is holding", async () => {
    stuck("papa");
    expect(await handlers["worktree:stop-holders"]({ repoName, tree: "papa" })).toEqual({ ok: false, error: "not-held" });
  });
});
