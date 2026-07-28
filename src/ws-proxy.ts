import type { ServerWebSocket } from "bun";

/**
 * Websocket proxying for the gateway.
 *
 * The gateway's HTTP path uses fetch(), which cannot carry an upgrade. Without
 * this an app served on its dev port publicly (see publicPort) loads but its HMR
 * client never connects, and Vite then polls and reloads on reconnect, which is
 * the reload loop the whole feature exists to avoid.
 */

export type WsPayload = string | Uint8Array | ArrayBuffer;

export interface WsProxyData {
  upstream: WebSocket;
  /** Upstream frames that arrived before the client socket finished opening. */
  pending: WsPayload[];
  client: ServerWebSocket<WsProxyData> | null;
}

export function isWebSocketUpgrade(req: Request): boolean {
  // Both headers are case-insensitive per RFC 6455, and Connection is a list
  // ("keep-alive, Upgrade") in practice, so match a token rather than equality.
  const upgrade = req.headers.get("upgrade")?.toLowerCase();
  const connection = req.headers.get("connection")?.toLowerCase() ?? "";
  return upgrade === "websocket" && connection.split(",").some((t) => t.trim() === "upgrade");
}

/** Parse Sec-WebSocket-Protocol, which is a comma-separated preference list. */
export function requestedProtocols(header: string | null): string[] {
  if (!header) return [];
  return header.split(",").map((p) => p.trim()).filter(Boolean);
}

/**
 * Close codes we may pass on to the other side.
 *
 * 1005 (no status) and 1006 (abnormal) are status codes the runtime reports but
 * that RFC 6455 forbids sending on the wire, and anything outside the permitted
 * ranges throws. Collapse those to 1000 rather than tearing down the pump.
 */
export function safeCloseCode(code: number | undefined): number {
  if (code === undefined) return 1000;
  if (code === 1005 || code === 1006) return 1000;
  const allowed = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
  return allowed ? code : 1000;
}

export function upstreamUrl(port: number, pathname: string, search: string): string {
  return `ws://127.0.0.1:${port}${pathname}${search}`;
}

/**
 * Open the upstream socket before upgrading the client.
 *
 * Connecting first costs a round trip but lets us echo the subprotocol the
 * upstream actually negotiated. Vite's HMR client connects with `vite-hmr` and
 * rejects a handshake that comes back without it, so guessing here would break
 * exactly the case this feature targets.
 */
export function connectUpstream(
  url: string,
  protocols: string[],
  timeoutMs = 5000,
): Promise<{ upstream: WebSocket; data: WsProxyData }> {
  return new Promise((resolve, reject) => {
    let upstream: WebSocket;
    try {
      upstream = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    upstream.binaryType = "arraybuffer";

    const data: WsProxyData = { upstream, pending: [], client: null };
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { upstream.close(); } catch {}
      reject(new Error(`upstream websocket timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    upstream.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ upstream, data });
    };

    upstream.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("upstream websocket failed to connect"));
        return;
      }
      data.client?.close(1011, "upstream error");
    };

    upstream.onmessage = (event: MessageEvent) => {
      const payload = event.data as WsPayload;
      // The client socket does not exist until server.upgrade() runs and its
      // open handler fires, so early frames queue rather than drop.
      if (data.client) data.client.send(payload as never);
      else data.pending.push(payload);
    };

    upstream.onclose = (event: CloseEvent) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("upstream websocket closed during handshake"));
        return;
      }
      data.client?.close(safeCloseCode(event.code), event.reason || undefined);
    };
  });
}

/** The `websocket` handler for Bun.serve: pumps frames once both sides exist. */
export const wsHandler = {
  open(ws: ServerWebSocket<WsProxyData>) {
    ws.data.client = ws;
    for (const frame of ws.data.pending) ws.send(frame as never);
    ws.data.pending.length = 0;
  },
  message(ws: ServerWebSocket<WsProxyData>, message: string | Uint8Array) {
    const { upstream } = ws.data;
    if (upstream.readyState === WebSocket.OPEN) upstream.send(message as never);
  },
  close(ws: ServerWebSocket<WsProxyData>, code: number, reason: string) {
    const { upstream } = ws.data;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      try { upstream.close(safeCloseCode(code), reason || undefined); } catch {}
    }
  },
};
