/**
 * Pure computation of the reconciler's per-agent executor view. No I/O:
 * callers snapshot panes/agents/gates/tombstones and hand them in. The
 * sweep (a later task) owns change detection and side effects.
 */

import { realpathSync } from "node:fs";
import type { AgentRecord } from "../state/agents-store.ts";
import type { GateRow } from "./gates-store.ts";
import type { ExecutorState, ExecutorView } from "../../packages/rt-client/src/commands.ts";
import { resolveLivePane, type LivePane, type PaneHints } from "./pane-resolve-live.ts";

export interface ViewInput {
  agents: AgentRecord[];
  panes: LivePane[] | null;
  openGates: GateRow[];
  clearedAgentIds: Set<string>;
  visibleWorkspaceIds: Set<string> | null;
}

// Duplicated from pane-resolve-live.ts's normalizePath (not exported): the
// direct-match join needs the same tolerance for symlinked worktrees and
// macOS's /tmp -> /private/tmp rewrite that resolveLivePane's worktree
// layer already applies.
function normalizeWorktree(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  try {
    return realpathSync(trimmed);
  } catch {
    const isTmp = trimmed === "/tmp" || trimmed.startsWith("/tmp/");
    return process.platform === "darwin" && isTmp ? `/private${trimmed}` : trimmed;
  }
}

/** Field-layered fallback, mirroring resolveLivePane's own layering: exact
    paneId, then exact session, then a worktree match that must be unique. */
function directMatch(gate: GateRow, agents: AgentRecord[]): string | null {
  const paneId = gate.origin?.paneId || gate.pane;
  if (paneId) {
    const hit = agents.find((rec) => rec.paneId === paneId);
    if (hit) return hit.id;
  }
  if (gate.nudge?.session) {
    const hit = agents.find((rec) => rec.sessionId === gate.nudge!.session);
    if (hit) return hit.id;
  }
  if (gate.origin?.worktree) {
    const want = normalizeWorktree(gate.origin.worktree);
    const hits = agents.filter((rec) => normalizeWorktree(rec.cwd) === want);
    if (hits.length === 1) return hits[0]!.id;
  }
  return null;
}

/** Joins a gate to the agent behind it: first by resolving both the gate's
    own hints and each agent's hints to a live pane and matching on that
    pane, then falling back to direct field comparison (needed when panes
    are unreachable, or resolution is ambiguous). */
export function gateAgentId(gate: GateRow, agents: AgentRecord[], panes: LivePane[] | null): string | null {
  if (panes !== null) {
    const paneId = gate.origin?.paneId || gate.pane;
    const gateHints: PaneHints = {
      ...(paneId ? { paneId } : {}),
      ...(gate.nudge?.session ? { sessionId: gate.nudge.session } : {}),
      ...(gate.origin?.worktree ? { worktree: gate.origin.worktree } : {}),
    };
    const gatePane = resolveLivePane(gateHints, panes);
    if (gatePane) {
      const hit = agents.find((rec) => {
        const agentPane = resolveLivePane(
          { paneId: rec.paneId, sessionId: rec.sessionId, worktree: rec.cwd },
          panes,
        );
        return agentPane?.paneRef === gatePane.paneRef;
      });
      if (hit) return hit.id;
    }
  }
  return directMatch(gate, agents);
}

export function computeView(input: ViewInput, now: number): ExecutorView[] {
  const { agents, panes, openGates, clearedAgentIds, visibleWorkspaceIds } = input;

  const gatesByAgent = new Map<string, GateRow[]>();
  for (const gate of openGates) {
    const agentId = gateAgentId(gate, agents, panes);
    if (agentId === null) continue;
    const joined = gatesByAgent.get(agentId);
    if (joined) joined.push(gate);
    else gatesByAgent.set(agentId, [gate]);
  }

  return agents.map((rec) => {
    let state: ExecutorState;
    let paneRef: string | null = null;

    if (clearedAgentIds.has(rec.id)) {
      state = "cleared";
    } else if (panes === null) {
      state = "unknown";
    } else {
      const pane = resolveLivePane({ paneId: rec.paneId, sessionId: rec.sessionId, worktree: rec.cwd }, panes);
      if (!pane) {
        state = "gone";
      } else {
        paneRef = pane.paneRef;
        if (pane.agentStatus === "blocked") {
          state = "blocked";
        } else if (
          pane.paneRef.startsWith("bg:") ||
          (visibleWorkspaceIds !== null && !visibleWorkspaceIds.has(pane.workspaceId))
        ) {
          // A resolved bg-server pane is never on-screen for a human to see
          // (visible-workspace detection is the general form of this and
          // stays a follow-up -- see the design doc's "Hidden state"), so it
          // reads "hidden" unconditionally rather than waiting on that.
          state = "hidden";
        } else {
          state = "live";
        }
      }
    }

    const joinedGates = gatesByAgent.get(rec.id) ?? [];
    const subject = joinedGates[0]?.subject ?? rec.subject ?? `agent:${rec.id}`;

    return {
      agentId: rec.id,
      repo: rec.repo,
      subject,
      surface: rec.surface,
      sessionId: rec.sessionId,
      paneRef,
      state,
      since: now,
      openGateIds: joinedGates.map((g) => g.id),
    };
  });
}
