/**
 * The herd watchdog's sensors and actuators over the daemon's real stores,
 * herdr, chat, and the notifier queue. Every dependency arrives as an object
 * so a test (or the e2e harness) can stand in fakes for herdr, gates, chat,
 * and the injector without touching the ladder.
 */
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { formatPaneRef, parsePaneRef, type PaneServer } from "../../packages/rt-client/src/index.ts";
import type { herdrRequest } from "../herdr/client.ts";
import { peekUnread } from "../state/chat-store.ts";
import { dmParticipants } from "../state/dm-store.ts";
import { enqueueNotification } from "../state/notifier-store.ts";
import type { GatesStore } from "./gates-store.ts";
import type { HerdLifecycle } from "./herd-lifecycle.ts";
import type { HerdStore } from "./herd-store.ts";
import type { WatchdogActuators, WatchdogConfig, WatchdogSensors } from "./herd-watchdog.ts";
import { injectIntoPane } from "./inject.ts";
import { paneStatuses } from "./pane-statuses.ts";

export interface WatchdogSensorDeps {
  herdStore: Pick<HerdStore, "list" | "jobs">;
  gatesStore: Pick<GatesStore, "list" | "unconsumedAnsweredPushes">;
  lifecycle: Pick<HerdLifecycle, "lastStatusChangeMs">;
  herdr: typeof herdrRequest;
  defaultSocket: string;
  db: Database;
  now?: () => number;
}

export interface RefreshingSensors extends WatchdogSensors {
  /** Snapshots every herdr server the active herds live on, once; the pane
      readings below answer from that snapshot until the next call. */
  refresh(): Promise<void>;
  /** The socket the pane was last seen on; the default socket for a pane no
      snapshot listed (a shepherd pane always sits there). */
  socketFor(pane: string): string;
}

interface PaneReading { agent: string | null; status: string | null; socket: string }

const UNREAD_PEEK_LIMIT = 200;

function readingState(row: PaneReading | undefined): ReturnType<WatchdogSensors["paneState"]> {
  if (!row) return "gone";
  if (row.agent !== "claude") return "dead";
  if (row.status === "blocked") return "modal";
  // "done" is herdr's after-turn state, idle in every way that matters
  // here; a status herdr did not name is no evidence of a wedge.
  if (row.status === "idle" || row.status === "done") return "idle";
  return "working";
}

export function createWatchdogSensors(deps: WatchdogSensorDeps): RefreshingSensors {
  const now = deps.now ?? Date.now;
  // Keyed by the addressable ref the job row stores (bg: for a hidden herd),
  // not the bare id: two servers can both hold a w1:p1.
  let panes = new Map<string, PaneReading>();
  // The lifecycle's status map is in memory, so after a daemon restart every
  // worker that was already idle has no recorded transition and would read as
  // "never idle" forever (RT-187). The first refresh that sees such a pane
  // idle stamps it here, and that stamp stands in for the transition until the
  // pane works again: an age measured from the restart, never from boot-time
  // zero, so a worker idle across a restart still earns a verdict.
  const firstSeenIdle = new Map<string, number>();

  async function refresh(): Promise<void> {
    const active = deps.herdStore.list({ status: "active" });
    const servers = new Map<string, PaneServer>(active.length > 0 ? [[deps.defaultSocket, "visible"]] : []);
    for (const herd of active) {
      if (herd.herdrSocket && !servers.has(herd.herdrSocket)) servers.set(herd.herdrSocket, herd.hidden ? "bg" : "visible");
    }
    const next = new Map<string, PaneReading>();
    for (const [socket, server] of servers) {
      for (const [id, row] of await paneStatuses(deps.herdr, socket)) next.set(formatPaneRef(id, server), { ...row, socket });
    }
    const t = now();
    for (const pane of firstSeenIdle.keys()) if (readingState(next.get(pane)) !== "idle") firstSeenIdle.delete(pane);
    for (const [pane, row] of next) {
      if (readingState(row) !== "idle" || deps.lifecycle.lastStatusChangeMs(pane) !== null) continue;
      if (!firstSeenIdle.has(pane)) firstSeenIdle.set(pane, t);
    }
    panes = next;
  }

  return {
    refresh,
    socketFor: (pane) => panes.get(pane)?.socket ?? deps.defaultSocket,
    now,
    herds: () => deps.herdStore.list({ status: "active" }),
    jobs: (herd) => deps.herdStore.jobs(herd),
    paneState: (pane) => readingState(panes.get(pane)),
    idleSinceMs: (pane) => deps.lifecycle.lastStatusChangeMs(pane) ?? firstSeenIdle.get(pane) ?? null,
    unreadDmMentionsFor(handle) {
      let count = 0;
      for (const { room, messages } of peekUnread({ handle, limit: UNREAD_PEEK_LIMIT }, deps.db)) {
        const dm = dmParticipants(room, deps.db) !== null;
        for (const m of messages) if (m.handle !== handle && (dm || m.mentions.includes(handle))) count += 1;
      }
      return count;
    },
    openHumanGates(prefix) {
      const t = now();
      return deps.gatesStore.list({ open: true, subjectPrefix: prefix }).gates
        .filter((g) => g.owner === "human")
        .map((g) => ({ id: g.id, ageMs: t - g.openedAt }));
    },
    unconsumedAnswered(session) {
      const t = now();
      return deps.gatesStore.unconsumedAnsweredPushes(t)
        .filter((g) => g.nudge?.session === session)
        .map((g) => ({ id: g.id, ageMs: t - (g.answer?.answeredAt ?? t) }));
    },
  };
}

export interface WatchdogActuatorDeps {
  herdStore: Pick<HerdStore, "setJobStatus">;
  db: Database;
  socketFor: (pane: string) => string;
  inject?: typeof injectIntoPane;
  enqueue?: typeof enqueueNotification;
  log: Logger;
}

/** None of these throw into the ladder: one party's failed side effect must
    not end the sweep for every other herd. */
export function createWatchdogActuators(deps: WatchdogActuatorDeps): WatchdogActuators {
  const inject = deps.inject ?? injectIntoPane;
  const enqueue = deps.enqueue ?? enqueueNotification;
  const { log } = deps;
  return {
    async poke(pane, text) {
      const sockPath = deps.socketFor(pane);
      try {
        const res = await inject({ paneId: parsePaneRef(pane).paneId, text, sockPath });
        if (!res.ok) {
          log.warn({ pane, sockPath, error: res.error }, "watchdog poke failed");
          return false;
        }
        if (res.data.delivered !== "accepted") {
          log.info({ pane, sockPath, delivered: res.data.delivered, reason: res.data.reason }, "watchdog poke not accepted");
          return false;
        }
        return true;
      } catch (err) {
        log.warn({ err, pane, sockPath }, "watchdog poke threw");
        return false;
      }
    },
    parkStuckAtModal(herd, job) {
      try {
        deps.herdStore.setJobStatus(herd, job, "stuck-at-modal");
      } catch (err) {
        log.warn({ err, herd, job }, "watchdog could not park the job");
      }
    },
    notifyHuman(summary) {
      try {
        enqueue({ id: crypto.randomUUID(), title: "herd watchdog", message: summary, category: "herd-watchdog", timestamp: Date.now() }, deps.db);
      } catch (err) {
        log.warn({ err, summary }, "watchdog could not enqueue the notification");
      }
    },
  };
}

const CONFIG_DEFAULTS: WatchdogConfig = {
  enabled: true, fastMins: 2, shepherdFastMins: 5, backstopMins: 15,
  retryMins: 5, notifyQuietMins: 30, nagMins: 30, notifyHuman: true,
};

/** Resolves the eight `herd.watchdog.*` keys through `read` (the settings
    resolver's getSetting), one at a time so a single unreadable or mistyped
    key falls back alone. Meant to run on every sweep, never cached. */
export function readWatchdogConfig(read: <T>(key: string) => { value: T }): WatchdogConfig {
  const bool = (name: "enabled" | "notifyHuman"): boolean => {
    try {
      const v = read<unknown>(`herd.watchdog.${name}`).value;
      return typeof v === "boolean" ? v : CONFIG_DEFAULTS[name];
    } catch {
      return CONFIG_DEFAULTS[name];
    }
  };
  // retryMins and notifyQuietMins gate a repeat action (a poke, a
  // notification); 0 on both turns the sweep interval into the repeat
  // interval, so they floor at 1. The other minute keys stay at 0 because
  // fastMins: 0 is a valid "poke immediately" setting the e2e relies on.
  const FLOORED: ReadonlySet<string> = new Set(["retryMins", "notifyQuietMins"]);
  const mins = (name: "fastMins" | "shepherdFastMins" | "backstopMins" | "retryMins" | "notifyQuietMins" | "nagMins"): number => {
    try {
      const v = read<unknown>(`herd.watchdog.${name}`).value;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return CONFIG_DEFAULTS[name];
      return FLOORED.has(name) ? Math.max(1, v) : v;
    } catch {
      return CONFIG_DEFAULTS[name];
    }
  };
  return {
    enabled: bool("enabled"),
    fastMins: mins("fastMins"),
    shepherdFastMins: mins("shepherdFastMins"),
    backstopMins: mins("backstopMins"),
    retryMins: mins("retryMins"),
    notifyQuietMins: mins("notifyQuietMins"),
    nagMins: mins("nagMins"),
    notifyHuman: bool("notifyHuman"),
  };
}
