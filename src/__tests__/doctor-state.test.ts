import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeDoctorState } from "../doctor-state.ts";

describe("doctor state origin", () => {
  test("origin persists across subsequent patches", () => {
    const path = join(mkdtempSync(join(tmpdir(), "doc-")), "s.json");
    writeDoctorState(path, { mrUrl: "https://x/mr/1", iid: 1, status: "queued", origin: "auto" });
    const next = writeDoctorState(path, { status: "diagnosing" });
    expect(next.origin).toBe("auto");
  });
});

describe("doctor state gate fields (merge-list widening)", () => {
  test("gateId, gateKind, and resumedGateId all persist across subsequent patches", () => {
    const path = join(mkdtempSync(join(tmpdir(), "doc-")), "s.json");
    writeDoctorState(path, { mrUrl: "https://x/mr/1", iid: 1, status: "fixing", gateId: "gate-1", gateKind: "doctor-escalation" });
    const next = writeDoctorState(path, { status: "fixing", tabId: "w1:t1" });
    expect(next.gateId).toBe("gate-1");
    expect(next.gateKind).toBe("doctor-escalation");

    const answered = writeDoctorState(path, { status: "fixing", resumedGateId: "gate-1" });
    expect(answered.resumedGateId).toBe("gate-1");
  });
});
