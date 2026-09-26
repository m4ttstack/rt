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

function fake(opts: { statusError?: string } = {}) {
  const tempRoots = [FAKE_TEMP_ROOT];
  const readRoots = [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT];
  const calls: Array<{ fn: string; a: any; o: any }> = [];
  const rec = (fn: string) => (async (a: unknown, o: unknown) => { calls.push({ fn, a, o }); return { ok: true, data: { fn } }; }) as any;
  const status = (async (a: { herd: string }) => {
    calls.push({ fn: "status", a, o: undefined });
    if (opts.statusError) return { ok: false, error: opts.statusError };
    return { ok: true, data: { herd: { id: a.herd, shepherdSession: "s1" }, jobs: [] } };
  }) as any;
  const deps: HerdToolDeps = {
    start: rec("start"), spawn: rec("spawn"), close: rec("close"), status, list: rec("list"),
    attend: rec("attend"), wrapUp: rec("wrapUp"), resume: rec("resume"), milestone: rec("milestone"),
    verb: (async (input: unknown) => { calls.push({ fn: "verb", a: input, o: undefined }); return { ok: true, body: { brief: "x" } }; }) as any,
    tempRoots: () => tempRoots,
    readRoots: () => readRoots,
  };
  const destructive = () => calls.filter((c) => ["spawn", "close", "wrapUp", "resume"].includes(c.fn));
  return { calls, destructive, tool: (n: string) => herdToolDefs(deps).find((t) => t.name === n)! };
}
const SESSION = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "p1", HERDR_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv;
const WORKER = { ...SESSION, HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv;
const OTHER_SESSION = { ...SESSION, CLAUDE_CODE_SESSION_ID: "s2" } as NodeJS.ProcessEnv;
const NO_SESSION_ENV = { HERDR_PANE_ID: "p1" } as NodeJS.ProcessEnv;

const SHEPHERD_ONLY: Array<[string, Record<string, unknown>]> = [
  ["herd_spawn", { herd: "hd-1", job: "j" }],
  ["herd_close", { herd: "hd-1", job: "j" }],
  ["herd_wrap_up", { herd: "hd-1", closePanes: true }],
];

describe("herd tools refuse a caller that does not own the herd", () => {
  test("herd_spawn, herd_close, herd_wrap_up and herd_resume refuse in a worker pane, with zero daemon calls", async () => {
    for (const [name, input] of [...SHEPHERD_ONLY, ["herd_resume", { herd: "hd-1" }] as [string, Record<string, unknown>]]) {
      const { tool, calls } = fake();
      const r = await tool(name).handler(input, WORKER);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("HERD_JOB");
      expect(calls, name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close and herd_wrap_up refuse without a Claude Code session, with zero destructive calls", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, NO_SESSION_ENV);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("CLAUDE_CODE_SESSION_ID");
      expect(destructive(), name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close and herd_wrap_up refuse a session that is not the herd's shepherd, with zero destructive calls", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, OTHER_SESSION);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("not the shepherd");
      expect(r.error, name).toContain("herd_resume");
      expect(destructive(), name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close and herd_wrap_up run for the herd's own shepherd session", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, SESSION);
      expect(r.ok, name).toBe(true);
      expect(destructive().length, name).toBe(1);
    }
  });

  test("an unknown herd surfaces the status error and runs nothing destructive", async () => {
    const { tool, destructive } = fake({ statusError: 'unknown herd "hd-x"' });
    const r = await tool("herd_close").handler({ herd: "hd-x", job: "j" }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown herd");
    expect(destructive()).toEqual([]);
  });

  test("herd_resume stays open to a session that is not the current shepherd, so a new session can take over", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_resume").handler({ herd: "hd-1" }, OTHER_SESSION);
    expect(r.ok).toBe(true);
    expect(calls.find((c) => c.fn === "resume")!.a).toMatchObject({ herd: "hd-1", session: "s2" });
  });

  test("herd_wrap_up requires herd, even with HERD_ID set", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_wrap_up").handler({ closePanes: true }, { ...SESSION, HERD_ID: "hd-1" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("herd");
    expect(calls).toEqual([]);
    expect(tool("herd_wrap_up").inputSchema.required).toEqual(["herd"]);
  });
});

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
  test("herd_spawn passes every option and a minutes-long timeout", async () => {
    const { tool, destructive } = fake();
    await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true }, SESSION);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true });
    expect(destructive()[0]!.o.timeoutMs).toBeGreaterThanOrEqual(180_000);
  });
  test("herd_spawn refuses a relative brief path, with zero daemon calls", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: "brief.md" }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("brief must be an absolute path");
    expect(calls).toEqual([]);
  });
  test("herd_brief's description names every path confinement", () => {
    const { tool } = fake();
    const d = tool("herd_brief").description;
    expect(d).toContain("out must be an absolute path inside the Claude Code temp root");
    expect(d).toContain("template, strategies and methodFile must be absolute paths inside the Claude Code temp root or an installed plugin or pack root");
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
    const { tool, destructive } = fake();
    await tool("herd_wrap_up").handler({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true }, SESSION);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true });
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
