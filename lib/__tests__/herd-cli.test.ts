import { describe, test, expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildAskPayload, buildBriefInputs, buildSpawnPayload, buildWrapUpPayload, brief, jobEnv, renderAnswer, renderHerdRow, renderStatus, soleHerdId, workerEnv } from "../../commands/herd.ts";
import type { Commands, HerdListRow, HerdStatusData } from "../../packages/rt-client/src/index.ts";

async function run(fn: (args: string[]) => Promise<void>, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
  const errSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.map(String).join(" ")); });
  const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit sentinel"); });
  let code = 0;
  try {
    await fn(args);
  } catch (e) {
    if (e instanceof Error && e.message === "process.exit sentinel") code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
    else throw e;
  } finally {
    logSpy.mockRestore(); errSpy.mockRestore(); exitSpy.mockRestore();
  }
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("rt herd payload builders", () => {
  test("workerEnv reads HERD_ID, HERD_JOB, CLAUDE_CODE_SESSION_ID, HERDR_PANE_ID", () => {
    expect(workerEnv({ HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s", HERDR_PANE_ID: "p" })).toEqual({ herd: "h", job: "j", session: "s", pane: "p" });
    expect(() => workerEnv({})).toThrow(/HERD_ID/);
  });

  test("buildAskPayload parses --questions JSON and carries --context", () => {
    const p = buildAskPayload(["--questions", '[{"id":"q","label":"?","multi":false,"options":["a"]}]', "--context", "why"], { HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s" });
    expect(p).toMatchObject({ herd: "h", job: "j", session: "s", context: "why" });
    expect(p.questions).toHaveLength(1);
    expect(() => buildAskPayload(["--questions", "nope"], { HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s" })).toThrow(/JSON/);
  });

  test("buildSpawnPayload reads the brief file", () => {
    const dir = require("os").tmpdir();
    const file = require("path").join(dir, `brief-${process.pid}.md`);
    require("fs").writeFileSync(file, "# brief");
    const p = buildSpawnPayload(["--herd", "h", "--job", "job-a", "--brief", file, "--model", "opus"]);
    expect(p).toMatchObject({ herd: "h", job: "job-a", brief: "# brief", model: "opus" });
  });

  test("buildWrapUpPayload collects repeated --dispose values and booleans", () => {
    expect(buildWrapUpPayload(["h-1", "--close-panes", "--dispose", "a", "--dispose", "b", "--archive-room"])).toEqual({ herd: "h-1", closePanes: true, dispose: ["a", "b"], deleteJobDirs: false, archiveRoom: true });
  });

  test("jobEnv needs the job identity only, not a session", () => {
    expect(jobEnv({ HERD_ID: "h", HERD_JOB: "j" })).toEqual({ herd: "h", job: "j" });
    expect(() => jobEnv({ HERD_JOB: "j" })).toThrow(/HERD_ID/);
  });
});

describe("rt herd list", () => {
  const row = (over: Partial<HerdListRow> = {}): HerdListRow => ({
    id: "hd-1", repo: "r", room: "herd-hd-1", workspace: "w", shepherdSession: "s", shepherdHandle: "shep",
    herdrSocket: null, hidden: false, status: "active", createdAt: 0, wrappedAt: null, jobs: 2, ...over,
  });

  test("a row carries the id, status, room and job count", () => {
    expect(renderHerdRow(row())).toBe("hd-1  active  room herd-hd-1  2 jobs");
    expect(renderHerdRow(row({ jobs: 1 }))).toBe("hd-1  active  room herd-hd-1  1 job");
    expect(renderHerdRow(row({ jobs: 0 }))).toBe("hd-1  active  room herd-hd-1  0 jobs");
  });

  test("exactly one herd is the fallback; zero or two are not", () => {
    expect(soleHerdId([row()])).toBe("hd-1");
    expect(soleHerdId([])).toBeNull();
    expect(soleHerdId([row(), row({ id: "hd-2" })])).toBeNull();
  });
});

function answerData(over: Partial<Commands["herd:answer"]["data"]>): Commands["herd:answer"]["data"] {
  return { gate: "gt-1", status: "open", answer: null, closedReason: null, ...over };
}

describe("renderAnswer", () => {
  test("an open gate is not an answer", () => {
    expect(renderAnswer("gt-1", answerData({ status: "open" }))).toContain("is still open");
  });

  test("a closed gate warns against inventing an answer", () => {
    const out = renderAnswer("gt-1", answerData({ status: "closed", closedReason: "abandoned" }));
    expect(out).toContain("do not invent an answer");
    expect(out).toContain("abandoned");
  });

  test("a parked gate warns against inventing an answer", () => {
    expect(renderAnswer("gt-1", answerData({ status: "parked" }))).toContain("do not invent an answer");
  });

  test("answered with a null answer never renders as an empty answer", () => {
    const out = renderAnswer("gt-1", answerData({ status: "answered", answer: null }));
    expect(out).toContain("carries no answer");
    expect(out).not.toContain("{}");
  });

  test("answered renders the answerer and the answers", () => {
    const out = renderAnswer("gt-1", answerData({ status: "answered", answer: { answers: { q1: "yes" }, by: "human", answeredAt: 1 } }));
    expect(out).toContain("answered by human:");
    expect(out).toContain("\"q1\": \"yes\"");
  });
});

function statusData(over: Partial<HerdStatusData>): HerdStatusData {
  return {
    herd: { id: "hd-1", repo: "r", room: "herd-1", workspace: "w1", shepherdSession: "s", shepherdHandle: "shep", herdrSocket: null, hidden: false, status: "active", createdAt: 0, wrappedAt: null },
    jobs: [],
    unread: 0,
    lifecycleConnected: true,
    hiddenUp: null,
    subscription: { id: "sub-1", dead: false, lastDelivery: null },
    push: { state: "reachable", lastDelivery: null },
    ...over,
  };
}

function job(over: Partial<HerdStatusData["jobs"][number]>): HerdStatusData["jobs"][number] {
  return {
    herd: "hd-1", name: "job-a", worktree: "/tmp/job-a", branch: null, tree: null, pane: "w1:p1",
    agentSession: null, agentId: null, handle: "job-a", status: "active", disposable: false,
    lastGate: null, lastReport: null, createdAt: 0, updatedAt: 0,
    openGate: null, paneStatus: "idle", lastGateStatus: null, lastGateDelivery: null, lastGateConsumed: null,
    ...over,
  };
}

describe("rt herd brief", () => {
  function tmpFile(name: string, content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "rt-herd-brief-cli-"));
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  const TEMPLATE = [
    "# Job: <name>",
    "",
    "Goal: <goal>",
    "",
    "## Method",
    "",
    "<REQUIRED: describe the approach here>",
    "",
  ].join("\n");

  const STRATEGIES = ["## trivial", "", "```", "Do the trivial thing.", "```", ""].join("\n");

  test("buildBriefInputs requires --job and --template", () => {
    expect(() => buildBriefInputs([])).toThrow(/usage: rt herd brief/);
    expect(() => buildBriefInputs(["--job", "x"])).toThrow(/usage: rt herd brief/);
  });

  test("buildBriefInputs enforces --method-file xor --strategy/--strategies", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const strategies = tmpFile("s.md", STRATEGIES);
    expect(() => buildBriefInputs(["--job", "x", "--template", template])).toThrow(/pass either/);
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial", "--method-file", methodFile]),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial"]),
    ).toThrow(/pass either/); // --strategy without --strategies
    const inputs = buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial", "--strategies", strategies]);
    expect(inputs.method).toEqual({ kind: "strategy", strategies: STRATEGIES, name: "trivial" });
  });

  test("buildBriefInputs collects repeated --fill, splitting on the first '=' only", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const inputs = buildBriefInputs([
      "--job", "x", "--template", template, "--method-file", methodFile,
      "--fill", "goal=ship a=b",
      "--fill", "paths=/tmp/x",
    ]);
    expect(inputs.fills).toEqual({ goal: "ship a=b", paths: "/tmp/x" });
  });

  test("buildBriefInputs rejects a --fill with no '='", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--method-file", methodFile, "--fill", "no-equals-sign"]),
    ).toThrow(/--fill must be name=value/);
  });

  test("brief prints the assembled text plain, or as JSON with --json", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const args = ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it"];

    const plain = await run(brief, args);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("# Job: widget");
    expect(plain.stdout).toContain("Do the thing.");

    const json = await run(brief, [...args, "--json"]);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.brief).toContain("# Job: widget");
  });

  test("brief --out writes the file and always prints {ok:true,path}, --json or not", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const outPath = join(mkdtempSync(join(tmpdir(), "rt-herd-brief-out-")), "brief.md");
    const args = ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it", "--out", outPath];

    const r = await run(brief, args);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual({ ok: true, path: outPath });
    expect(readFileSync(outPath, "utf8")).toContain("# Job: widget");
  });

  test("brief exits 1 with the leftover-markers error when a slot is unfilled", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const r = await run(brief, ["--job", "widget", "--template", template, "--method-file", methodFile]); // goal unfilled
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unfilled markers: goal");
  });

  test("brief exits 1 naming available strategies on an unknown --strategy", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const strategies = tmpFile("s.md", STRATEGIES);
    const r = await run(brief, ["--job", "widget", "--template", template, "--strategy", "nope", "--strategies", strategies, "--fill", "goal=x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown strategy 'nope'; available: trivial");
  });

  test("brief exits 1 with a clear message when --out cannot be written", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const badOut = join(mkdtempSync(join(tmpdir(), "rt-herd-brief-bad-")), "no-such-dir", "brief.md");
    const r = await run(brief, ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=x", "--out", badOut]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot write --out");
  });
});

describe("renderStatus", () => {
  test("a missing subscription names its own remedy", () => {
    expect(renderStatus(statusData({ subscription: null }))).toContain("subscription MISSING (run rt herd resume)");
  });

  test("an answered gate delivered to a dead pane tells the shepherd to DM the worker", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", handle: "job-a" })] });
    expect(renderStatus(data)).toContain("answered, worker not woken: rt chat dm job-a");
  });

  test("a delivered gate carries no not-woken warning", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered" })] });
    expect(renderStatus(data)).not.toContain("worker not woken");
  });

  test("an answered, nudged gate no one has read yet prints UNCONSUMED", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered", lastGateConsumed: false })] });
    expect(renderStatus(data)).toContain("gate gt-9 UNCONSUMED");
  });

  test("a consumed gate carries no UNCONSUMED marker", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered", lastGateConsumed: true })] });
    expect(renderStatus(data)).not.toContain("UNCONSUMED");
  });

  test("nothing to consume (no last gate) carries no UNCONSUMED marker", () => {
    const data = statusData({ jobs: [job({ lastGateConsumed: null })] });
    expect(renderStatus(data)).not.toContain("UNCONSUMED");
  });

  test("a dead-pane row that is also unconsumed prints both suffixes", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", lastGateConsumed: false, handle: "job-a" })] });
    const out = renderStatus(data);
    expect(out).toContain("worker not woken");
    expect(out).toContain("gate gt-9 UNCONSUMED");
  });

  test("prints the push probe's reachability and delivery age instead of headlining dead", () => {
    const reachable = renderStatus(statusData({ push: { state: "reachable", lastDelivery: null } }));
    expect(reachable).toContain("push: reachable (last delivery never)");
    expect(reachable).not.toContain("DEAD");

    const unreachable = renderStatus(statusData({ push: { state: "unreachable", lastDelivery: { outcome: "delivered", at: Date.now() - 5 * 60_000 } } }));
    expect(unreachable).toContain("push: unreachable (last delivery 5m ago)");
  });
});
