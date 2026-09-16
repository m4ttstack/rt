import type { herdrRequest } from "../herdr/client.ts";

export interface PaneStatusRow { agent: string | null; status: string | null }

/** Keyed on the bare pane id. A pane herdr does not list is simply absent
    from the map, which is what separates "this pane is gone (or herdr is)"
    from "this pane is up with no claude on it" -- the second is a dead
    worker behind a surviving shell, and the first is not evidence of
    anything. */
export async function paneStatuses(herdr: typeof herdrRequest, socket: string | null): Promise<Map<string, PaneStatusRow>> {
  const out = new Map<string, PaneStatusRow>();
  const snap = await herdr<{ snapshot?: { panes?: Array<{ pane_id: string; agent?: string; agent_status?: string }> } }>("session.snapshot", {}, socket ? { sockPath: socket } : {});
  if (!snap.ok) return out;
  // An ok reply's shape is still herdr's to get wrong: a malformed body
  // here must degrade to an empty map, never throw through a caller.
  const panes = snap.result?.snapshot?.panes;
  if (!Array.isArray(panes)) return out;
  for (const p of panes) if (p?.pane_id) out.set(p.pane_id, { agent: p.agent ?? null, status: p.agent_status ?? null });
  return out;
}
