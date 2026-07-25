/**
 * Detect a stale portless proxy.
 *
 * portless watches routes.json with fs.watch and has no polling fallback, so on
 * a long-lived proxy the watcher can die silently. After that, route changes (a
 * dev-port override, a renumbered app) never reach the proxy and .localhost
 * keeps serving the old port, while the board's health probes, which hit each
 * app's port directly, still show green. Nothing notices.
 *
 * The check: briefly point the board's OWN route at a second listener the board
 * also owns, then ask the proxy who answers. The canary listener forwards
 * everything except its identity endpoint to the real board, so the flip is
 * invisible to anyone using the page. Using the board's existing route means no
 * extra routes.json entry, and therefore no stray row on the board.
 */
import { setRoutePort } from "./routes-writer.ts";

/** Returns the port of whichever listener answered, as plain text. */
export const CANARY_PATH = "/__whoami";

export type Freshness = "fresh" | "stale" | "unknown";

/**
 * Which listener the proxy routed to tells us whether it saw the route change.
 * An unreachable proxy is inconclusive, never "stale": we only warn on a
 * positive answer from the wrong port.
 */
export function interpretProbe(expected: number, served: number | null): Freshness {
  if (served === null) return "unknown";
  return served === expected ? "fresh" : "stale";
}

/**
 * A second listener on the board's behalf. Only CANARY_PATH is its own; every
 * other request is forwarded to the real board, so traffic is unaffected while
 * a check is in flight (or if a crash ever leaves the route pointed here).
 */
export function startCanaryListener(canaryPort: number, mainPort: number) {
  return Bun.serve({
    port: canaryPort,
    hostname: "127.0.0.1",
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === CANARY_PATH) {
        // Report the port actually bound, not the one requested, so the answer
        // is always the truth about who served this request.
        return new Response(String(server.port), {
          headers: { "content-type": "text/plain" },
        });
      }
      url.hostname = "127.0.0.1";
      url.port = String(mainPort);
      url.protocol = "http:";
      try {
        return await fetch(
          new Request(url.toString(), {
            method: req.method,
            headers: req.headers,
            body: req.body,
            redirect: "manual",
          }),
        );
      } catch {
        return new Response("board unreachable", { status: 502 });
      }
    },
  });
}

/** Ask the proxy, over its own https listener, which port serves this app. */
async function probeServedPort(app: string): Promise<number | null> {
  try {
    const res = await fetch(`https://${app}.localhost${CANARY_PATH}`, {
      signal: AbortSignal.timeout(3000),
      // portless serves its own CA; we only care which upstream answered.
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    if (!res.ok) return null;
    const port = Number((await res.text()).trim());
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let checking = false;

/**
 * Flip the board's route to the canary listener, ask the proxy who answers,
 * then always flip it back. Concurrent calls are collapsed into "unknown"
 * rather than fighting over the same route entry.
 */
export async function checkProxyFreshness(opts: {
  app: string;
  mainPort: number;
  canaryPort: number;
  timeoutMs?: number;
  /** Injectable for tests, so they never depend on a live proxy. */
  probe?: (app: string) => Promise<number | null>;
}): Promise<Freshness> {
  const { app, mainPort, canaryPort } = opts;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const probe = opts.probe ?? probeServedPort;
  if (checking) return "unknown";
  checking = true;
  try {
    if (!setRoutePort(app, canaryPort)) return "unknown";
    const deadline = Date.now() + timeoutMs;
    let served: number | null = null;
    while (Date.now() < deadline) {
      await sleep(400);
      served = await probe(app);
      // A live watcher usually lands within a second; stop as soon as it does.
      if (served === canaryPort) return "fresh";
    }
    return interpretProbe(canaryPort, served);
  } finally {
    setRoutePort(app, mainPort); // always restore, even on an early return
    checking = false;
  }
}
