import {
  dispatchPrompt, launchLegacyResume, launchReview, mrTabLabel, statusBinPath,
  type SkillPathResolver,
} from "./herdr.ts";
import { resumeAgentPane } from "./agent-launch.ts";
import { resolveSkillPath } from "./skill-path.ts";
import { reviewFilePath, reviewReportPath, writeReviewState, readReviewStates } from "./review-state.ts";

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
  /** The MR's GitLab project path (e.g. "group/project"), threaded to
      startAgentPane as `repo`. */
  repo: string;
  workspaceLabel: string;
  skill: string;
  author?: string;
  /** cswap account, --model, and --effort forwarded to launchReview's
      startAgentPane call (the board.agent.* settings). Unused on the legacy
      resume path, which takes claudeCommand below instead. */
  account?: string;
  model?: string;
  effort?: string;
  /** Verbatim claudeCommand escape hatch (config.claudeCommand), forwarded to
      the legacy resume path only -- the rt agent daemon path above has no
      field for an arbitrary shell command, so it uses account/model/effort. */
  claudeCommand?: string;
  /** Operator note from the human who launched the re-review (see operatorNoteParagraph). */
  note?: string;
}

/** Seams for the herdr launchers and the review state store, so tests can drive
    the decision without spawning panes or touching the real state dir. */
export interface ReReviewIo {
  launchLegacyResume: typeof launchLegacyResume;
  launchReview: typeof launchReview;
  resumeAgentPane: typeof resumeAgentPane;
  writeReviewState: typeof writeReviewState;
  readReviewStates: typeof readReviewStates;
  reviewFilePath: typeof reviewFilePath;
}

export const defaultReReviewIo: ReReviewIo = {
  launchLegacyResume,
  launchReview,
  resumeAgentPane,
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
    while a review is in flight.

    Resume is THREE-way: an agentId on file resumes through the rt agent
    daemon (resumeAgentPane); a bare sessionId (a state that predates rt agent
    adoption, or that raced this rollout) resumes the legacy way
    (launchLegacyResume, `claude --resume`); neither on file launches a fresh
    review with the re-review framing (the wrapper reads any prior report at
    reportPath, and falls back to a normal review if the author hasn't acted).
    Both resume arms carry the SAME re-review prompt, built once below. */
export async function launchReReview(
  mrUrl: string,
  iid: number,
  ctx: ReReviewCtx,
  io: ReReviewIo = defaultReReviewIo,
  resolvePath: SkillPathResolver = resolveSkillPath,
): Promise<ReReviewLaunch> {
  const existing = io.readReviewStates().get(mrUrl);
  const statePath = io.reviewFilePath(mrUrl);
  const prompt = await dispatchPrompt("board:review", {
    mrUrl,
    statePath,
    statusBin: statusBinPath(),
    reportPath: reviewReportPath(statePath),
    skill: ctx.skill,
    reReview: true,
    note: ctx.note,
  }, resolvePath);

  if (existing?.agentId) {
    io.writeReviewState(statePath, { status: "reviewing" });
    try {
      const result = await io.resumeAgentPane({
        agentId: existing.agentId,
        prompt,
        workspaceLabel: ctx.workspaceLabel,
        tabLabel: mrTabLabel(iid, ctx.author, "⟲"),
      });
      if (!result.focusedExisting) {
        io.writeReviewState(statePath, {
          status: "reviewing", tabId: result.tabId, workspaceId: result.workspaceId,
          agentId: result.agentId, paneId: result.paneId,
        });
      }
      return { kind: "resumed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`re-review resume failed: ${message}`);
      io.writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
      return { kind: "error", message };
    }
  }

  if (existing?.sessionId) {
    io.writeReviewState(statePath, { status: "reviewing" });
    try {
      const { tabId, workspaceId } = await io.launchLegacyResume({
        mrUrl,
        iid,
        cwd: ctx.cwd,
        repo: ctx.repo,
        workspaceLabel: ctx.workspaceLabel,
        statePath,
        sessionId: existing.sessionId,
        workspaceKind: "review",
        prompt,
        tabPrefix: "⟲",
        author: ctx.author,
        claudeCommand: ctx.claudeCommand,
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
    const result = await io.launchReview({
      mrUrl,
      iid,
      cwd: ctx.cwd,
      repo: ctx.repo,
      workspaceLabel: ctx.workspaceLabel,
      statePath,
      skill: ctx.skill,
      reReview: true,
      author: ctx.author,
      account: ctx.account,
      model: ctx.model,
      effort: ctx.effort,
      note: ctx.note,
    });
    if (!result.focusedExisting) {
      io.writeReviewState(statePath, {
        status: "queued", tabId: result.tabId, workspaceId: result.workspaceId,
        agentId: result.agentId, paneId: result.paneId,
      });
    }
    return { kind: "launched" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`re-review launch failed: ${message}`);
    io.writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
    return { kind: "error", message };
  }
}
