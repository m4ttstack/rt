/**
 * BOARD-31: the board's gate-kit needs the gate helpers (gate-answers.ts,
 * gate-options.ts, gate-presentation.ts) without dragging in the Node-only
 * code (transport/client/settings) that the root "." export pulls in via
 * index.ts. This pins the "./gate" subpath: it must build to a fully
 * inlined, browser-safe bundle that references no Node or Bun runtime
 * surface, still exports the trio's real functions, and package.json must
 * advertise it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { GateOption, GateQuestion, GateAnswer } from "../src/gate.ts";

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

  test("dist/gate.js is fully inlined and references no Node or Bun runtime surface", () => {
    const text = readFileSync(distGate, "utf8");
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/\bprocess\b/);
    expect(text).not.toMatch(/\bBun\b/);
    expect(text).not.toMatch(/import\.meta/);
    // bun --target browser never emits `from "node:..."`: it stubs a builtin
    // to `(() => ({}))` (fs, child_process) or inlines a polyfill under a
    // `// node:<name>` header (path, os, crypto). Pin both shapes.
    expect(text).not.toContain("(() => ({}))");
    expect(text).not.toMatch(/^\/\/ (node|bun):/m);
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

  test("./gate re-exports GateOption, GateQuestion, and GateAnswer as types (compile-time check)", () => {
    // Type-only usages: if any of these three stopped being re-exported from
    // gate.ts, this file would fail to typecheck (tsc --noEmit), even though
    // nothing here runs at test time. Values erase, so dist/gate.js's inlined
    // bundle is unaffected.
    const option: GateOption = "a";
    const question: GateQuestion = { id: "q1", label: "Proceed?", multi: false, options: [] };
    const answer: GateAnswer = { answers: {}, by: "console", answeredAt: 0 };
    expect([typeof option, typeof question, typeof answer]).toEqual(["string", "object", "object"]);
  });
});
