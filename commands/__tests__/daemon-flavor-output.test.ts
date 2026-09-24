import { describe, test, expect } from "bun:test";
import { tupleWarning, flavorHintPath, flavorMismatchLines, stillShuttingDownLine } from "../daemon.ts";

describe("flavor-aware daemon output", () => {
  test("a daemon of the CLI's own flavor produces no warning", () => {
    expect(tupleWarning({ cliFlavor: "dev", daemon: { flavor: "dev", pid: 1 } })).toBeNull();
  });

  test("the other app's daemon answering this CLI names both flavors and the app to open", () => {
    const w = tupleWarning({ cliFlavor: "dev", daemon: { flavor: "prod", pid: 99 } })!;
    expect(w).toContain("prod daemon");
    expect(w).toContain("dev CLI");
    expect(w).toContain("pid 99");
    expect(w).toContain("mattstack-dev.app");
    expect(w).toContain("(quit it first if it is running)");
    expect(w).not.toContain("dev-mode");
  });

  test("daemon down is not a mismatch", () => {
    expect(tupleWarning({ cliFlavor: "dev", daemon: null })).toBeNull();
  });

  test("hint path follows the flavor", () => {
    expect(flavorHintPath("dev")).toContain("mattstack-dev.app");
    expect(flavorHintPath("prod")).not.toContain("mattstack-dev.app");
  });

  test("stop's mismatch line says the holder still holds the socket", () => {
    const [headline, remedy] = flavorMismatchLines("stop", { flavor: "prod", pid: 42 }, "dev");
    expect(headline).toContain("still holds rt.sock");
    expect(headline).toContain("prod");
    expect(headline).toContain("pid 42");
    expect(remedy).toStartWith("Fix: open ");
    expect(remedy).toContain("mattstack-dev.app");
    expect(remedy).toEndWith("(quit it first if it is running)");
  });

  test("start/restart's mismatch line says the holder answered, not held", () => {
    for (const op of ["start", "restart"] as const) {
      const [headline] = flavorMismatchLines(op, { flavor: "prod", pid: 7 }, "dev");
      expect(headline).toContain("answered on rt.sock");
      expect(headline).not.toContain("still holds");
    }
  });

  test("start/restart mismatch fires on an unknown-flavor holder too", () => {
    const [headline] = flavorMismatchLines("start", { flavor: "unknown flavor", pid: null }, "dev");
    expect(headline).toContain("unknown flavor");
    expect(headline).not.toContain("pid");
  });

  test("still-shutting-down line names the pid and carries no remedy", () => {
    const line = stillShuttingDownLine({ pid: 123 });
    expect(line).toContain("still shutting down");
    expect(line).toContain("pid 123");
    expect(line).not.toContain("Fix");
  });

  test("still-shutting-down line tolerates a missing pid", () => {
    expect(stillShuttingDownLine({ pid: null })).toBe("still shutting down — give it a moment");
  });
});
