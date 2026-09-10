/**
 * `rt skills sync` -- bring a pack's compiled skills and installed plugin
 * caches current, driven against the COMPILED `dist/rt` binary in a hermetic
 * HOME with no marketplace plugins installed.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestHome, rt } from "../harness.ts";

describe("rt skills sync (e2e)", () => {
  let home: string;
  let cleanup: () => void;

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
  });

  afterAll(() => cleanup());

  test("skills sync with no packs refuses with the discovery error, exit 1", async () => {
    const res = await rt(["skills", "sync", "--pack", "acme", "--json"], { home });
    expect(res.exitCode).toBe(1);
    const payload = JSON.parse(res.stdout.trim());
    expect(payload.ok).toBe(false);
    expect(String(payload.error)).toContain("no packs discovered");
  }, 15_000);

  test("skills sync appears in skills help", async () => {
    const res = await rt(["skills", "--help"], { home });
    expect(res.stdout).toContain("sync");
  }, 15_000);
});
