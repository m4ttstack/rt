import { describe, expect, test } from "bun:test";
import { worktreeToolDefs } from "../worktree-tools.ts";

const ID = "remote:gitlab.com%2Facme%2Facme-dev";
function fake() {
  const calls: Array<{ name: string; payload: any; opts: any }> = [];
  const command = (async (name: string, payload: unknown, opts: unknown) => { calls.push({ name, payload, opts }); return { ok: true, data: { done: name } }; }) as any;
  return { calls, tool: (n: string) => worktreeToolDefs({ command }).find((t) => t.name === n)! };
}

describe("worktree tools", () => {
  test("provision needs a ticket or a branch", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ticket");
    expect(calls).toEqual([]);
  });
  test("provision passes ticket, title, disposal and owner and waits minutes", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ name: "worktree:provision", payload: { repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" } });
    expect(calls[0]!.opts.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
  test("provision refuses an unknown disposal", async () => {
    const { tool } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b", disposal: "later" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("dispose and stop_holders name the tree", async () => {
    const { tool, calls } = fake();
    await tool("worktree_dispose").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    await tool("worktree_stop_holders").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    expect(calls.map((c) => c.name)).toEqual(["worktree:dispose", "worktree:stop-holders"]);
    expect(calls[0]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
    expect(calls[1]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
  });
});
