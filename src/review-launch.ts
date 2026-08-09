import { launchResume, launchReview, reReviewResumePrompt } from "./herdr.ts";
import { reviewFilePath, writeReviewState, readReviewStates } from "./review-state.ts";

/** How the re-review actually started. Callers that only want the board's
    optimistic response ignore this; triage awaits it to learn whether the pane
    came up at all. */
export type ReReviewLaunch =
  | { kind: "resumed" }
  | { kind: "launched" }
  | { kind: "error"; message: string };

/** The launch settings a re-review needs from the board's config. */
export interface ReReviewCtx {
  cwd: string;
  workspaceLabel: string;
  skill: string;
  author?: string;
}

/** Seams for the herdr launchers and the review state store, so tests can drive
    the decision without spawning panes or touching the real state dir. */
export interface ReReviewIo {
  launchResume: typeof launchResume;
  launchReview: typeof launchReview;
  writeReviewState: typeof writeReviewState;
  readReviewStates: typeof readReviewStates;
  reviewFilePath: typeof reviewFilePath;
}

export const defaultReReviewIo: ReReviewIo = {
  launchResume,
  launchReview,
  writeReviewState,
  readReviewStates,
  reviewFilePath,
};

/** Start a re-review of an MR: resume the prior session if there is one, else
    launch a fresh review with the re-review framing. Unlike the board's other
    launches this awaits the pane and settles the state file before returning,
    so a caller that needs the outcome (triage) can have it; the HTTP handler
    keeps its optimistic response by calling this with `void`.

    Note this does NOT dedup against a live review. The server focuses the
    existing tab before it ever gets here, and triage refuses a nudge outright
    while a review is in flight. */
export async function launchReReview(
  mrUrl: string,
  iid: number,
  ctx: ReReviewCtx,
  io: ReReviewIo = defaultReReviewIo,
): Promise<ReReviewLaunch> {
  const existing = io.readReviewStates().get(mrUrl);
  const statePath = io.reviewFilePath(mrUrl);
  // Prior claude session on file: resume it and direct it to re-review, so
  // the agent keeps its memory of what it flagged. Otherwise launch a fresh
  // review with the re-review framing (the wrapper reads any prior report at
  // reportPath, and falls back to a normal review if the author hasn't acted).
  if (existing?.sessionId) {
    io.writeReviewState(statePath, { status: "reviewing" });
    try {
      const { tabId, workspaceId } = await io.launchResume({
        mrUrl,
        iid,
        cwd: ctx.cwd,
        workspaceLabel: ctx.workspaceLabel,
        statePath,
        sessionId: existing.sessionId,
        workspaceKind: "review",
        prompt: reReviewResumePrompt(iid),
        tabPrefix: "⟲",
        author: ctx.author,
      });
      io.writeReviewState(statePath, { status: "reviewing", tabId, workspaceId });
      return { kind: "resumed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`re-review resume failed: ${message}`);
      io.writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
      return { kind: "error", message };
    }
  }
  io.writeReviewState(statePath, { mrUrl, iid, status: "queued" });
  try {
    const { tabId, workspaceId } = await io.launchReview({
      mrUrl,
      iid,
      cwd: ctx.cwd,
      workspaceLabel: ctx.workspaceLabel,
      statePath,
      skill: ctx.skill,
      reReview: true,
      author: ctx.author,
    });
    io.writeReviewState(statePath, { status: "queued", tabId, workspaceId });
    return { kind: "launched" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`re-review launch failed: ${message}`);
    io.writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
    return { kind: "error", message };
  }
}
