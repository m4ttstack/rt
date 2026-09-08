import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import {
  AGENT_STATUS_TOPIC_PREFIX,
  parseAgentStatusPayload,
  type AgentSignal,
} from '../agent-signal.ts';

export const AGENT_STATUS_PATTERN = 'board/agent-status/*';
export const PAGE_LIMIT = 500;

/** How long one handler may hold the serialized pass. The handler reaches
    GitLab and Slack with no abort signal of its own, so without a bound one
    stalled MR delays every other MR's signal and the 60s tick coalesces
    onto the stuck pass. */
export const HANDLE_DEADLINE_MS = 30_000;

export function isAgentStatusTopic(topic: unknown): topic is string {
  return (
    typeof topic === 'string' && topic.startsWith(AGENT_STATUS_TOPIC_PREFIX)
  );
}

export interface JournalEvent {
  id: number;
  topic: string;
  payload: unknown;
  /** Epoch ms the daemon stamped at emit. On a replay this is the transition
      time, which is what any time-sensitive side effect must key off rather
      than the moment the board got round to the event. */
  emittedAt: number;
}

export interface AgentStatusFeedIo {
  eventsHead(): Promise<{
    ok: boolean;
    data?: { cursor: number };
    error?: string;
  }>;
  eventsList(
    after: number,
    limit: number
  ): Promise<{
    ok: boolean;
    data?: { events: JournalEvent[] };
    error?: string;
  }>;
  readCursor(): number | null;
  writeCursor(cursor: number): void;
  handle(signal: AgentSignal, emittedAt: number): Promise<void>;
  appRoot: string;
  log(line: string): void;
  handleDeadlineMs?: number;
}

/**
 * The only path by which a status signal reaches the board. Every trigger
 * (boot, a relay push, the sweep tick) reads the journal past the cursor
 * rather than trusting what it was handed, so live delivery and replay
 * share one ordering and a push that arrives mid-reconnect costs nothing.
 *
 * The cursor advances after every event, handled or skipped, so a poison
 * event can never wedge the feed: the sweeps remain the backstop for the
 * one MR whose handler threw or ran past its deadline.
 *
 * Per-MR order survives a timeout. A handler past its deadline is left
 * running and the next event for that MR waits behind it, inside its own
 * deadline, so a delayed effect can never land after a later transition's;
 * every other MR proceeds while that one waits.
 */
export class AgentStatusFeed {
  private cursor: number | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private readonly reportedForeignRoots = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly io: AgentStatusFeedIo) {}

  /** Concurrent calls coalesce: one pass runs and at most one more is
      queued behind it, so a burst of wake-ups costs two reads, not N. */
  catchUp(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    do {
      this.rerun = false;
      await this.pass();
    } while (this.rerun);
  }

  private async pass(): Promise<void> {
    let after = await this.resolveCursor();
    if (after === null) return;
    for (;;) {
      const res = await this.io.eventsList(after, PAGE_LIMIT);
      if (!res.ok || !res.data) {
        this.io.log(
          `agent-status feed: journal read failed: ${res.error ?? 'unknown error'}`
        );
        return;
      }
      for (const ev of res.data.events) {
        await this.handleOne(ev);
        this.advance(ev.id);
        after = ev.id;
      }
      if (res.data.events.length < PAGE_LIMIT) return;
    }
  }

  /** A board that has never run the feed starts at the journal head:
      nothing emitted before it existed is a transition it owes a reaction. */
  private async resolveCursor(): Promise<number | null> {
    if (this.cursor !== null) return this.cursor;
    const stored = this.io.readCursor();
    if (stored !== null) {
      this.cursor = stored;
      return stored;
    }
    const head = await this.io.eventsHead();
    if (!head.ok || !head.data) {
      this.io.log(
        `agent-status feed: cursor seed failed: ${head.error ?? 'unknown error'}`
      );
      return null;
    }
    this.advance(head.data.cursor);
    return head.data.cursor;
  }

  private advance(id: number): void {
    this.cursor = id;
    this.io.writeCursor(id);
  }

  private async handleOne(ev: JournalEvent): Promise<void> {
    if (!isAgentStatusTopic(ev.topic)) return;
    const payload = parseAgentStatusPayload(ev.payload);
    if (!payload) {
      this.io.log(
        `agent-status feed: dropped malformed event #${ev.id} on ${ev.topic}`
      );
      return;
    }
    if (payload.appRoot !== this.io.appRoot) {
      // Once per foreign root, not once per frame: two boards on one machine
      // talk past each other forever, and the line is only there to name a
      // BOARD_APP_ROOT that never reached the panes this board launches.
      if (!this.reportedForeignRoots.has(payload.appRoot)) {
        this.reportedForeignRoots.add(payload.appRoot);
        this.io.log(
          `agent-status feed: ignoring frames stamped ${payload.appRoot}; this board is ${this.io.appRoot}`
        );
      }
      return;
    }
    const { appRoot: _appRoot, ...signal } = payload;
    const deadlineMs = this.io.handleDeadlineMs ?? HANDLE_DEADLINE_MS;
    const mrUrl = signal.mrUrl;
    // The chain is what orders this MR's effects; the throw is caught inside
    // it so the next event for the MR queues behind a failure too.
    const run = (this.inFlight.get(mrUrl) ?? Promise.resolve()).then(() =>
      this.io.handle(signal, ev.emittedAt).catch((err: unknown) => {
        this.io.log(
          `agent-status feed: handler failed on #${ev.id} (${mrUrl}): ${err instanceof Error ? err.message : err}`
        );
      })
    );
    this.inFlight.set(mrUrl, run);
    void run.then(() => {
      if (this.inFlight.get(mrUrl) === run) this.inFlight.delete(mrUrl);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = await Promise.race([
        run.then(() => false),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(true), deadlineMs);
        }),
      ]);
      // The handler is left running rather than cancelled: the sweeps own
      // that MR's reconciliation, the same policy a throwing handler gets.
      if (timedOut) {
        this.io.log(
          `agent-status feed: handler timed out on #${ev.id} (${mrUrl}) after ${deadlineMs}ms`
        );
      }
    } finally {
      // A live timer would hold the process open past the last event.
      clearTimeout(timer);
    }
  }
}

export function readCursorFile(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeCursorFile(path: string, cursor: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(cursor));
}
