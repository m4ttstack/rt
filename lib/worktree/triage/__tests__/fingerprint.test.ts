import { describe, test, expect } from "bun:test";
import { dirtHash, keepStillHolds, sameFingerprint } from "../fingerprint.ts";

const fp = { headSha: "a1", dirtHash: dirtHash(["x.ts"]), mrState: "closed" };

describe("fingerprint", () => {
  test("dirt hash ignores order", () => {
    expect(dirtHash(["b", "a"])).toBe(dirtHash(["a", "b"]));
    expect(dirtHash([])).not.toBe(dirtHash(["a"]));
  });

  test("any field change breaks the fingerprint", () => {
    expect(sameFingerprint(fp, { ...fp })).toBe(true);
    expect(sameFingerprint(fp, { ...fp, headSha: "a2" })).toBe(false);
    expect(sameFingerprint(fp, { ...fp, dirtHash: dirtHash(["y.ts"]) })).toBe(false);
    expect(sameFingerprint(fp, { ...fp, mrState: "opened" })).toBe(false);
  });

  test("a keep holds only while the tree is unchanged", () => {
    const kept = { keptAt: "2026-09-24T00:00:00Z", ...fp };
    expect(keepStillHolds(kept, fp)).toBe(true);
    expect(keepStillHolds(kept, { ...fp, headSha: "new" })).toBe(false);
    expect(keepStillHolds(kept, { ...fp, dirtHash: dirtHash([]) })).toBe(false);
    expect(keepStillHolds(kept, { ...fp, mrState: "opened" })).toBe(false);
  });
});
