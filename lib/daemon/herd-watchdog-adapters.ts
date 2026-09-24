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
import { driveRelocationAccept, driveTrustAccept } from "./trust-accept.ts";
import { paneStatuses } from "./pane-statuses.ts";
import { findTreeByPath } from "../worktree/registry.ts";

export interface WatchdogSensorDeps {
  herdStore: Pick<HerdStore, "list" | "jobs">;
  gatesStore: Pick<GatesStore, "list" | "unconsumedAnsweredPushes">;
  lifecycle: Pick<HerdLifecycle, "lastStatusChangeMs">;
  herdr: typeof herdrRequest;
  defaultSocket: string;
  db: Database;
  now?: () => number;
  /** Used only to report a herdr status this mapper does not name. */
  log?: Logger;
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

/** The statuses this mapper names. Anything else a live claude reports still
    maps, to idle: board-37 sat wedged for 31 minutes because "done" fell
    through to working, and a working pane is never poked. A status nobody
    mapped must never exempt a pane again, so the fall-through is idle and the
    gap is logged rather than swallowed. */
const NAMED_STATUSES: ReadonlySet<string> = new Set(["working", "idle", "blocked", "done"]);

function readingState(row: PaneReading | undefined, unknown?: (status: string) => void): ReturnType<WatchdogSensors["paneState"]> {
  if (!row) return "gone";
  if (row.agent !== "claude") return "dead";
  if (row.status === "blocked") return "modal";
  if (row.status === "working") return "working";
  // No status at all is not an unnamed status: herdr has not classified the
  // pane yet, which is evidence of nothing either way.
  if (row.status === null) return "working";
  // "done" is herdr's after-turn state: a finished turn sitting at the prompt
  // is exactly the wedge posture the fast path is looking for.
  if (!NAMED_STATUSES.has(row.status)) unknown?.(row.status);
  return "idle";
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
    // One warn per unrecognized status per sweep, not per pane: a herdr that
    // grew a new status would otherwise warn once for every worker it runs.
    const unnamed = new Set<string>();
    for (const [pane, row] of next) {
      if (readingState(row, (status) => unnamed.add(status)) !== "idle" || deps.lifecycle.lastStatusChangeMs(pane) !== null) continue;
      if (!firstSeenIdle.has(pane)) firstSeenIdle.set(pane, t);
    }
    for (const status of unnamed) deps.log?.warn({ status }, "watchdog: unrecognized herdr agent status; treating the pane as idle");
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
  /** Needed only by the mid-run trust accept; the other actuators go through
      the injector. */
  herdr?: typeof herdrRequest;
  inject?: typeof injectIntoPane;
  enqueue?: typeof enqueueNotification;
  log: Logger;
  trustSettleMs?: number;
  trustStepMs?: number;
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
    async acceptTrustModal(herd, job, pane) {
      if (!deps.herdr) return false;
      const sockPath = deps.socketFor(pane);
      try {
        const outcome = await driveTrustAccept({
          herdr: deps.herdr, sock: { sockPath }, pane: parsePaneRef(pane).paneId,
          log, context: { herd, job },
          ...(deps.trustSettleMs !== undefined && { settleMs: deps.trustSettleMs }),
          ...(deps.trustStepMs !== undefined && { stepMs: deps.trustStepMs }),
        });
        if (outcome !== "accepted") log.info({ herd, job, pane, outcome }, "watchdog: mid-run trust accept did not clear the pane");
        return outcome === "accepted";
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog: mid-run trust accept threw");
        return false;
      }
    },
    async acceptRelocationModal(herd, job, pane) {
      if (!deps.herdr) return false;
      const sockPath = deps.socketFor(pane);
      try {
        const outcome = await driveRelocationAccept({
          herdr: deps.herdr, sock: { sockPath }, pane: parsePaneRef(pane).paneId,
          log, context: { herd, job },
          isRegisteredTree: (path) => findTreeByPath(path) !== null,
          ...(deps.trustSettleMs !== undefined && { settleMs: deps.trustSettleMs }),
          ...(deps.trustStepMs !== undefined && { stepMs: deps.trustStepMs }),
        });
        if (outcome !== "accepted" && outcome !== "no-dialog") log.info({ herd, job, pane, outcome }, "watchdog: relocation accept did not clear the pane");
        return outcome === "accepted";
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog: relocation accept threw");
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
    notifyStuckAtModal(herd, job, pane) {
      try {
        enqueue({
          id: crypto.randomUUID(),
          title: `herd ${herd}: ${job} stuck at trust modal`,
          message: `click to focus pane ${pane}, accept the dialog`,
          category: "herd-watchdog",
          timestamp: Date.now(),
          paneId: pane,
        }, deps.db);
      } catch (err) {
        log.warn({ err, herd, job, pane }, "watchdog could not enqueue the park notification");
      }
    },
    notifyHuman(summary, pane) {
      try {
        enqueue({
          id: crypto.randomUUID(), title: "herd watchdog", message: summary,
          category: "herd-watchdog", timestamp: Date.now(),
          ...(pane ? { paneId: pane } : {}),
        }, deps.db);
      } catch (err) {
        log.warn({ err, summary }, "watchdog could not enqueue the notification");
      }
    },
  };
}

const CONFIG_DEFAULTS: WatchdogConfig = {
  enabled: true, fastMins: 2, shepherdFastMins: 5, backstopMins: 15,
  retryMins: 5, notifyQuietMins: 30, nagMins: 30, notifyHuman: true,
  midRunTrustAccept: false, relocationAutoAccept: true,
};

/** Resolves the nine `herd.watchdog.*` keys through `read` (the settings
    resolver's getSetting), one at a time so a single unreadable or mistyped
    key falls back alone. Meant to run on every sweep, never cached. */
export function readWatchdogConfig(read: <T>(key: string) => { value: T }): WatchdogConfig {
  const bool = (name: "enabled" | "notifyHuman" | "midRunTrustAccept"): boolean => {
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
  // Not a herd.watchdog.* key: the reconciler's blocked-pane path reads the
  // same switch, so it lives in the pane family and both seams resolve it.
  const relocationAutoAccept = (() => {
    try {
      const v = read<unknown>("panes.relocationAutoAccept").value;
      return typeof v === "boolean" ? v : CONFIG_DEFAULTS.relocationAutoAccept;
    } catch {
      return CONFIG_DEFAULTS.relocationAutoAccept;
    }
  })();
  return {
    enabled: bool("enabled"),
    fastMins: mins("fastMins"),
    shepherdFastMins: mins("shepherdFastMins"),
    backstopMins: mins("backstopMins"),
    retryMins: mins("retryMins"),
    notifyQuietMins: mins("notifyQuietMins"),
    nagMins: mins("nagMins"),
    notifyHuman: bool("notifyHuman"),
    midRunTrustAccept: bool("midRunTrustAccept"),
    relocationAutoAccept,
  };
}
