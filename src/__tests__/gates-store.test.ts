import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  gateFilePath,
  writeGateState,
  readGateStates,
  pruneGateStates,
  type GateState,
} from "../gates/store.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gs-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const URL_B = "https://gitlab.com/acme/webapp/-/merge_requests/1";

const baseGate: GateState = {
  gateId: "gate-1",
  mrUrl: URL_A,
  iid: 4821,
  kind: "review-post",
  status: "open",
  openedAt: 1000,
  questions: [{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }],
};

describe("gateFilePath", () => {
  test("is deterministic and lives under the dir, same slug scheme as reviewFilePath", () => {
    expect(gateFilePath(URL_A, dir)).toBe(gateFilePath(URL_A, dir));
    expect(gateFilePath(URL_A, dir).startsWith(dir)).toBe(true);
    expect(gateFilePath(URL_A, dir).endsWith(".json")).toBe(true);
  });
});

describe("writeGateState / readGateStates round-trip", () => {
  test("writes then reads back the same GateState", () => {
    const p = gateFilePath(URL_A, dir);
    writeGateState(p, baseGate);
    const map = readGateStates(dir);
    expect(map.get(URL_A)).toEqual(baseGate);
  });
});

describe("writeGateState merge-patch", () => {
  test("a second write with a partial patch updates only those fields, keeps the rest", () => {
    const p = gateFilePath(URL_A, dir);
    writeGateState(p, baseGate);
    writeGateState(p, { gateId: "gate-1", status: "answered", answeredAt: 2000, answers: { q1: "yes" }, answeredBy: "board-ui" });
    const map = readGateStates(dir);
    const state = map.get(URL_A);
    expect(state?.status).toBe("answered");
    expect(state?.answeredAt).toBe(2000);
    expect(state?.answers).toEqual({ q1: "yes" });
    expect(state?.answeredBy).toBe("board-ui");
    // preserved from the original write
    expect(state?.mrUrl).toBe(URL_A);
    expect(state?.iid).toBe(4821);
    expect(state?.kind).toBe("review-post");
    expect(state?.openedAt).toBe(1000);
    expect(state?.questions).toEqual(baseGate.questions);
  });
});

describe("pruneGateStates", () => {
  test("keeps on-board MRs and deletes off-board ones", () => {
    writeGateState(gateFilePath(URL_A, dir), baseGate);
    writeGateState(gateFilePath(URL_B, dir), { ...baseGate, gateId: "gate-2", mrUrl: URL_B, iid: 1 });

    pruneGateStates(new Set([URL_A]), dir);

    expect(existsSync(gateFilePath(URL_A, dir))).toBe(true);
    expect(existsSync(gateFilePath(URL_B, dir))).toBe(false);
  });
});

describe("readGateStates", () => {
  test("skips an unparseable file without throwing", () => {
    writeGateState(gateFilePath(URL_A, dir), baseGate);
    writeFileSync(join(dir, "garbage.json"), "{ not valid json ][");
    expect(() => readGateStates(dir)).not.toThrow();
    const map = readGateStates(dir);
    expect(map.size).toBe(1);
    expect(map.get(URL_A)).toEqual(baseGate);
  });

  test("returns empty map when dir is missing", () => {
    expect(readGateStates(join(dir, "nope")).size).toBe(0);
  });
});
