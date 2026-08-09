import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { reviewFilePath, writeReviewState, readReviewStates } from "../review-state.ts";
import { reReviewResumePrompt } from "../herdr.ts";
import { launchReReview, type ReReviewCtx, type ReReviewIo } from "../review-launch.ts";

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const IID = 4821;

const CTX: ReReviewCtx = {
  cwd: "/repo/acme",
  workspaceLabel: "reviews",
  skill: "acme:review",
  author: "Grace Hopper",
};

let dir: string;
let resumeCalls: Array<Record<string, unknown>>;
let reviewCalls: Array<Record<string, unknown>>;

/** io wired to the real state store (in a temp dir) with fake herdr launchers, so
    the tests assert on the state files the launcher actually writes. */
function makeIo(over: Partial<ReReviewIo> = {}): ReReviewIo {
  return {
    launchResume: async (opts) => {
      resumeCalls.push(opts as unknown as Record<string, unknown>);
      return { tabId: "w1:t7", workspaceId: "w1" };
    },
    launchReview: async (opts) => {
      reviewCalls.push(opts as unknown as Record<string, unknown>);
      return { tabId: "w1:t9", workspaceId: "w1" };
    },
    reviewFilePath: (mrUrl) => reviewFilePath(mrUrl, dir),
    writeReviewState: (path, patch, now) => writeReviewState(path, patch, now),
    readReviewStates: () => readReviewStates(dir),
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rl-"));
  resumeCalls = [];
  reviewCalls = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("launchReReview: prior session on file", () => {
  beforeEach(() => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A, iid: IID, status: "done", sessionId: "sess-abc",
    });
  });

  test("resumes the session with the re-review prompt and the ⟲ tab prefix", async () => {
    const res = await launchReReview(URL_A, IID, CTX, makeIo());

    expect(res).toEqual({ kind: "resumed" });
    expect(reviewCalls).toHaveLength(0);
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0]).toMatchObject({
      mrUrl: URL_A,
      iid: IID,
      cwd: CTX.cwd,
      workspaceLabel: CTX.workspaceLabel,
      statePath: reviewFilePath(URL_A, dir),
      sessionId: "sess-abc",
      workspaceKind: "review",
      prompt: reReviewResumePrompt(IID),
      tabPrefix: "⟲",
      author: CTX.author,
    });
  });

  test("writes reviewing state, then stamps the tab it landed in", async () => {
    await launchReReview(URL_A, IID, CTX, makeIo());

    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("reviewing");
    expect(state?.tabId).toBe("w1:t7");
    expect(state?.workspaceId).toBe("w1");
    expect(state?.sessionId).toBe("sess-abc");   // preserved through the merge
  });

  test("a thrown resume leaves the review in error", async () => {
    const io = makeIo({ launchResume: async () => { throw new Error("herdr: no workspace"); } });

    const res = await launchReReview(URL_A, IID, CTX, io);

    expect(res.kind).toBe("error");
    expect(res).toMatchObject({ message: "herdr: no workspace" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("failed to launch re-review pane");
  });
});

describe("launchReReview: nothing on file", () => {
  test("launches a fresh review with the re-review framing", async () => {
    const res = await launchReReview(URL_A, IID, CTX, makeIo());

    expect(res).toEqual({ kind: "launched" });
    expect(resumeCalls).toHaveLength(0);
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]).toMatchObject({
      mrUrl: URL_A,
      iid: IID,
      cwd: CTX.cwd,
      workspaceLabel: CTX.workspaceLabel,
      statePath: reviewFilePath(URL_A, dir),
      skill: CTX.skill,
      reReview: true,
      author: CTX.author,
    });
  });

  test("writes a queued state carrying the MR identity, then stamps the tab", async () => {
    await launchReReview(URL_A, IID, CTX, makeIo());

    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("queued");
    expect(state?.mrUrl).toBe(URL_A);
    expect(state?.iid).toBe(IID);
    expect(state?.tabId).toBe("w1:t9");
    expect(state?.workspaceId).toBe("w1");
  });

  test("a state file without a sessionId still takes the fresh path", async () => {
    writeReviewState(reviewFilePath(URL_A, dir), { mrUrl: URL_A, iid: IID, status: "done" });

    const res = await launchReReview(URL_A, IID, CTX, makeIo());

    expect(res).toEqual({ kind: "launched" });
    expect(reviewCalls).toHaveLength(1);
  });

  test("a rejected launch reports the error and records it on the state file", async () => {
    const io = makeIo({ launchReview: async () => { throw new Error("herdr: could not create review tab"); } });

    const res = await launchReReview(URL_A, IID, CTX, io);

    expect(res).toEqual({ kind: "error", message: "herdr: could not create review tab" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("failed to launch re-review pane");
  });
});
