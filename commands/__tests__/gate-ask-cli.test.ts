import { describe, expect, test } from "bun:test";
import { buildGateAskPayload } from "../gate.ts";

const Q = '[{"id":"q1","label":"go?","multi":false,"options":["yes","no"]}]';
const noEnv = {} as NodeJS.ProcessEnv;

describe("buildGateAskPayload", () => {
  test("questions parse; env supplies session and pane", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p1" } as NodeJS.ProcessEnv;
    expect(buildGateAskPayload(["--questions", Q], env)).toEqual({
      questions: [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }],
      sessionId: "sess-1",
      paneId: "w1:p1",
    });
  });
  test("explicit --subject passes through", () => {
    expect(buildGateAskPayload(["--questions", Q, "--subject", "mr:x"], noEnv).subject).toBe("mr:x");
  });
  test("RT_GATE_SUBJECT is deliberately NOT read (contract C4: the daemon ladder decides)", () => {
    const env = { RT_GATE_SUBJECT: "agent:ag-1" } as NodeJS.ProcessEnv;
    expect(buildGateAskPayload(["--questions", Q], env).subject).toBeUndefined();
  });
  test("no subject leaves the field absent (daemon ladder decides)", () => {
    expect(buildGateAskPayload(["--questions", Q], noEnv).subject).toBeUndefined();
  });
  test("context and kind pass through", () => {
    const p = buildGateAskPayload(["--questions", Q, "--context", "why", "--kind", "plan"], noEnv);
    expect(p.context).toBe("why");
    expect(p.kind).toBe("plan");
  });
  test("empty env vars are treated as unset", () => {
    const env = { CLAUDE_CODE_SESSION_ID: "", HERDR_PANE_ID: "" } as NodeJS.ProcessEnv;
    const p = buildGateAskPayload(["--questions", Q], env);
    expect(p.sessionId).toBeUndefined();
    expect(p.paneId).toBeUndefined();
  });
});
