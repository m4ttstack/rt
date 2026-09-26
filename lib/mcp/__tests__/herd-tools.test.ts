import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { herdToolDefs, type HerdToolDeps } from "../herd-tools.ts";

/** A real directory standing in for the Claude Code temp root -- checkTempRootPath realpaths the parent, so the root must actually exist on disk. */
const FAKE_TEMP_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-out-")));
/** Stands in for an installed plugin root; the read guard realpaths each file, so they must exist. */
const FAKE_PLUGIN_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-plugin-")));
const OUTSIDE = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-outside-")));
const TEMPLATE = join(FAKE_PLUGIN_ROOT, "job-template.md");
const STRATEGIES = join(FAKE_PLUGIN_ROOT, "strategies.md");
const METHOD = join(FAKE_TEMP_ROOT, "method.md");
const SECRET = join(OUTSIDE, "id_ed25519");
const ESCAPE_LINK = join(FAKE_PLUGIN_ROOT, "escape.md");
for (const f of [TEMPLATE, STRATEGIES, METHOD]) writeFileSync(f, "body");
writeFileSync(SECRET, "PRIVATE KEY");
symlinkSync(SECRET, ESCAPE_LINK);

afterAll(() => {
  for (const dir of [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT, OUTSIDE]) rmSync(dir, { recursive: true, force: true });
});

function fake(tempRoots: string[] = [FAKE_TEMP_ROOT], readRoots: string[] = [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT]) {
  const calls: Array<{ fn: string; a: any; o: any }> = [];
  const rec = (fn: string) => (async (a: unknown, o: unknown) => { calls.push({ fn, a, o }); return { ok: true, data: { fn } }; }) as any;
  const deps: HerdToolDeps = {
    start: rec("start"), spawn: rec("spawn"), close: rec("close"), status: rec("status"), list: rec("list"),
    attend: rec("attend"), wrapUp: rec("wrapUp"), resume: rec("resume"), milestone: rec("milestone"),
    verb: (async (input: unknown) => { calls.push({ fn: "verb", a: input, o: undefined }); return { ok: true, body: { brief: "x" } }; }) as any,
    tempRoots: () => tempRoots,
    readRoots: () => readRoots,
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
    const out = join(FAKE_TEMP_ROOT, "o.md");
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, strategy: "direct-tdd", strategies: STRATEGIES, fill: ["goal=ship", "fence=src/"], out }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", TEMPLATE, "--strategy", "direct-tdd", "--strategies", STRATEGIES, "--fill", "goal=ship", "--fill", "fence=src/", "--out", out] });
  });

  test("herd_brief passes a methodFile inside the temp root through", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", TEMPLATE, "--method-file", METHOD] });
  });

  test("herd_brief refuses an out path outside the Claude Code temp root, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const out = join(realpathSync(homedir()), ".zshrc");
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD, out }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("temp root");
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a relative out path, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD, out: "relative/brief.md" }, SESSION);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a template, strategies or methodFile outside every read root, calling the verb runner zero times", async () => {
    for (const input of [
      { job: "j", template: SECRET, methodFile: METHOD },
      { job: "j", template: TEMPLATE, strategy: "direct-tdd", strategies: SECRET },
      { job: "j", template: TEMPLATE, methodFile: SECRET },
    ]) {
      const { tool, calls } = fake();
      const r = await tool("herd_brief").handler(input, SESSION);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(r.error).toContain("plugin or pack root");
      expect(calls).toEqual([]);
    }
  });

  test("herd_brief refuses a relative template, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: "job-template.md", methodFile: METHOD }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("absolute");
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a methodFile symlinked inside a read root to a file outside, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: ESCAPE_LINK }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("plugin or pack root");
    expect(calls).toEqual([]);
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
