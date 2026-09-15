import { describe, expect, test } from "bun:test";
import { GATE_FORM_OPTION_CAP, gatePresentation } from "../src/gate-presentation.ts";
import type { GateQuestion } from "../src/commands.ts";

const q = (n: number): GateQuestion => ({
  id: "q1", label: "pick", multi: false,
  options: Array.from({ length: n }, (_, i) => `opt${i}`),
});

describe("gatePresentation", () => {
  test("cap is 4", () => expect(GATE_FORM_OPTION_CAP).toBe(4));
  test("form when pane + session + all questions at or under cap", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(4), q(2)] })).toBe("form");
  });
  test("wait when any question exceeds the cap", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(5)] })).toBe("wait");
  });
  test("wait without a pane", () => {
    expect(gatePresentation({ sessionId: "s", questions: [q(2)] })).toBe("wait");
  });
  test("wait without a session", () => {
    expect(gatePresentation({ paneId: "w1:p1", questions: [q(2)] })).toBe("wait");
  });
  test("zero-option questions never force wait", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(0)] })).toBe("form");
  });
});
