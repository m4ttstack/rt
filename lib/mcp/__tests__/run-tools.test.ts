import { describe, expect, test } from "bun:test";
import { packRootFrom, runToolDefs, splitFlags, type RunToolDeps } from "../run-tools.ts";

type Call = { verb: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };

function fakeDeps(out = '{"ok":true}', code = 0): { deps: RunToolDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      write: async (verb, args, env, cwd) => { calls.push({ verb, args, env: env ?? {}, cwd: cwd ?? "" }); return { out, code }; },
      list: async () => ({ ok: true, data: { runs: [] } }) as any,
      realpath: (p) => p.replace("/link/", "/real/"),
    },
  };
}

const tool = (deps: RunToolDeps, name: string) => runToolDefs(deps).find((t) => t.name === name)!;

describe("splitFlags", () => {
  test("splits on whitespace", () => {
    expect(splitFlags(" --repo r  --work-type w --pipeline p ")).toEqual({ ok: true, args: ["--repo", "r", "--work-type", "w", "--pipeline", "p"] });
  });
  test("refuses quotes and command substitution", () => {
    for (const bad of ["--repo 'r'", '--repo "r"', "--repo $(id)", "--repo `id`"]) {
      expect(splitFlags(bad).ok, bad).toBe(false);
    }
  });
});

describe("packRootFrom", () => {
  test("is the realpath two levels above the skill dir", () => {
    expect(packRootFrom("/link/pack/skills/work", (p) => p.replace("/link/", "/real/"))).toBe("/real/pack");
  });
});

describe("run_start", () => {
  test("builds the run-start argv from flags, skillDir, ticket and spawnedBy", async () => {
    const { deps, calls } = fakeDeps('{"ok":true,"runId":"x","runDb":"/db"}');
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "/link/pack/skills/work", ticket: "T-1", spawnedBy: "board" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ ok: true, runId: "x", runDb: "/db" });
    expect(calls[0]!.verb).toBe("run-start");
    expect(calls[0]!.args).toEqual(["--repo", "r", "--work-type", "w", "--pipeline", "p", "--pack-dirs", "/real/pack", "--ticket", "T-1", "--spawned-by", "board"]);
  });
  test("refuses a quoted flag string without calling write", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_start").handler({ flags: "--repo $(x)", skillDir: "/p/s/w" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("run tools pass runDb as RT_RUN_DB and cwd through", () => {
  test("run_stage start", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "start", stage: "plan" }, { HOME: "/h" } as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-start", args: ["--stage", "plan"] });
    expect(calls[0]!.env.RT_RUN_DB).toBe("/db");
    expect(calls[0]!.env.HOME).toBe("/h");
  });
  test("run_stage fail carries reason and detailPath; redirect carries to", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "fail", stage: "ci", reason: "red", detailPath: "/d" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "redirect", stage: "ci", to: "implement", reason: "back" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-fail", args: ["--stage", "ci", "--reason", "red", "--detail-path", "/d"] });
    expect(calls[1]).toMatchObject({ verb: "stage-redirect", args: ["--stage", "ci", "--to", "implement", "--reason", "back"] });
  });
  test("run_stage redirect without to is a field error", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_stage").handler({ runDb: "/db", action: "redirect", stage: "ci" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("to");
    expect(calls).toEqual([]);
  });
  test("run_field_set and run_field_get", async () => {
    const { deps, calls } = fakeDeps("main", 0);
    await tool(deps, "run_field_set").handler({ runDb: "/db", key: "branch", value: "feat", stage: "provision" }, {} as NodeJS.ProcessEnv);
    const got = await tool(deps, "run_field_get").handler({ runDb: "/db", key: "branch" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "field", args: ["set", "branch", "feat", "--stage", "provision"] });
    expect(calls[1]).toMatchObject({ verb: "field", args: ["get", "branch"] });
    expect(got).toEqual({ ok: true, body: { value: "main" } });
  });
  test("run_field_get on a missing key (exit 3) is an error naming the key", async () => {
    const { deps } = fakeDeps("", 3);
    const res = await tool(deps, "run_field_get").handler({ runDb: "/db", key: "mr" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("mr");
  });
  test("run_decision serializes selection itself", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_decision").handler({ runDb: "/db", contract: "gate@1", scope: "close", selection: { next: "done" }, decidedBy: "pane" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "decision", args: ["record", "--contract", "gate@1", "--scope", "close", "--selection", '{"next":"done"}', "--decided-by", "pane"] });
  });
  test("run_status and run_snapshot; cwd stands in when runDb is omitted", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_status").handler({ cwd: "/tree", status: "done" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_snapshot").handler({ cwd: "/tree" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "run-status", args: ["--status", "done"], cwd: "/tree" });
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
    expect(calls[1]).toMatchObject({ verb: "snapshot", args: [], cwd: "/tree" });
  });
  test("neither runDb nor cwd is refused without touching the run store", async () => {
    const { deps, calls } = fakeDeps();
    for (const name of ["run_stage", "run_field_set", "run_field_get", "run_decision", "run_status", "run_snapshot"]) {
      const res = await tool(deps, name).handler({ action: "start", stage: "s", key: "k", value: "v", contract: "c", scope: "s", selection: {}, decidedBy: "d", status: "done" }, {} as NodeJS.ProcessEnv);
      expect(res.ok, name).toBe(false);
      expect(res.error, name).toContain("runDb");
    }
    expect(calls).toEqual([]);
  });
  test("run_list passes the repo positionally to listRuns", async () => {
    const seen: unknown[] = [];
    const { deps } = fakeDeps();
    deps.list = (async (repo: unknown) => { seen.push(repo); return { ok: true, data: { runs: [] } }; }) as any;
    await tool(deps, "run_list").handler({ repo: "acme" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_list").handler({}, {} as NodeJS.ProcessEnv);
    expect(seen).toEqual(["acme", undefined]);
  });
  test("a non-zero write result surfaces the envelope's error", async () => {
    const { deps } = fakeDeps('{"ok":false,"error":"stage not running"}', 2);
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/db" }, {} as NodeJS.ProcessEnv);
    expect(res).toEqual({ ok: false, body: undefined, error: "stage not running" });
  });
});
