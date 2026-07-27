/**
 * The board's rt daemon client — the only file that knows rt's transport.
 *
 * Commands go over HTTP on the daemon's unix socket (`~/.rt/rt.sock`):
 * POST http://localhost/<cmd> with a JSON payload, response envelope
 * `{ ok, data?, error? }`. Push events come from the daemon's WebSocket
 * relay on 127.0.0.1:9401 (`{ type, data, timestamp }` frames).
 *
 * Every read degrades to `{ ok: false, error }` instead of throwing, so
 * callers surface daemon-down/grant-missing verbatim in `fetchError`.
 */
import { homedir } from "os";
import { join } from "path";
import type { PullRequest, MRDetail } from "@workforge/glance-sdk";

export type Discussion = MRDetail["discussions"][number];

export interface RtResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ProjectMRsData {
  mrs: Record<string, { pr: PullRequest; fetchedAt: number }>;
  listSyncedAt: number;
  source: "poll" | "events" | "mutation";
  syncedAt: number;
}

export interface DiscussionsData {
  discussions: Discussion[];
  fetchedAt: number;
  stale?: boolean;
}

export interface RtClientOptions {
  sockPath?: string;
  wsUrl?: string;
}

const DEFAULT_SOCK = join(homedir(), ".rt", "rt.sock");
const DEFAULT_WS_URL = "ws://127.0.0.1:9401/ws";

export async function rtCommand<T = unknown>(
  cmd: string,
  payload: Record<string, unknown>,
  opts: { sockPath?: string; timeoutMs?: number } = {},
): Promise<RtResponse<T>> {
  const sockPath = opts.sockPath ?? DEFAULT_SOCK;
  try {
    const res = await fetch(`http://localhost/${cmd}`, {
      unix: sockPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      // Bun's `unix` fetch option isn't in the standard RequestInit type.
    } as RequestInit);
    return (await res.json()) as RtResponse<T>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `rt daemon unreachable at ${sockPath}: ${msg}` };
  }
}

/**
 * One repo's project open-MR store. A cold repo forces a full paginated sync
 * on the daemon side when maxAgeMs demands it, which can run tens of seconds
 * on a big project — hence the long timeout.
 */
export function readProjectMRs(
  repoName: string,
  maxAgeMs?: number,
  opts: RtClientOptions = {},
): Promise<RtResponse<ProjectMRsData>> {
  const payload: Record<string, unknown> = { repoName };
  if (maxAgeMs !== undefined) payload.maxAgeMs = maxAgeMs;
  return rtCommand<ProjectMRsData>("project-mrs:read", payload, { sockPath: opts.sockPath, timeoutMs: 90_000 });
}

export function readDiscussions(
  repoName: string,
  iid: number,
  opts: RtClientOptions = {},
): Promise<RtResponse<DiscussionsData>> {
  return rtCommand<DiscussionsData>("discussions:read", { repoName, iid }, { sockPath: opts.sockPath, timeoutMs: 30_000 });
}

/**
 * Subscribe to the daemon's broadcast channel. Reconnects with capped
 * exponential backoff (1s → 30s) until the returned stop function runs;
 * the daemon being down just means silence, never a crash.
 */
export function subscribe(
  onEvent: (type: string, data: unknown) => void,
  opts: RtClientOptions = {},
): () => void {
  const url = opts.wsUrl ?? DEFAULT_WS_URL;
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => { attempt = 0; };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(String(ev.data)) as { type?: unknown; data?: unknown };
        if (typeof frame.type === "string") onEvent(frame.type, frame.data);
      } catch {
        // Non-JSON frame; ignore.
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
      timer = setTimeout(connect, delay);
    };
    ws.onerror = () => {
      try { ws?.close(); } catch { /* already closed */ }
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    try { ws?.close(); } catch { /* already closed */ }
  };
}
