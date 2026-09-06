import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rps-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const CLI = join(import.meta.dir, "..", "..", "bin", "respond-status.ts");

// Port 1 needs root to bind, so a connection refusal here is deterministic --
// this pins every CLI invocation in this file off any board that might
// actually be listening on the configured port.
const NO_BOARD_ENV = { ...process.env, MR_BOARD_PORT: "1" };

async function run(...args: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { stderr: "pipe", env: NO_BOARD_ENV });
  return await proc.exited;
}

describe("respond-status CLI", () => {
  test("the existing positional form still works untouched", async () => {
    const p = join(dir, "a.json");
    expect(await run(p, "drafting", "3 threads triaged")).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.status).toBe("drafting");
    expect(state.message).toBe("3 threads triaged");
    expect(state.posted).toBeUndefined();
  });

  test("records both counts in the space-separated form", async () => {
    const p = join(dir, "b.json");
    expect(await run(p, "done", "2 fixed, 1 pushback", "--posted", "2", "--threads", "3")).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.posted).toBe(2);
    expect(state.threads).toBe(3);
    expect(state.message).toBe("2 fixed, 1 pushback");
  });

  test("records both counts in the --flag=value form", async () => {
    const p = join(dir, "c.json");
    expect(await run(p, "done", "--posted=0", "--threads=0")).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.posted).toBe(0);
    expect(state.threads).toBe(0);
  });

  test("rejects a numerator with no denominator, which would say nothing", async () => {
    const p = join(dir, "d.json");
    expect(await run(p, "done", "--posted", "2")).toBe(1);
  });

  test("rejects counts that are not non-negative integers", async () => {
    expect(await run(join(dir, "e.json"), "done", "--posted", "-1", "--threads", "3")).toBe(1);
    expect(await run(join(dir, "f.json"), "done", "--posted", "1.5", "--threads", "3")).toBe(1);
    expect(await run(join(dir, "g.json"), "done", "--posted", "two", "--threads", "3")).toBe(1);
    expect(await run(join(dir, "h.json"), "done", "--threads", "-3")).toBe(1);
  });

  test("still rejects an unknown status", async () => {
    expect(await run(join(dir, "i.json"), "bogus")).toBe(1);
  });

  // A denominator alone is merely incomplete (nothing went up), while a
  // numerator alone is uninterpretable, which is why only the latter fails.
  test("a threads count with no posted count means nothing was posted", async () => {
    const p = join(dir, "j.json");
    expect(await run(p, "done", "--threads", "3")).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.threads).toBe(3);
    expect(state.posted).toBeUndefined();
  });
});
