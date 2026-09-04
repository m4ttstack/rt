import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { reviewFilePath, writeReviewState, readReviewStates } from "../review-state.ts";
import { launchReReview, type ReReviewCtx, type ReReviewIo } from "../review-launch.ts";

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const IID = 4821;

const CTX: ReReviewCtx = {
  cwd: "/repo/acme",
  repo: "acme/webapp",
  workspaceLabel: "reviews",
  skill: "acme:review",
  author: "Grace Hopper",
};

/** No-op skill-path resolver: none of these tests exercise --skill-path
    resolution, and the default resolver would spawn a real `claude plugin
    list` process. Always inject this. */
const noSkillPath = async () => null;

let dir: string;
let resumeCalls: Array<Record<string, unknown>>;
let legacyResumeCalls: Array<Record<string, unknown>>;
let reviewCalls: Array<Record<string, unknown>>;

/** io wired to the real state store (in a temp dir) with fake launchers, so
    the tests assert on the state files the launcher actually writes. */
function makeIo(over: Partial<ReReviewIo> = {}): ReReviewIo {
  return {
    resumeAgentPane: async (opts) => {
      resumeCalls.push(opts as unknown as Record<string, unknown>);
      return { agentId: "agent-a", sessionId: "sess-new", paneId: "w1:p7", tabId: "w1:t7", workspaceId: "w1", focusedExisting: false };
    },
    launchLegacyResume: async (opts) => {
      legacyResumeCalls.push(opts as unknown as Record<string, unknown>);
      return { tabId: "w1:t7", workspaceId: "w1" };
    },
    launchReview: async (opts) => {
      reviewCalls.push(opts as unknown as Record<string, unknown>);
      return { agentId: "agent-b", sessionId: "sess-fresh", paneId: "w1:p9", tabId: "w1:t9", workspaceId: "w1", focusedExisting: false };
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
  legacyResumeCalls = [];
  reviewCalls = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("launchReReview: agentId on file (arm i -- resumeAgentPane)", () => {
  beforeEach(() => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A, iid: IID, status: "done", sessionId: "sess-old", agentId: "agent-old",
    });
  });

  test("resumes through resumeAgentPane, never launchLegacyResume, with the dispatchPrompt re-review prompt", async () => {
    const res = await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    expect(res).toEqual({ kind: "resumed" });
    expect(reviewCalls).toHaveLength(0);
    expect(legacyResumeCalls).toHaveLength(0);
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0]).toMatchObject({
      agentId: "agent-old",
      workspaceLabel: CTX.workspaceLabel,
      tabLabel: "⟲ !4821 Grace Hopper",
    });
    const prompt = resumeCalls[0]!.prompt as string;
    expect(prompt.startsWith("/board:review ")).toBe(true);
    expect(prompt).toContain("--state");
    expect(prompt).toContain("--status-bin");
    expect(prompt).toContain("--report");
    expect(prompt).toContain("--re-review");
  });

  test("writes reviewing state, then stamps the tab/agent it landed in", async () => {
    await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("reviewing");
    expect(state?.tabId).toBe("w1:t7");
    expect(state?.workspaceId).toBe("w1");
    expect(state?.agentId).toBe("agent-a");
    expect(state?.paneId).toBe("w1:p7");
    expect(state?.sessionId).toBe("sess-old"); // untouched by this merge -- resumeAgentPane's result isn't written back onto sessionId here
  });

  test("appends the operator note to the re-review prompt", async () => {
    await launchReReview(URL_A, IID, { ...CTX, note: "the schema change worries me" }, makeIo(), noSkillPath);
    expect(resumeCalls[0]!.prompt).toContain(
      "\n\nOperator note (from the human who launched this pane): the schema change worries me",
    );
  });

  test("a focusedExisting resume result leaves the state file untouched (no id overwrite)", async () => {
    const io = makeIo({
      resumeAgentPane: async (opts) => {
        resumeCalls.push(opts as unknown as Record<string, unknown>);
        return { agentId: "", sessionId: "", paneId: "", tabId: "", workspaceId: "", focusedExisting: true };
      },
    });
    const res = await launchReReview(URL_A, IID, CTX, io, noSkillPath);

    expect(res).toEqual({ kind: "resumed" });
    const state = readReviewStates(dir).get(URL_A);
    // Still the pre-existing tab/agent identity, not blanked by empty ids.
    expect(state?.agentId).toBe("agent-old");
    expect(state?.status).toBe("reviewing");
  });

  test("a thrown resume leaves the review in error", async () => {
    const io = makeIo({ resumeAgentPane: async () => { throw new Error("rt agent: unreachable"); } });

    const res = await launchReReview(URL_A, IID, CTX, io, noSkillPath);

    expect(res.kind).toBe("error");
    expect(res).toMatchObject({ message: "rt agent: unreachable" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("failed to launch re-review pane");
  });
});

describe("launchReReview: sessionId only on file, no agentId (arm ii -- launchLegacyResume)", () => {
  beforeEach(() => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A, iid: IID, status: "done", sessionId: "sess-abc",
    });
  });

  test("resumes through launchLegacyResume, never resumeAgentPane, with the SAME dispatchPrompt re-review prompt", async () => {
    const res = await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    expect(res).toEqual({ kind: "resumed" });
    expect(reviewCalls).toHaveLength(0);
    expect(resumeCalls).toHaveLength(0);
    expect(legacyResumeCalls).toHaveLength(1);
    expect(legacyResumeCalls[0]).toMatchObject({
      mrUrl: URL_A,
      iid: IID,
      cwd: CTX.cwd,
      repo: CTX.repo,
      workspaceLabel: CTX.workspaceLabel,
      statePath: reviewFilePath(URL_A, dir),
      sessionId: "sess-abc",
      workspaceKind: "review",
      tabPrefix: "⟲",
      author: CTX.author,
    });
    const prompt = legacyResumeCalls[0]!.prompt as string;
    expect(prompt.startsWith("/board:review ")).toBe(true);
    expect(prompt).toContain("--state");
    expect(prompt).toContain("--status-bin");
    expect(prompt).toContain("--report");
    expect(prompt).toContain("--re-review");
  });

  test("writes reviewing state, then stamps the tab it landed in", async () => {
    await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("reviewing");
    expect(state?.tabId).toBe("w1:t7");
    expect(state?.workspaceId).toBe("w1");
    expect(state?.sessionId).toBe("sess-abc");   // preserved through the merge
  });

  test("appends the operator note to the re-review resume prompt", async () => {
    await launchReReview(URL_A, IID, { ...CTX, note: "the schema change worries me" }, makeIo(), noSkillPath);
    expect(legacyResumeCalls[0]!.prompt).toContain(
      "\n\nOperator note (from the human who launched this pane): the schema change worries me",
    );
  });

  test("account/model/effort do not reach the legacy resume pane (plain claude)", async () => {
    await launchReReview(URL_A, IID, { ...CTX, account: "matt@example.com", model: "opus", effort: "high" }, makeIo(), noSkillPath);
    expect(legacyResumeCalls[0]).not.toHaveProperty("account");
    expect(legacyResumeCalls[0]).not.toHaveProperty("model");
    expect(legacyResumeCalls[0]).not.toHaveProperty("effort");
  });

  test("threads claudeCommand through to the legacy resume pane", async () => {
    await launchReReview(URL_A, IID, { ...CTX, claudeCommand: "cswap run 2 --" }, makeIo(), noSkillPath);
    expect(legacyResumeCalls[0]).toMatchObject({ claudeCommand: "cswap run 2 --" });
  });

  test("a thrown resume leaves the review in error", async () => {
    const io = makeIo({ launchLegacyResume: async () => { throw new Error("herdr: no workspace"); } });

    const res = await launchReReview(URL_A, IID, CTX, io, noSkillPath);

    expect(res.kind).toBe("error");
    expect(res).toMatchObject({ message: "herdr: no workspace" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("failed to launch re-review pane");
  });
});

describe("launchReReview: nothing on file (arm iii -- fresh launchReview)", () => {
  test("launches a fresh review with the re-review framing", async () => {
    const res = await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    expect(res).toEqual({ kind: "launched" });
    expect(resumeCalls).toHaveLength(0);
    expect(legacyResumeCalls).toHaveLength(0);
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]).toMatchObject({
      mrUrl: URL_A,
      iid: IID,
      cwd: CTX.cwd,
      repo: CTX.repo,
      workspaceLabel: CTX.workspaceLabel,
      statePath: reviewFilePath(URL_A, dir),
      skill: CTX.skill,
      reReview: true,
      author: CTX.author,
    });
  });

  test("threads the operator note through to the fresh launch", async () => {
    await launchReReview(URL_A, IID, { ...CTX, note: "compare against !4700" }, makeIo(), noSkillPath);
    expect(reviewCalls[0]).toMatchObject({ note: "compare against !4700" });
  });

  test("threads account/model/effort through to the fresh launch", async () => {
    await launchReReview(URL_A, IID, { ...CTX, account: "matt@example.com", model: "opus", effort: "high" }, makeIo(), noSkillPath);
    expect(reviewCalls[0]).toMatchObject({ account: "matt@example.com", model: "opus", effort: "high" });
  });

  test("writes a queued state carrying the MR identity, then stamps the tab and agent", async () => {
    await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("queued");
    expect(state?.mrUrl).toBe(URL_A);
    expect(state?.iid).toBe(IID);
    expect(state?.tabId).toBe("w1:t9");
    expect(state?.workspaceId).toBe("w1");
    expect(state?.agentId).toBe("agent-b");
    expect(state?.paneId).toBe("w1:p9");
  });

  test("a state file without a sessionId or agentId still takes the fresh path", async () => {
    writeReviewState(reviewFilePath(URL_A, dir), { mrUrl: URL_A, iid: IID, status: "done" });

    const res = await launchReReview(URL_A, IID, CTX, makeIo(), noSkillPath);

    expect(res).toEqual({ kind: "launched" });
    expect(reviewCalls).toHaveLength(1);
  });

  test("a focusedExisting fresh-launch result leaves the state file at queued with no id overwrite", async () => {
    const io = makeIo({
      launchReview: async (opts) => {
        reviewCalls.push(opts as unknown as Record<string, unknown>);
        return { agentId: "", sessionId: "", paneId: "", tabId: "", workspaceId: "", focusedExisting: true };
      },
    });
    const res = await launchReReview(URL_A, IID, CTX, io, noSkillPath);

    expect(res).toEqual({ kind: "launched" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("queued");
    expect(state?.tabId).toBeUndefined();
  });

  test("a rejected launch reports the error and records it on the state file", async () => {
    const io = makeIo({ launchReview: async () => { throw new Error("herdr: could not create review tab"); } });

    const res = await launchReReview(URL_A, IID, CTX, io, noSkillPath);

    expect(res).toEqual({ kind: "error", message: "herdr: could not create review tab" });
    const state = readReviewStates(dir).get(URL_A);
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("failed to launch re-review pane");
  });
});
