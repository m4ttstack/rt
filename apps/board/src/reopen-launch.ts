import { resumeAgentPane } from './agent-launch.ts';
import { launchLegacyResume } from './herdr.ts';

/** How the reopen actually started. `no-session` means nothing on file to
    resume -- the HTTP handler maps it to a 400 before dispatching. */
export type ReopenLaunch =
  | { kind: 'resumed' }
  | { kind: 'no-session' }
  | { kind: 'error'; message: string };

/** The slice of a domain's lifecycle state a reopen reads: which resume arm
    to take, and the status the write must carry forward unchanged. */
export interface ReopenableState {
  status: string;
  agentId?: string;
  sessionId?: string;
}

/** The patch a reopen writes back: the untouched status, the fresh pane ids,
    and the reopenedAt stamp that exempts the pane from the gate sweep's
    close-missed-done (see planSweep) until the next write. */
export interface ReopenStatePatch {
  status: string;
  tabId?: string;
  workspaceId?: string;
  agentId?: string;
  paneId?: string;
  reopenedAt?: number;
}

export interface ReopenCtx {
  mrUrl: string;
  iid: number;
  cwd: string;
  /** The serialized rt repo identity, threaded to the legacy launcher --
      never a bare GitLab project path. */
  repo: string;
  workspaceLabel: string;
  workspaceKind: 'review' | 'respond';
  statePath: string;
  /** First message into the resumed pane (operator note, if any). A plain
      reopen is otherwise promptless and interactive. */
  prompt?: string;
  author?: string;
  /** Tab label for the agent-daemon arm; the legacy arm builds its own from
      iid/author inside launchLegacyResume. */
  tabLabel: string;
  claudeCommand?: string;
}

/** Seams for the two resume arms and the domain's state store, so tests can
    drive the decision without spawning panes or touching real state. */
export interface ReopenIo {
  resumeAgentPane: typeof resumeAgentPane;
  launchLegacyResume: typeof launchLegacyResume;
  writeState(path: string, patch: ReopenStatePatch, now?: number): unknown;
  logError(message: string): void;
}

/** The real resume arms, for callers that add their domain's writeState and
    logError on top -- there is no complete default io, since writeState has
    no domain-free implementation. */
export const reopenLaunchers = { resumeAgentPane, launchLegacyResume };

/** Reopen a finished pane at the operator's request, without restarting its
    lifecycle: an agentId on file resumes through the rt agent daemon, a bare
    sessionId resumes the legacy way (`claude --resume`), neither is
    `no-session`. The write keeps the state's status as-is and stamps
    `reopenedAt` with the SAME clock value passed as the write's `now`, so
    reopenedAt lands equal to updatedAt -- the invariant planSweep's
    close-missed-done exemption keys on. A failed resume only logs: the state
    still describes the finished run, and there is no pane to track. */
export async function launchReopen(
  existing: ReopenableState,
  ctx: ReopenCtx,
  io: ReopenIo
): Promise<ReopenLaunch> {
  const writeReopened = (pane: Omit<ReopenStatePatch, 'status'>) => {
    const now = Date.now();
    io.writeState(
      ctx.statePath,
      { status: existing.status, ...pane, reopenedAt: now },
      now
    );
  };

  if (existing.agentId) {
    try {
      const result = await io.resumeAgentPane({
        agentId: existing.agentId,
        prompt: ctx.prompt,
        workspaceLabel: ctx.workspaceLabel,
        tabLabel: ctx.tabLabel,
      });
      if (!result.focusedExisting) {
        writeReopened({
          tabId: result.tabId,
          workspaceId: result.workspaceId,
          agentId: result.agentId,
          paneId: result.paneId,
        });
      }
      return { kind: 'resumed' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      io.logError(`${ctx.workspaceKind} resume failed: ${message}`);
      return { kind: 'error', message };
    }
  }

  if (!existing.sessionId) return { kind: 'no-session' };
  try {
    const { tabId, workspaceId } = await io.launchLegacyResume({
      mrUrl: ctx.mrUrl,
      iid: ctx.iid,
      cwd: ctx.cwd,
      repo: ctx.repo,
      workspaceLabel: ctx.workspaceLabel,
      statePath: ctx.statePath,
      sessionId: existing.sessionId,
      workspaceKind: ctx.workspaceKind,
      author: ctx.author,
      prompt: ctx.prompt,
      claudeCommand: ctx.claudeCommand,
    });
    writeReopened({ tabId, workspaceId });
    return { kind: 'resumed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.logError(`${ctx.workspaceKind} resume failed: ${message}`);
    return { kind: 'error', message };
  }
}
