import { describe, expect, test } from "bun:test";
import { herdToolDefs, type HerdToolDeps } from "../herd-tools.ts";

function fake() {
  const calls: Array<{ fn: string; a: any; o: any }> = [];
  const rec = (fn: string) => (async (a: unknown, o: unknown) => { calls.push({ fn, a, o }); return { ok: true, data: { fn } }; }) as any;
  const deps: HerdToolDeps = {
    start: rec("start"), spawn: rec("spawn"), close: rec("close"), status: rec("status"), list: rec("list"),
    attend: rec("attend"), wrapUp: rec("wrapUp"), resume: rec("resume"), milestone: rec("milestone"),
    verb: (async (input: unknown) => { calls.push({ fn: "verb", a: input, o: undefined }); return { ok: true, body: { brief: "x" } }; }) as any,
  };
  return { calls, tool: (n: string) => herdToolDefs(deps).find((t) => t.name === n)! };
}
const SESSION = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "p1", HERDR_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv;

describe("herd shepherd tools", () => {
  test("herd_start uses the session and pane from env", async () => {
    const { tool, calls } = fake();
    await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ name: "n", session: "s1", callerPane: "p1" });
  });
  test("herd_start without a session errors", async () => {
    const { tool } = fake();
    const r = await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("herd_spawn passes every option and a minutes-long timeout, with no check", async () => {
    const { tool, calls } = fake();
    await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true });
    expect(calls[0]!.o.timeoutMs).toBeGreaterThanOrEqual(180_000);
  });
  test("herd defaults to HERD_ID when omitted", async () => {
    const { tool, calls } = fake();
    await tool("herd_status").handler({}, { HERD_ID: "hd-9" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toEqual({ herd: "hd-9" });
  });
  test("herd_brief spawns rt herd brief through the verb runner with repeated --fill", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: "/t.md", strategy: "direct-tdd", strategies: "/s.md", fill: ["goal=ship", "fence=src/"], out: "/o.md" }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", "/t.md", "--strategy", "direct-tdd", "--strategies", "/s.md", "--fill", "goal=ship", "--fill", "fence=src/", "--out", "/o.md"] });
  });
  test("herd_attend needs HERDR_WORKSPACE_ID", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", job: "j", callerWorkspace: "w1" });
  });
  test("herd_wrap_up forwards the wrap-up form's answers", async () => {
    const { tool, calls } = fake();
    await tool("herd_wrap_up").handler({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true });
  });
  test("herd_resume passes the session", async () => {
    const { tool, calls } = fake();
    await tool("herd_resume").handler({ herd: "hd-1" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", session: "s1", callerPane: "p1" });
  });
});

describe("herd_milestone", () => {
  test("uses the worker env and passes artifact and summary", async () => {
    const { tool, calls } = fake();
    await tool("herd_milestone").handler({ artifact: "/a.md", summary: "done" }, { ...SESSION, HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", job: "j", session: "s1", pane: "p1", artifact: "/a.md", summary: "done" });
  });
  test("outside a worker pane it errors with the worker-pane text", async () => {
    const { tool } = fake();
    const r = await tool("herd_milestone").handler({ artifact: "/a.md" }, {} as NodeJS.ProcessEnv);
    expect(r.error).toContain("HERD_ID and HERD_JOB are not set");
  });
});
