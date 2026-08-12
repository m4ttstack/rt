import { runPeerTick, type MaterializeDeps } from "./inbox.ts";
import type { SwitchboardClient } from "./client.ts";

/** Consecutive 401 inbox polls before the board calls its token dead. One 401
    can be a relay restart mid-rotation; three in a row is the token. */
const UNAUTHORIZED_AFTER = 3;

export interface PeerRuntime {
  client: SwitchboardClient;
  health(): "ok" | "unauthorized";
}

export interface PeeringHost {
  /** Injectable so tests never build a real client. */
  makeClient(url: string, token: string): SwitchboardClient;
  deps: Omit<MaterializeDeps, "reportAuth">;
  tickMs?: number;
}

/** The board's peering runtime: hot-startable from /peer/join as well as boot
    (spec I5). start() takes the token as an argument and never reads
    process.env -- a running process does not reload .env. Idempotent: a second
    start replaces the client and interval without stacking. Health flips to
    "unauthorized" after 3 consecutive 401 inbox polls (spec M11). */
export function makePeering(host: PeeringHost) {
  let runtime: PeerRuntime | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let strikes = 0;
  const deps: MaterializeDeps = {
    ...host.deps,
    reportAuth: (state) => { strikes = state === "unauthorized" ? strikes + 1 : 0; },
  };

  /** One tick against whatever client is current. Also the boot-time "run once
      now", so tests can drive ticks without faking timers. */
  async function tickNow(): Promise<void> {
    if (runtime) await runPeerTick(runtime.client, deps);
  }

  function start(url: string, token: string): PeerRuntime {
    if (timer) clearInterval(timer);
    strikes = 0;
    const client = host.makeClient(url, token);
    runtime = { client, health: () => (strikes >= UNAUTHORIZED_AFTER ? "unauthorized" : "ok") };
    // Once now so a restart (or a fresh join) picks up whatever queued while
    // this board was not listening, then on a slow tick -- peer state is
    // ambient context, not a hot path.
    void tickNow();
    timer = setInterval(() => void tickNow(), host.tickMs ?? 60_000);
    return runtime;
  }

  return {
    start,
    current: () => runtime,
    tickNow,
    /** Kills the timer, not the handle: callers holding a PeerRuntime keep a
        usable client. For tests, which must not leave an interval running. */
    stop: () => { if (timer) clearInterval(timer); timer = null; },
  };
}
