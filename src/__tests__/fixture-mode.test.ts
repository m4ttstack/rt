import { test, expect, afterAll } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, cpSync } from "fs";
import { tmpdir } from "os";

// Boots the real server with BOARD_FIXTURE pointing at a temp fixture dir and
// asserts the canned endpoints answer. Spawned as a subprocess because
// server.ts runs at module top level.
const dir = mkdtempSync(join(tmpdir(), "board-fixture-"));
cpSync(join(import.meta.dir, "..", "..", "tests", "fixture", "config.json"), join(dir, "config.json"));
writeFileSync(join(dir, "data.json"), JSON.stringify({
  title: "MRs ready for review", defaultMember: "all",
  members: [{ username: "matt", name: "Matthew Goodwin", count: 1 }],
  allMembers: [{ username: "matt", name: "Matthew Goodwin", hidden: false, count: 1 }],
  mrs: [{ iid: 1, title: "t", webUrl: "https://gitlab.example.com/g/p/-/merge_requests/1",
          author: { username: "matt", name: "Matthew Goodwin" },
          sourceBranch: "b", targetBranch: "main", updatedAt: "2026-08-19T00:00:00Z",
          reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
          blockers: { any: false }, reviewerComments: 0, unresolvedThreads: 0, isDraft: false }],
  fetchedAt: 1755600000000, fetchError: null, local: true, slackEnabled: false,
  slackTemplates: { single: "{title}: {url}", multiHeader: "{count} ready", multiItem: "- {title}" },
  dataSyncedAt: 1755600000000, scopeUncovered: [], scopeWindowDays: null,
  staleAfterDays: 90, canInvite: false, peering: null,
}));
writeFileSync(join(dir, "discussions.json"), JSON.stringify({ threads: [], comments: [] }));
writeFileSync(join(dir, "review-report.md"), "# canned review\n");

const PORT = 47942; // test's own port, not even the fixture default (7942 collides with an unrelated local service on this machine)
const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "server.ts")], {
  env: { ...process.env, BOARD_FIXTURE: dir, PORT: String(PORT) },
  stdout: "pipe", stderr: "pipe",
});
afterAll(() => proc.kill());

async function ready(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("fixture server never came up");
}

test("fixture mode serves canned endpoints and refuses POSTs", async () => {
  await ready();
  const data = await (await fetch(`http://127.0.0.1:${PORT}/data.json`)).json() as { mrs: unknown[]; fetchedAt: number };
  expect(data.fetchedAt).toBe(1755600000000);
  expect(data.mrs.length).toBe(1);
  const disc = await fetch(`http://127.0.0.1:${PORT}/discussions?repo=x&iid=1&author=matt`);
  expect((await disc.json() as { threads: unknown[] }).threads).toEqual([]);
  const report = await fetch(`http://127.0.0.1:${PORT}/review/report?mr=x`);
  expect(await report.text()).toContain("canned review");
  const boards = await fetch(`http://127.0.0.1:${PORT}/peer/boards`);
  expect(await boards.json()).toEqual({ boards: [] });
  const member = await fetch(`http://127.0.0.1:${PORT}/member?u=matt`);
  expect(((await member.json()) as { mrs: unknown[] }).mrs.length).toBe(1);
  const post = await fetch(`http://127.0.0.1:${PORT}/review`, { method: "POST", body: "{}" });
  expect(post.status).toBe(501);
  const shell = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  expect(shell).toContain('<div id="root">');
}, 30_000);
