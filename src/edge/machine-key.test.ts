import { expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "machine-key-"));
  process.env.HOME = home;
});

const { machineKey, mintTunnelName, randomSuffix } = await import("./machine-key.ts");

test("machineKey honors ~/.mattstack/machine-key when it is a safe segment", () => {
  mkdirSync(join(home, ".mattstack"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "machine-key"), "studio-mac\n");
  expect(machineKey()).toBe("studio-mac");
});

test("machineKey falls back to a hostname slug: lowercase, no .local, safe chars", () => {
  const k = machineKey();
  expect(k).toMatch(/^[a-z0-9-]+$/);
  expect(k.endsWith(".local")).toBe(false);
});

test("randomSuffix is 6 lowercase base36 chars and varies", () => {
  const a = randomSuffix(), b = randomSuffix();
  expect(a).toMatch(/^[a-z0-9]{6}$/);
  expect(a === b).toBe(false);
});

test("mintTunnelName composes the readable key with the injected suffix", () => {
  mkdirSync(join(home, ".mattstack"), { recursive: true });
  writeFileSync(join(home, ".mattstack", "machine-key"), "mbp");
  expect(mintTunnelName(() => "abc123")).toBe("deck-edge-mbp-abc123");
});
