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
  /** Outbox to drain on each tick. Defaults to the shared OUTBOX_DIR, which is
      what production wants; tests must pin a temp dir so a run never drains
      the real queue. */
  outboxDir?: string;
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

  let running: Promise<void> | null = null;
  let next: Promise<void> | null = null;

  function runTick(): Promise<void> {
    running = (async () => {
      if (runtime) await runPeerTick(runtime.client, deps, host.outboxDir);
    })().finally(() => { running = null; });
    return running;
  }

  /** One tick against whatever client is current. Also the boot-time "run once
      now", so tests can drive ticks without faking timers.

      Ticks never overlap: a tick slower than the interval would otherwise have
      two outbox drains publishing the same queued envelope, which today only
      stays harmless because the relay dedupes on (id, recipient). Requests
      arriving mid-tick collapse into one follow-up run rather than a queue of
      them, and the returned promise resolves when the tick this caller
      triggered (or joined) has finished. */
  function tickNow(): Promise<void> {
    if (!running) return runTick();
    next ??= running.then(() => { next = null; return tickNow(); });
    return next;
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
