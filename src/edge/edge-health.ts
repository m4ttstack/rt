import type { Health } from "../../core/discover.ts";
import { EDGE_METRICS_PORT } from "./domain.ts";

export { EDGE_METRICS_PORT };
export type EdgeState = "connected" | "disconnected" | "stopped" | "gone";

// cloudflared answers /ready with 200 while it holds ready connections and 503 with
// readyConnections 0 otherwise; a refused socket means the process is not up.
export async function readReady(fetchImpl: typeof fetch = fetch, port = EDGE_METRICS_PORT): Promise<{ up: boolean; readyConnections: number }> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json().catch(() => ({}))) as { readyConnections?: number };
    return { up: true, readyConnections: body.readyConnections ?? 0 };
  } catch {
    return { up: false, readyConnections: 0 };
  }
}

export function edgeState(i: { running: boolean; readyConnections: number; tunnelGone: boolean }): EdgeState {
  if (i.tunnelGone) return "gone";
  if (!i.running) return "stopped";
  return i.readyConnections >= 1 ? "connected" : "disconnected";
}

export function edgeHealthRow(state: EdgeState, readyConnections: number, domain: string | null): Health {
  const base = { status: null, ms: null };
  switch (state) {
    case "connected":
      return { ...base, ok: true, tone: "ok", detail: `${readyConnections} connection${readyConnections === 1 ? "" : "s"}` };
    case "disconnected":
      return { ...base, ok: false, tone: "warn", detail: "not connected to Cloudflare" };
    case "stopped":
      return { ...base, ok: false, tone: "bad", detail: "stopped" };
    case "gone":
      return { ...base, ok: false, tone: "bad", detail: "tunnel missing at Cloudflare", hint: `re-run deck domain ${domain ?? "<domain>"}` };
  }
}

interface EdgeProbe { running: boolean; tunnelGone: boolean; domain: string | null; fetchImpl?: typeof fetch }

// The metrics read is skipped when the process is down: nothing is listening.
async function probeEdge(d: EdgeProbe): Promise<{ state: EdgeState; readyConnections: number }> {
  const ready = d.running ? await readReady(d.fetchImpl) : { up: false, readyConnections: 0 };
  const state = edgeState({ running: d.running && ready.up, readyConnections: ready.readyConnections, tunnelGone: d.tunnelGone });
  return { state, readyConnections: ready.readyConnections };
}

export async function tunnelRowHealth(d: EdgeProbe): Promise<Health> {
  const { state, readyConnections } = await probeEdge(d);
  return edgeHealthRow(state, readyConnections, d.domain);
}

export async function describeEdge(d: EdgeProbe & { installed: boolean }) {
  if (!d.installed) return { state: "not-installed" as const, readyConnections: 0, detail: "tunnel service not installed" };
  const { state, readyConnections } = await probeEdge(d);
  const row = edgeHealthRow(state, readyConnections, d.domain);
  return { state, readyConnections, detail: row.detail ?? "", hint: row.hint };
}
