/**
 * Preflight for apps that let public traffic follow their dev-port override.
 *
 * Turning that on routes the internet at a dev server, and a dev server not built
 * for it fails in two specific ways: it refuses the public hostname outright, and
 * its HMR client dials a port the tunnel does not expose. Both are detectable from
 * here, so the board can name the missing config line instead of leaving a broken
 * page to explain itself.
 *
 * This reports; it never re-routes. Silently falling back to the base port would
 * make public traffic land somewhere the toggle says it should not.
 */

/** Everything the tunnel can reach is HTTPS on 443, so HMR must be told so. */
export const REQUIRED_HMR_PORT = 443;
export const REQUIRED_HMR_PROTOCOL = "wss";

export type IssueCode =
  | "dev-server-down"
  | "host-blocked"
  | "hmr-not-tunnel-ready"
  | "unknown-dev-server";

export interface Issue {
  code: IssueCode;
  message: string;
  /** The concrete edit that clears the issue, or undefined when informational. */
  fix?: string;
}

export interface Probe {
  /** False when nothing accepted a connection on the dev port. */
  reachable: boolean;
  /** GET / carrying the public Host header. */
  host?: { status: number; body: string };
  /** GET /@vite/client. A 404 means this is not a Vite dev server. */
  viteClient?: { status: number; body: string };
}

export interface ProbeContext {
  app: string;
  devPort: number;
  publicHost: string;
}

/**
 * Vite inlines the resolved HMR config into its client module as literals:
 *
 *   const socketProtocol = null || (importMetaUrl.protocol === "https:" ? ...)
 *   const hmrPort = null
 *
 * `null` means the option is unset. Reading them gives an exact answer rather
 * than inferring configuration from symptoms.
 */
export function parseHmrPort(clientJs: string): number | null {
  const m = clientJs.match(/const hmrPort = (\d+|null)/);
  if (!m || m[1] === "null") return null;
  return Number(m[1]);
}

export function parseHmrProtocol(clientJs: string): string | null {
  const m = clientJs.match(/const socketProtocol = (null|"[^"]*")/);
  if (!m || m[1] === "null") return null;
  return m[1]!.slice(1, -1);
}

/** Vite answers a blocked Host with 403 and says so in the body. */
export function isHostBlocked(status: number, body: string): boolean {
  return status === 403 && /not allowed/i.test(body);
}

export function interpretProbe(probe: Probe, ctx: ProbeContext): Issue[] {
  if (!probe.reachable) {
    return [{
      code: "dev-server-down",
      message: `Nothing is listening on port ${ctx.devPort}.`,
      fix: `Start the dev server for ${ctx.app}, or clear the port override.`,
    }];
  }

  const issues: Issue[] = [];

  if (probe.host && isHostBlocked(probe.host.status, probe.host.body)) {
    issues.push({
      code: "host-blocked",
      message: `The dev server refuses requests for ${ctx.publicHost}.`,
      fix: `Add server.allowedHosts: ['${ctx.publicHost}'] to the dev server config.`,
    });
  }

  const isVite = probe.viteClient !== undefined && probe.viteClient.status === 200;
  if (!isVite) {
    // Not Vite: the HMR literals do not exist, so checking them would invent a
    // failure. The host check above still applies to any dev server.
    issues.push({
      code: "unknown-dev-server",
      message: "Not a Vite dev server, so hot-reload config could not be checked.",
    });
    return issues;
  }

  const port = parseHmrPort(probe.viteClient!.body);
  const protocol = parseHmrProtocol(probe.viteClient!.body);
  if (port !== REQUIRED_HMR_PORT || protocol !== REQUIRED_HMR_PROTOCOL) {
    issues.push({
      code: "hmr-not-tunnel-ready",
      message: hmrMessage(port, protocol, ctx.devPort),
      fix:
        `Add server.hmr: { clientPort: ${REQUIRED_HMR_PORT}, ` +
        `protocol: '${REQUIRED_HMR_PROTOCOL}' } to the dev server config.`,
    });
  }

  return issues;
}

/** Name whichever half is wrong, since the port is the usual culprit. */
function hmrMessage(port: number | null, protocol: string | null, devPort: number): string {
  if (port !== REQUIRED_HMR_PORT) {
    return `Hot reload dials port ${port ?? devPort}, which the tunnel does not expose.`;
  }
  return `Hot reload uses ${protocol ?? "ws"}, but traffic through the tunnel is ${REQUIRED_HMR_PROTOCOL}.`;
}

async function get(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

export async function probeDevServer(ctx: ProbeContext, timeoutMs = 2000): Promise<Probe> {
  const base = `http://127.0.0.1:${ctx.devPort}`;
  const [host, viteClient] = await Promise.all([
    get(`${base}/`, { host: ctx.publicHost }, timeoutMs),
    get(`${base}/@vite/client`, { host: `localhost:${ctx.devPort}` }, timeoutMs),
  ]);
  // Either probe answering proves something is listening; the /@vite/client one
  // uses a local Host so a blocked hostname cannot masquerade as an unreachable
  // server.
  if (!host && !viteClient) return { reachable: false };
  return {
    reachable: true,
    host: host ?? undefined,
    viteClient: viteClient ?? undefined,
  };
}

export async function checkApp(ctx: ProbeContext): Promise<Issue[]> {
  return interpretProbe(await probeDevServer(ctx), ctx);
}
