import { describe, expect, test } from "bun:test";
import { packRootFrom, runToolDefs, splitFlags, type RunToolDeps } from "../run-tools.ts";

type Call = { verb: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };

const RUNS_ROOT = "/runs";
const DB = `${RUNS_ROOT}/repo/id/state.db`;
const RUNS_ROOT_ENV = { RT_RUNS_ROOT: RUNS_ROOT } as NodeJS.ProcessEnv;

function fakeDeps(out = '{"ok":true}', code = 0): { deps: RunToolDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      write: async (verb, args, env, cwd) => { calls.push({ verb, args, env: env ?? {}, cwd: cwd ?? "" }); return { out, code }; },
      list: async () => ({ ok: true, data: { runs: [] } }) as any,
      realpath: (p) => p.replace("/link/", "/real/"),
      isPackRoot: () => true,
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
  test("refuses C0 control characters and DEL", () => {
    for (const bad of ["--repo r\x00", "--repo r\x07", "--repo r\x1b", "--repo r\x7f"]) {
      expect(splitFlags(bad).ok, bad).toBe(false);
    }
  });
  test("still splits on tab, newline and carriage return", () => {
    expect(splitFlags("--repo\tr\n--work-type\rw").ok).toBe(true);
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
  test("refuses a relative skillDir without calling write", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "pack/skills/work" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("skillDir");
    expect(calls).toEqual([]);
  });
  test("refuses a skillDir whose derived pack root carries no plugin manifest", async () => {
    const { deps, calls } = fakeDeps();
    deps.isPackRoot = () => false;
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("plugin.json");
    expect(calls).toEqual([]);
  });

  describe("flags allowlist", () => {
    test("refuses an unknown flag", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --evil x", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--evil");
      expect(calls).toEqual([]);
    });
    test("refuses an attempted --pack-dirs override in --x v form", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --pack-dirs /evil", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--pack-dirs");
      expect(calls).toEqual([]);
    });
    test("refuses an attempted --pack-dirs override in --x=v form", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --pack-dirs=/evil", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--pack-dirs");
      expect(calls).toEqual([]);
    });
    test("refuses --ticket and --spawned-by named inside the flags string itself", async () => {
      const { deps, calls } = fakeDeps();
      const ticket = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --ticket T-1", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      const spawned = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --spawned-by board", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(ticket.ok).toBe(false);
      expect(spawned.ok).toBe(false);
      expect(calls).toEqual([]);
    });
    test("accepts every flag run-start's own CLI parses", async () => {
      const { deps, calls } = fakeDeps('{"ok":true,"runId":"x","runDb":"/db"}');
      const res = await tool(deps, "run_start").handler({
        flags: "--repo r --work-type w --pipeline p --run-id abc --mattstack-sha sha1 --mattstack-dirty 1 --pack-sha name=val",
        skillDir: "/link/pack/skills/work",
      }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(calls[0]!.args).toEqual([
        "--repo", "r", "--work-type", "w", "--pipeline", "p",
        "--run-id", "abc", "--mattstack-sha", "sha1", "--mattstack-dirty", "1", "--pack-sha", "name=val",
        "--pack-dirs", "/real/pack",
      ]);
    });
  });
});

describe("run tools pass runDb as RT_RUN_DB and cwd through", () => {
  test("run_stage start", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: DB, action: "start", stage: "plan" }, { HOME: "/h", ...RUNS_ROOT_ENV } as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-start", args: ["--stage", "plan"] });
    expect(calls[0]!.env.RT_RUN_DB).toBe(DB);
    expect(calls[0]!.env.HOME).toBe("/h");
  });
  test("run_stage fail carries reason and detailPath; redirect carries to", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: DB, action: "fail", stage: "ci", reason: "red", detailPath: "/d" }, RUNS_ROOT_ENV);
    await tool(deps, "run_stage").handler({ runDb: DB, action: "redirect", stage: "ci", to: "implement", reason: "back" }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "stage-fail", args: ["--stage", "ci", "--reason", "red", "--detail-path", "/d"] });
    expect(calls[1]).toMatchObject({ verb: "stage-redirect", args: ["--stage", "ci", "--to", "implement", "--reason", "back"] });
  });
  test("run_stage redirect without to is a field error", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_stage").handler({ runDb: DB, action: "redirect", stage: "ci" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("to");
    expect(calls).toEqual([]);
  });
  test("run_field_set and run_field_get", async () => {
    const { deps, calls } = fakeDeps("main", 0);
    await tool(deps, "run_field_set").handler({ runDb: DB, key: "branch", value: "feat", stage: "provision" }, RUNS_ROOT_ENV);
    const got = await tool(deps, "run_field_get").handler({ runDb: DB, key: "branch" }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "field", args: ["set", "branch", "feat", "--stage", "provision"] });
    expect(calls[1]).toMatchObject({ verb: "field", args: ["get", "branch"] });
    expect(got).toEqual({ ok: true, body: { value: "main" } });
  });
  test("run_field_get on a missing key (exit 3) is an error naming the key", async () => {
    const { deps } = fakeDeps("", 3);
    const res = await tool(deps, "run_field_get").handler({ runDb: DB, key: "mr" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("mr");
  });
  test("run_decision serializes selection itself", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_decision").handler({ runDb: DB, contract: "gate@1", scope: "close", selection: { next: "done" }, decidedBy: "pane" }, RUNS_ROOT_ENV);
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
  test("cwd alone drops an RT_RUN_DB inherited by the server, so it cannot bypass confinement", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_snapshot").handler({ cwd: "/tree" }, { RT_RUN_DB: "/elsewhere/other.db" } as NodeJS.ProcessEnv);
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
  });
  test("an empty runs root refuses every runDb", async () => {
    const { deps, calls } = fakeDeps();
    const saved = process.env.RT_RUNS_ROOT;
    process.env.RT_RUNS_ROOT = "";
    try {
      const res = await tool(deps, "run_snapshot").handler({ runDb: "/anywhere/state.db" }, { RT_RUNS_ROOT: "" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("no runs root");
      expect(calls).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = saved;
    }
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
    const res = await tool(deps, "run_snapshot").handler({ runDb: DB }, RUNS_ROOT_ENV);
    expect(res).toEqual({ ok: false, body: undefined, error: "stage not running" });
  });
});

describe("runDb and cwd validation", () => {
  test("refuses a relative runDb", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: "repo/id/state.db" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runDb");
    expect(calls).toEqual([]);
  });
  test("refuses a relative cwd", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ cwd: "tree" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("cwd");
    expect(calls).toEqual([]);
  });
  test("refuses a runDb outside the runs root", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/elsewhere/repo/id/state.db" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
    expect(calls).toEqual([]);
  });
  test("refuses a runDb whose basename is not state.db", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${RUNS_ROOT}/repo/id/other.db` }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("state.db");
    expect(calls).toEqual([]);
  });
  test("accepts an absolute runDb under the runs root named state.db", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: DB }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe(DB);
  });
  test("passes the realpathed runDb as RT_RUN_DB, not the raw input", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace(/link/g, "real");
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${RUNS_ROOT}/link/repo/id/state.db` }, { RT_RUNS_ROOT: `${RUNS_ROOT}/link` } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe(`${RUNS_ROOT}/real/repo/id/state.db`);
  });
  test("realpaths the runs root too, so a runDb behind a symlinked root (macOS /var -> /private/var) still resolves", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace("/var/", "/private/var/");
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/var/runs/repo/id/state.db" }, { RT_RUNS_ROOT: "/var/runs" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe("/private/var/runs/repo/id/state.db");
  });
  test("still refuses a runDb outside the root once both are realpathed", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace("/var/", "/private/var/");
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/elsewhere/repo/id/state.db" }, { RT_RUNS_ROOT: "/var/runs" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
    expect(calls).toEqual([]);
  });
  test("tolerates a runs root that does not resolve yet (a fresh install)", async () => {
    const { deps } = fakeDeps();
    const ROOT = "/fresh/runs";
    deps.realpath = (p) => { if (p === ROOT) throw new Error("ENOENT"); return p; };
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${ROOT}/repo/id/state.db` }, { RT_RUNS_ROOT: ROOT } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
  });
});
