import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { statusBinPath, draftBinPath } from "../herdr.ts";

/** The board hands this path to an agent launched in the *target repo's* cwd,
    which then executes it. Both halves have to hold: the path has to exist, and
    it has to be runnable as a program. A compiled board has no source tree, so
    a path into `bin/*.ts` satisfies neither. */
/** The writer notifies a running board after writing. Pointed at a dead port so
    a developer's live board never receives a status from the test suite. */
const NO_LIVE_BOARD = { ...process.env, MR_BOARD_PORT: "1" };

describe("the status writer the board hands out", () => {
  test("is a file that exists and is executable", () => {
    for (const path of [statusBinPath(), draftBinPath()]) {
      expect(statSync(path).isFile()).toBe(true);
      expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
    }
  });

  test("writes review status when run as a subcommand, the way a launched skill runs it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "board-statusbin-"));
    const state = join(dir, "review.json");
    writeFileSync(state, JSON.stringify({ mrUrl: "https://x/mr/7", iid: 7, status: "queued" }));

    const proc = Bun.spawn([statusBinPath(), "review-status", state, "reviewing"], {
      stdout: "pipe",
      stderr: "pipe",
      env: NO_LIVE_BOARD,
    });
    expect(await proc.exited).toBe(0);

    const written = JSON.parse(readFileSync(state, "utf8")) as { status: string; iid: number };
    expect(written.status).toBe("reviewing");
    expect(written.iid).toBe(7);
  });

  test("carries the message and outcome flags through the subcommand", async () => {
    const dir = mkdtempSync(join(tmpdir(), "board-statusbin-"));
    const state = join(dir, "review.json");
    writeFileSync(state, JSON.stringify({ mrUrl: "https://x/mr/8", iid: 8, status: "reviewing" }));

    const proc = Bun.spawn(
      [statusBinPath(), "review-status", state, "done", "looks good", "--outcome", "approve"],
      { stdout: "pipe", stderr: "pipe", env: NO_LIVE_BOARD },
    );
    expect(await proc.exited).toBe(0);

    const written = JSON.parse(readFileSync(state, "utf8")) as { status: string; message: string; outcome: string };
    expect(written).toMatchObject({ status: "done", message: "looks good", outcome: "approve" });
  });

  test("rejects an unknown subcommand rather than silently doing nothing", async () => {
    const proc = Bun.spawn([statusBinPath(), "not-a-verb", "/tmp/x", "done"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    expect(code).not.toBe(0);
    expect(await new Response(proc.stderr).text()).toContain("not-a-verb");
  });
});
