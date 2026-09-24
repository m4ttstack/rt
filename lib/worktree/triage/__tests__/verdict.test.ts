import { describe, test, expect } from "bun:test";
import { triageCounts, triageRow, type TriageFacts } from "../verdict.ts";

const base: TriageFacts = {
  repo: `remote:${encodeURIComponent("github.com/m4ttstack/rt")}`, tree: "t", path: "/p/t", branch: "b", broken: null,
  mr: { iid: 1, state: "merged", title: "x", at: null, url: null }, ticket: null,
  remoteBranchExists: true, ahead: 0, containment: "on-remote",
  dirt: { kind: "none", files: [], discardable: [] },
  fingerprint: { headSha: "h", dirtHash: "d", mrState: "merged" }, kept: null, hold: null,
};
const row = (o: Partial<TriageFacts>) => triageRow({ ...base, ...o });

describe("triageRow", () => {
  test("generated junk with every commit in main is safe, dispose first", () => {
    const r = row({ containment: "in-default", remoteBranchExists: false, dirt: { kind: "junk", files: [".visual/a.png"], discardable: [".visual/a.png"] } });
    expect([r.group, r.push.kind, r.actions[0]]).toEqual(["safe", "in-main", "dispose"]);
  });
  test("a lockfile-only rewrite is safe", () => {
    expect(row({ dirt: { kind: "lockfile", files: ["bun.lock"], discardable: ["bun.lock"] } }).group).toBe("safe");
  });
  test("a rebased-then-merged branch with the remote deleted is safe", () => {
    const r = row({ containment: "patch-identical", remoteBranchExists: false, ahead: 8 });
    expect([r.group, r.push.kind]).toEqual(["safe", "remote-deleted"]);
  });
  test("a closed MR whose remote has every commit is safe", () => {
    expect(row({ mr: { iid: 2, state: "closed", title: "x", at: null, url: null } }).group).toBe("safe");
  });
  test("the verdict calls the change a PR on GitHub and an MR on GitLab", () => {
    const closed = { mr: { iid: 2, state: "closed" as const, title: "x", at: null, url: null } };
    expect(row(closed).verdict).toBe("The PR was closed, but the remote branch has every commit.");
    const gitlab = `remote:${encodeURIComponent("gitlab.com/m4ttstack/app-kit")}`;
    expect(row({ ...closed, repo: gitlab }).verdict).toBe("The MR was closed, but the remote branch has every commit.");
    expect(row({ repo: gitlab, containment: "patch-identical", ahead: 8 }).verdict).toBe("Rebased before merge, and all 8 commits match the merged MR.");
  });
  test("no MR but every commit in main is safe", () => {
    expect(row({ mr: null, containment: "in-default" }).group).toBe("safe");
  });
  test("a real uncommitted file needs a look, review first", () => {
    const r = row({ dirt: { kind: "real", files: ["a.test.ts"], discardable: [] } });
    expect([r.group, r.actions[0]]).toEqual(["look", "review"]);
  });
  test("unpushed work with no remote is the only copy, push first", () => {
    const r = row({ containment: "none", remoteBranchExists: false, ahead: 19, mr: { iid: 3, state: "closed", title: "x", at: null, url: null } });
    expect([r.group, r.push, r.actions[0]]).toEqual(["only-copy", { kind: "unpushed", ahead: 19 }, "push-branch"]);
    expect(r.actions).toContain("keep");
    expect(r.actions).not.toContain("dispose");
  });
  test.each([
    ["process", "stop-process"], ["herd", "open-herd"], ["run", "open-run"],
  ] as const)("a %s hold is waiting with %s", (kind, action) => {
    const r = row({ hold: { kind, detail: "d" }, containment: "none" });
    expect([r.group, r.actions[0]]).toEqual(["waiting", action]);
  });
  test("a stale orphan being stopped is waiting with no primary action", () => {
    const r = row({ hold: { kind: "orphan-stopping", detail: "d" } });
    expect(r.group).toBe("waiting");
    expect(r.actions.every((a) => ["open-finder", "open-terminal", "copy-path"].includes(a))).toBe(true);
  });
  test("a broken tree beats every other state and only offers remove", () => {
    const r = row({ broken: "gone", containment: "none", hold: { kind: "process", detail: "d" } });
    expect([r.group, r.actions]).toEqual(["broken", ["remove", "copy-path"]]);
  });
  test("a broken tree whose folder is still there never says there is nothing to recover", () => {
    expect(row({ broken: "gone" }).verdict).toBe("Its folder is gone. Nothing to recover.");
    const unlinked = row({ broken: "unlinked" });
    expect(unlinked.group).toBe("broken");
    expect(unlinked.verdict).toBe("Its git link is broken. The folder still has files; Remove moves it to the trash.");
  });
  test("a keep holds while the fingerprint matches, and lapses when it doesn't", () => {
    const kept = { keptAt: "2026-09-24T00:00:00Z", headSha: "h", dirtHash: "d", mrState: "merged" };
    expect(row({ kept, containment: "none" }).group).toBe("kept");
    expect(row({ kept, containment: "none" }).actions[0]).toBe("unkeep");
    expect(row({ kept: { ...kept, headSha: "old" }, containment: "none" }).group).toBe("only-copy");
  });
  test("every row names its verdict in one sentence", () => {
    for (const r of [row({}), row({ containment: "none" }), row({ broken: "gone" }), row({ broken: "unlinked" })]) expect(r.verdict).toMatch(/^[A-Z].*\.$/);
  });
  test("a hold with detail ending in period has it stripped from the verdict", () => {
    const r = row({ hold: { kind: "herd", detail: "pid 7 has its cwd inside." } });
    expect(r.verdict).toBe("Waiting: pid 7 has its cwd inside.");
  });
  test("a kept row whose facts carry a hold has no hold field", () => {
    const kept = { keptAt: "2026-09-24T00:00:00Z", headSha: "h", dirtHash: "d", mrState: "merged" };
    const r = row({ kept, containment: "none", hold: { kind: "process", detail: "d" } });
    expect(r.group).toBe("kept");
    expect("hold" in r).toBe(false);
  });
});

describe("triageCounts", () => {
  test("waiting and kept never count toward needsDecision; broken does", () => {
    const rows = [row({}), row({ containment: "none" }), row({ broken: "gone" }), row({ hold: { kind: "herd", detail: "d" } }),
      row({ kept: { keptAt: "x", headSha: "h", dirtHash: "d", mrState: "merged" }, containment: "none" })];
    expect(triageCounts(rows)).toEqual({ needsDecision: 3, safe: 1, waiting: 1, kept: 1 });
  });
});
