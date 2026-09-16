/**
 * BOARD-31: the board's gate-kit needs the gate helpers (gate-answers.ts,
 * gate-options.ts, gate-presentation.ts) without dragging in commands.ts's
 * Node-only neighbors that the root "." export pulls into a browser bundle.
 * This pins the "./gate" subpath: it must build to a browser-safe bundle
 * (no `process.` reference, no `node:` import) that still exports the
 * trio's real functions, and package.json must advertise it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const pkgDir = join(import.meta.dir, "..");
const distGate = join(pkgDir, "dist", "gate.js");

describe("./gate subpath export", () => {
  test("package.json exports map carries ./gate with types and import/default conditions", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const entry = pkg.exports["./gate"];
    expect(entry).toBeDefined();
    expect(entry.types).toBe("./dist/gate.d.ts");
    expect(entry.import).toBe("./dist/gate.js");
    expect(entry.default).toBe("./dist/gate.js");
  });

  test("dist/gate.js exists after a build", () => {
    expect(() => readFileSync(distGate, "utf8")).not.toThrow();
  });

  test("dist/gate.js's built text contains no process. reference and no node: import specifier", () => {
    const text = readFileSync(distGate, "utf8");
    expect(text).not.toContain("process.");
    expect(text).not.toMatch(/from\s+["']node:/);
    expect(text).not.toMatch(/require\(["']node:/);
  });

  test("dist/gate.js exports the trio's functions and they run browser-side", async () => {
    const mod = await import(distGate);
    expect(typeof mod.unwrapGateAnswerValue).toBe("function");
    expect(typeof mod.validateGateAnswers).toBe("function");
    expect(typeof mod.normalizeGateOptions).toBe("function");
    expect(typeof mod.normalizeGateQuestions).toBe("function");
    expect(typeof mod.gatePresentation).toBe("function");
    expect(typeof mod.gateOptionValue).toBe("function");
    expect(typeof mod.gateOptionLabel).toBe("function");

    expect(mod.normalizeGateOptions(["a"])).toEqual([{ value: "a", label: "A" }]);
    expect(mod.gatePresentation({ questions: [] })).toBe("wait");
    expect(mod.gateOptionValue("a")).toBe("a");
    expect(mod.gateOptionLabel({ value: "a", label: "A" })).toBe("A");
  });
});
