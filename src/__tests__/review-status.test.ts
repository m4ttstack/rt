import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rc-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const CLI = join(import.meta.dir, "..", "..", "bin", "review-status.ts");

describe("review-status CLI", () => {
  test("writes status and message to the given file", async () => {
    const p = join(dir, "state.json");
    const proc = Bun.spawn(["bun", "run", CLI, p, "reviewing", "3 issues (1 critical)"]);
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.status).toBe("reviewing");
    expect(state.message).toBe("3 issues (1 critical)");
    expect(typeof state.updatedAt).toBe("number");
  });

  test("rejects an unknown status", async () => {
    const p = join(dir, "state2.json");
    const proc = Bun.spawn(["bun", "run", CLI, p, "bogus"], { stderr: "pipe" });
    const code = await proc.exited;
    expect(code).toBe(1);
  });

  test("a failed board notify does not change the exit code or the state write", async () => {
    const p = join(dir, "state3.json");
    writeFileSync(p, JSON.stringify({
      mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
      iid: 4821,
      status: "queued",
      updatedAt: 0,
    }));
    const proc = Bun.spawn(["bun", "run", CLI, p, "done", "looks solid", "--outcome", "approve"], { stderr: "pipe" });
    const code = await proc.exited;
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(p, "utf8"));
    expect(state.status).toBe("done");
    expect(state.outcome).toBe("approve");
  });
});
