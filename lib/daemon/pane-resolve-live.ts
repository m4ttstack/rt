import { realpathSync } from "node:fs";
import { herdrRequest, herdrSocketPath } from "../herdr/client.ts";
import { bgSocketPath } from "./bg-service.ts";
import type { HerdrSnapshot } from "./handlers/pane.ts";

export interface PaneHints { paneId?: string; sessionId?: string; worktree?: string }
export interface LivePane {
  paneRef: string; sockPath: string; workspaceId: string;
  agentStatus: "idle" | "working" | "blocked" | "done" | "unknown";
  cwd?: string; sessionId?: string;
}

function normalizePath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  try { return realpathSync(trimmed); } catch {
    const isTmp = trimmed === "/tmp" || trimmed.startsWith("/tmp/");
    return process.platform === "darwin" && isTmp ? `/private${trimmed}` : trimmed;
  }
}

/** paneId, then agent-session id, then unique normalized cwd. Null on miss
    or ambiguity: a wrong pane is worse than no pane. Exact-socket semantics:
    "bg:" hints match only "bg:" paneRefs, bare hints match only bare paneRefs. */
export function resolveLivePane(hints: PaneHints, panes: LivePane[]): LivePane | null {
  if (hints.paneId) {
    if (hints.paneId.startsWith("bg:")) {
      const hit = panes.find((p) => p.paneRef === hints.paneId);
      if (hit) return hit;
    } else {
      const hit = panes.find((p) => !p.paneRef.startsWith("bg:") && p.paneRef === hints.paneId);
      if (hit) return hit;
    }
  }
  if (hints.sessionId) {
    const hit = panes.find((p) => p.sessionId === hints.sessionId);
    if (hit) return hit;
  }
  if (hints.worktree) {
    const want = normalizePath(hints.worktree);
    const hits = panes.filter((p) => p.cwd !== undefined && normalizePath(p.cwd) === want);
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

/** Snapshot every herdr server (main + bg). Null when no server answers. */
export async function snapshotPanes(): Promise<LivePane[] | null> {
  const servers = [
    { sockPath: herdrSocketPath(), prefix: "" },
    { sockPath: bgSocketPath(), prefix: "bg:" },
  ];
  const out: LivePane[] = [];
  let reachable = false;
  for (const { sockPath, prefix } of servers) {
    const res = await herdrRequest<{ snapshot: HerdrSnapshot }>(
      "session.snapshot", {}, { sockPath },
    );
    if (!res.ok) continue;
    reachable = true;
    for (const p of res.result.snapshot.panes) {
      const sess = p.agent_session as { kind?: string; value?: string } | undefined;
      out.push({
        paneRef: `${prefix}${String(p.pane_id)}`,
        sockPath,
        workspaceId: p.workspace_id,
        agentStatus: (p.agent_status as LivePane["agentStatus"]) ?? "unknown",
        ...(typeof p.cwd === "string" ? { cwd: p.cwd } : {}),
        ...(sess?.kind === "id" && typeof sess.value === "string" ? { sessionId: sess.value } : {}),
      });
    }
  }
  return reachable ? out : null;
}
