import { describe, expect, test } from "bun:test";
import { BG_PREFIX, formatPaneRef, parsePaneRef } from "../src/pane-ref.ts";

describe("pane refs", () => {
  test("bare ref is visible", () => {
    expect(parsePaneRef("w1:p2")).toEqual({ server: "visible", paneId: "w1:p2" });
  });
  test("bg prefix parses and strips", () => {
    expect(parsePaneRef("bg:w1:p2")).toEqual({ server: "bg", paneId: "w1:p2" });
  });
  test("round trip: format output always parses back", () => {
    for (const server of ["visible", "bg"] as const) {
      const ref = formatPaneRef("w7A:pY", server);
      expect(parsePaneRef(ref)).toEqual({ server, paneId: "w7A:pY" });
    }
  });
  test("format visible is bare (backcompat byte-identical)", () => {
    expect(formatPaneRef("w1:p2", "visible")).toBe("w1:p2");
  });
  test("double prefix does not nest", () => {
    expect(parsePaneRef(BG_PREFIX + BG_PREFIX + "w1:p2").paneId).toBe(BG_PREFIX + "w1:p2");
  });
  // A herdr pane id is w<N>:p<N> and can never itself start with "bg:", so
  // formatting is safe to make idempotent -- callers that receive a value of
  // unknown provenance (bare id or stored ref) must not double-prefix it.
  test("format bg is idempotent on an already-formatted ref", () => {
    expect(formatPaneRef(BG_PREFIX + "w1:p2", "bg")).toBe(BG_PREFIX + "w1:p2");
  });
});
