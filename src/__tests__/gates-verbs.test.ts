import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gateOpen, gateWait, gateAnswer, parseWaitMaxMs, type GateVerbIo } from "../gates/verbs.ts";
import { statusBinPath } from "../herdr.ts";
import type { ReviewState } from "../review-state.ts";
import type { RespondState } from "../respond-state.ts";
import type { DoctorState } from "../doctor-state.ts";
import type { Commands, GateRow, RtResponse } from "@mattstack/rt-client";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const IID = 4821;

const QUESTIONS = [
  { id: "tiers", label: "Which tiers?", multi: true, options: ["nit", "must-fix"] },
  { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
];

/** Fills in every GateRow field a fixture doesn't care about, so each test
    only spells the fields its assertions actually depend on. */
function gateRow(overrides: Partial<GateRow> & { id: string }): GateRow {
  return {
    subject: `mr:${MR_URL}`,
    kind: "review-post",
    questions: QUESTIONS,
    meta: null,
    status: "open",
    answer: null,
    openedAt: 1000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    ...overrides,
  };
}

interface FakeIoCalls {
  gateOpen: Array<Commands["gate:open"]["payload"]>;
  gateWait: Array<Commands["gate:wait"]["payload"]>;
  gateAnswer: Array<Commands["gate:answer"]["payload"]>;
}

function fakeIo(overrides: {
  openResult?: RtResponse<Commands["gate:open"]["data"]>;
  waitResults?: Array<RtResponse<Commands["gate:wait"]["data"]>>;
  answerResult?: RtResponse<Commands["gate:answer"]["data"]>;
  /** Advances the fake clock by this much per gateWait call (0 = frozen). */
  msPerWait?: number;
} = {}): { io: GateVerbIo; calls: FakeIoCalls } {
  const calls: FakeIoCalls = { gateOpen: [], gateWait: [], gateAnswer: [] };
  const waitResults = overrides.waitResults ?? [];
  let waitIdx = 0;
  let clock = 0;
  const io: GateVerbIo = {
    now: () => clock,
    gateOpen: async (payload) => {
      calls.gateOpen.push(payload);
      return overrides.openResult ?? { ok: true, data: { id: "gate-1", supersededId: null } };
    },
    gateWait: async (payload) => {
      calls.gateWait.push(payload);
      clock += overrides.msPerWait ?? 0;
      const res = waitResults[Math.min(waitIdx, waitResults.length - 1)]!;
      waitIdx++;
      return res;
    },
    gateAnswer: async (payload) => {
      calls.gateAnswer.push(payload);
      return overrides.answerResult ?? { ok: true, data: { row: gateRow({ id: payload.id }) } };
    },
  };
  return { io, calls };
}

let dir: string;
let statePath: string;

function writeState(patch: Partial<ReviewState> = {}): void {
  writeFileSync(
    statePath,
    JSON.stringify({
      mrUrl: MR_URL,
      iid: IID,
      status: "reviewing",
      agentId: "agent-1",
      sessionId: "session-1",
      paneId: "pane-1",
      tabId: "tab-1",
      startedAt: 1,
      updatedAt: 1,
      ...patch,
    }),
  );
}

function readState(): ReviewState {
  return JSON.parse(readFileSync(statePath, "utf8")) as ReviewState;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gv-"));
  statePath = join(dir, "review.json");
  writeState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("gateOpen", () => {
  test("calls the facility with subject mr:<url>, kind review-post, no nudge, and an !<iid> label", async () => {
    const { io, calls } = fakeIo();

    const gateId = await gateOpen(statePath, "review-post", JSON.stringify(QUESTIONS), io);

    expect(gateId).toBe("gate-1");
    expect(calls.gateOpen.length).toBe(1);
    const payload = calls.gateOpen[0]!;
    expect(payload.subject).toBe(`mr:${MR_URL}`);
    expect(payload.kind).toBe("review-post");
    expect(payload.questions).toEqual(QUESTIONS);
    expect(payload.meta).toEqual({ label: `review gate !${IID}` });
    expect(payload.nudge).toBeUndefined();
    expect(payload.agent).toBeUndefined();
    expect(payload.pane).toBeUndefined();
  });

  test("persists the returned gateId and gateKind onto review state, leaving other fields untouched", async () => {
    const { io } = fakeIo({ openResult: { ok: true, data: { id: "gate-xyz", supersededId: null } } });

    await gateOpen(statePath, "review-post", JSON.stringify(QUESTIONS), io);

    const state = readState();
    expect(state.gateId).toBe("gate-xyz");
    expect(state.gateKind).toBe("review-post");
    expect(state.mrUrl).toBe(MR_URL);
    expect(state.status).toBe("reviewing");
    expect(state.agentId).toBe("agent-1");
  });

  test("malformed --questions JSON throws rather than calling the facility", async () => {
    const { io, calls } = fakeIo();

    await expect(gateOpen(statePath, "review-post", "{ not valid json", io)).rejects.toThrow();

    expect(calls.gateOpen.length).toBe(0);
  });

  test("an unrecognized kind throws rather than calling the facility", async () => {
    const { io, calls } = fakeIo();

    await expect(gateOpen(statePath, "mystery-kind", JSON.stringify(QUESTIONS), io)).rejects.toThrow(/unrecognized kind/);

    expect(calls.gateOpen.length).toBe(0);
  });

  test("a facility failure throws loudly instead of writing a gateId", async () => {
    const { io } = fakeIo({ openResult: { ok: false, error: "daemon unreachable" } });

    await expect(gateOpen(statePath, "review-post", JSON.stringify(QUESTIONS), io)).rejects.toThrow(/daemon unreachable/);
    expect(readState().gateId).toBeUndefined();
  });

  test("gateId survives an interleaving reviewing-status write (the merge-list trap)", async () => {
    const { io } = fakeIo({ openResult: { ok: true, data: { id: "gate-survives", supersededId: null } } });
    const { writeReviewState } = await import("../review-state.ts");

    await gateOpen(statePath, "review-post", JSON.stringify(QUESTIONS), io);
    expect(readState().gateId).toBe("gate-survives");

    // An unrelated status write (e.g. a resume) that doesn't mention gateId
    // must not clobber it -- gateId has to be on writeReviewState's explicit
    // merge-field list, not just settable by the one call that minted it.
    writeReviewState(statePath, { status: "reviewing", paneId: "pane-2" });
    expect(readState().gateId).toBe("gate-survives");

    const { io: waitIo, calls: waitCalls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: { status: "answered", row: gateRow({ id: "gate-survives", status: "answered", answer: { answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 9000 } }) },
        },
      ],
    });
    const result = await gateWait(statePath, waitIo);

    expect(waitCalls.gateWait[0]!.id).toBe("gate-survives");
    expect(result).toEqual({ status: "answered", answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 9000 });
  });
});

describe("gateOpen: label and writer by kind's domain", () => {
  test("a respond-plan open labels 'respond gate !<iid>' and persists gateId/gateKind onto respond state", async () => {
    const respondPath = join(dir, "respond.json");
    writeFileSync(
      respondPath,
      JSON.stringify({ mrUrl: MR_URL, iid: IID, status: "implementing", agentId: "agent-1", startedAt: 1, updatedAt: 1 }),
    );
    const { io, calls } = fakeIo({ openResult: { ok: true, data: { id: "gate-respond", supersededId: null } } });

    const gateId = await gateOpen(respondPath, "respond-plan", JSON.stringify(QUESTIONS), io);

    expect(gateId).toBe("gate-respond");
    expect(calls.gateOpen[0]!.meta).toEqual({ label: `respond gate !${IID}` });
    const respondState = JSON.parse(readFileSync(respondPath, "utf8")) as RespondState;
    expect(respondState.gateId).toBe("gate-respond");
    expect(respondState.gateKind).toBe("respond-plan");
    expect(respondState.status).toBe("implementing");
    // The respond-only fields on the file before this open must survive the
    // write untouched -- proof gateOpen went through writeRespondState's own
    // merge list, not a review-shaped one that would silently drop them.
    expect(respondState.agentId).toBe("agent-1");
  });

  test("a doctor-escalation open labels 'doctor gate !<iid>' and persists gateId/gateKind onto doctor state", async () => {
    const doctorPath = join(dir, "doctor.json");
    writeFileSync(
      doctorPath,
      JSON.stringify({ mrUrl: MR_URL, iid: IID, status: "fixing", origin: "manual", startedAt: 1, updatedAt: 1 }),
    );
    const { io, calls } = fakeIo({ openResult: { ok: true, data: { id: "gate-doctor", supersededId: null } } });

    const gateId = await gateOpen(doctorPath, "doctor-escalation", JSON.stringify(QUESTIONS), io);

    expect(gateId).toBe("gate-doctor");
    expect(calls.gateOpen[0]!.meta).toEqual({ label: `doctor gate !${IID}` });
    const doctorState = JSON.parse(readFileSync(doctorPath, "utf8")) as DoctorState;
    expect(doctorState.gateId).toBe("gate-doctor");
    expect(doctorState.gateKind).toBe("doctor-escalation");
    expect(doctorState.status).toBe("fixing");
    expect(doctorState.origin).toBe("manual");
  });
});

describe("gateWait", () => {
  test("returns the answer once the facility reports answered", async () => {
    writeState({ gateId: "gate-42" });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: "answered",
            row: gateRow({ id: "gate-42", status: "answered", answer: { answers: { tiers: [], outcome: "approve" }, by: "board-ui", answeredAt: 3000 } }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ status: "answered", answers: { tiers: [], outcome: "approve" }, by: "board-ui", answeredAt: 3000 });
    expect(calls.gateWait.length).toBe(1);
    expect(calls.gateWait[0]!.id).toBe("gate-42");
  });

  test("registry-status-first: an already-answered gate returns on the first call, no extra looping", async () => {
    writeState({ gateId: "gate-preanswered" });
    const { io, calls } = fakeIo({
      waitResults: [
        {
          ok: true,
          data: {
            status: "answered",
            row: gateRow({ id: "gate-preanswered", status: "answered", answer: { answers: { tiers: ["must-fix"], outcome: "comment" }, by: "board-ui", answeredAt: 2000 } }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ status: "answered", answers: { tiers: ["must-fix"], outcome: "comment" }, by: "board-ui", answeredAt: 2000 });
    expect(calls.gateWait.length).toBe(1);
  });

  test("a timeout re-enters the wait until an answer lands", async () => {
    writeState({ gateId: "gate-looped" });
    const { io, calls } = fakeIo({
      waitResults: [
        { ok: true, data: { status: "timeout" } },
        { ok: true, data: { status: "timeout" } },
        {
          ok: true,
          data: {
            status: "answered",
            row: gateRow({ id: "gate-looped", status: "answered", answer: { answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 4000 } }),
          },
        },
      ],
    });

    const result = await gateWait(statePath, io);

    expect(result).toEqual({ status: "answered", answers: { tiers: ["nit"], outcome: "comment" }, by: "board-ui", answeredAt: 4000 });
    expect(calls.gateWait.length).toBe(3);
    expect(calls.gateWait.every((p) => p.id === "gate-looped")).toBe(true);
  });

  test("timeouts past the bounded window return pending instead of looping forever", async () => {
    writeState({ gateId: "gate-slow" });
    const { io, calls } = fakeIo({
      waitResults: [{ ok: true, data: { status: "timeout" } }],
      msPerWait: 40_000,
    });

    const result = await gateWait(statePath, io, 90_000);

    expect(result).toEqual({ status: "pending" });
    // 40s + 40s < 90s deadline, third call crosses it: exactly 3 re-entries.
    expect(calls.gateWait.length).toBe(3);
    // The remaining budget rides into each facility poll, so a single
    // long-poll can never overshoot the window.
    expect(calls.gateWait.map((p) => p.waitMs)).toEqual([90_000, 50_000, 10_000]);
  });

  test("a custom max window bounds the wait", async () => {
    writeState({ gateId: "gate-quick-window" });
    const { io, calls } = fakeIo({
      waitResults: [{ ok: true, data: { status: "timeout" } }],
      msPerWait: 30_000,
    });

    const result = await gateWait(statePath, io, 25_000);

    expect(result).toEqual({ status: "pending" });
    expect(calls.gateWait.length).toBe(1);
    expect(calls.gateWait[0]!.waitMs).toBe(25_000);
  });

  test("parseWaitMaxMs: absent defaults, valid parses, junk and bare flags reject", () => {
    expect(parseWaitMaxMs([])).toBeUndefined();
    expect(parseWaitMaxMs(["--max-ms", "30000"])).toBe(30_000);
    expect(parseWaitMaxMs(["--max-ms=45000"])).toBe(45_000);
    for (const argv of [["--max-ms", "abc"], ["--max-ms", "Infinity"], ["--max-ms", "-5"], ["--max-ms", "0"], ["--max-ms"], ["--max-ms="]]) {
      expect(() => parseWaitMaxMs(argv)).toThrow("finite positive");
    }
  });

  test("a closed gate surfaces as a clean terminal error instead of hanging", async () => {
    writeState({ gateId: "gate-closed" });
    const { io } = fakeIo({
      waitResults: [
        { ok: true, data: { status: "closed", row: gateRow({ id: "gate-closed", status: "closed", closedReason: "superseded" }) } },
      ],
    });

    await expect(gateWait(statePath, io)).rejects.toThrow(/closed/);
  });

  test("a facility failure fails loudly instead of treating it as absence", async () => {
    writeState({ gateId: "gate-fail" });
    const { io } = fakeIo({ waitResults: [{ ok: false, error: "daemon unreachable" }] });

    await expect(gateWait(statePath, io)).rejects.toThrow(/daemon unreachable/);
  });

  test("no gateId on review state throws rather than waiting on nothing", async () => {
    const { io } = fakeIo();

    await expect(gateWait(statePath, io)).rejects.toThrow(/no gate open/);
  });
});

describe("gateAnswer", () => {
  test("calls gate:answer with by: pane and reports no conflict on a clean win", async () => {
    writeState({ gateId: "gate-pane" });
    const { io, calls } = fakeIo({
      answerResult: { ok: true, data: { row: gateRow({ id: "gate-pane", status: "answered", answer: { answers: { tiers: ["must-fix"], outcome: "approve" }, by: "pane", answeredAt: 6000 } }) } },
    });

    const result = await gateAnswer(statePath, JSON.stringify({ tiers: ["must-fix"], outcome: "approve" }), "pane", io);

    expect(calls.gateAnswer.length).toBe(1);
    expect(calls.gateAnswer[0]).toEqual({ id: "gate-pane", answers: { tiers: ["must-fix"], outcome: "approve" }, by: "pane" });
    expect(result).toEqual({ conflict: false, answers: { tiers: ["must-fix"], outcome: "approve" }, by: "pane", answeredAt: 6000 });
  });

  test("a CAS-lost answer reports conflict and returns the winning row's answer, not the loser's", async () => {
    writeState({ gateId: "gate-race" });
    const { io } = fakeIo({
      answerResult: {
        ok: true,
        data: {
          conflict: true,
          row: gateRow({ id: "gate-race", status: "answered", answer: { answers: { tiers: [], outcome: "comment" }, by: "board-ui", answeredAt: 5500 } }),
        },
      },
    });

    const result = await gateAnswer(statePath, JSON.stringify({ tiers: ["must-fix"], outcome: "approve" }), "pane", io);

    expect(result).toEqual({ conflict: true, answers: { tiers: [], outcome: "comment" }, by: "board-ui", answeredAt: 5500 });
  });

  test("no gateId on review state throws rather than answering nothing", async () => {
    const { io } = fakeIo();

    await expect(gateAnswer(statePath, JSON.stringify({}), "pane", io)).rejects.toThrow(/no gate open/);
  });
});

describe("bin/gate.ts malformed --questions", () => {
  test("exits nonzero with a stderr message, without ever reaching the facility", async () => {
    const proc = Bun.spawn(
      [statusBinPath(), "gate", "open", statePath, "--kind", "review-post", "--questions", "{ not valid json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).not.toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe("bin/gate.ts missing --kind", () => {
  test("exits nonzero with a usage message, without ever reaching the facility", async () => {
    const proc = Bun.spawn(
      [statusBinPath(), "gate", "open", statePath, "--questions", JSON.stringify(QUESTIONS)],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).not.toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain("usage: gate open");
    expect(stderr).toContain("--kind");
  });
});
