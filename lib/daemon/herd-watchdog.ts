/**
 * Wedge detection for herd participants (workers and the shepherd), read
 * through sensors over the daemon's own stores. The evaluators here are pure:
 * one verdict per participant per reading, no timers, no I/O.
 */
import { herdPrefix, type HerdJobRow, type HerdRow } from "./herd-store.ts";

export interface WatchdogSensors {
  now(): number;
  herds(): HerdRow[];
  jobs(herd: string): HerdJobRow[];
  /** "modal" = herdr agent_status "blocked"; "dead" = pane listed, agent !== "claude". */
  paneState(pane: string): "working" | "idle" | "modal" | "dead" | "gone";
  /** Epoch ms of the pane's last status change, or null when nothing has been
      recorded (daemon restart, pane never watched). Null is never a wedge. */
  idleSinceMs(pane: string): number | null;
  /** DMs + mentions only (the wake-mode filter); room chatter never counts. */
  unreadDmMentionsFor(handle: string): number;
  openHumanGates(herdPrefix: string): { id: string; ageMs: number }[];
  unconsumedAnswered(session: string): { id: string; ageMs: number }[];
}

export type WedgeVerdict =
  | { kind: "healthy" }
  | { kind: "wedged"; path: "fast" | "backstop"; evidence: string }
  | { kind: "finished-lingering"; evidence: string }
  | { kind: "dead" | "modal" };

export interface WatchdogConfig {
  enabled: boolean;
  fastMins: number;
  shepherdFastMins: number;
  backstopMins: number;
  retryMins: number;
  notifyQuietMins: number;
  nagMins: number;
  notifyHuman: boolean;
}

const HEALTHY: WedgeVerdict = { kind: "healthy" };
const LIVE: ReadonlySet<HerdJobRow["status"]> = new Set(["spawning", "active", "at-gate", "at-milestone"]);
const AWAITING_ANSWER: ReadonlySet<HerdJobRow["status"]> = new Set(["at-gate", "at-milestone"]);

const minutes = (ms: number) => Math.floor(ms / 60_000);
const ms = (mins: number) => mins * 60_000;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const oldest = (gates: { id: string; ageMs: number }[]) => gates.reduce<{ id: string; ageMs: number } | null>((a, g) => (a && a.ageMs >= g.ageMs ? a : g), null);

/** The published report is the clock for both the nag and the shepherd backstop. */
function reportAgeMs(job: HerdJobRow, now: number): number | null {
  if (job.status !== "done" || job.lastReport === null) return null;
  return now - job.lastReport;
}

type Lingering = Extract<WedgeVerdict, { kind: "finished-lingering" }>;

/** A done job whose pane is already gone has been closed, so it never nags. */
function finishedLingering(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig, now: number): Lingering | null {
  const age = reportAgeMs(job, now);
  if (age === null || job.pane === null || age < ms(cfg.nagMins)) return null;
  if (s.paneState(job.pane) === "gone") return null;
  return { kind: "finished-lingering", evidence: `${job.name} done with report ${minutes(age)}m ago, pane still open` };
}

export function evaluateJob(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig): WedgeVerdict {
  const now = s.now();
  if (job.status === "done") return finishedLingering(job, s, cfg, now) ?? HEALTHY;
  if (!LIVE.has(job.status) || job.pane === null) return HEALTHY;

  const state = s.paneState(job.pane);
  if (state === "dead") return { kind: "dead" };
  if (state === "modal") return { kind: "modal" };
  if (state !== "idle") return HEALTHY;

  const since = s.idleSinceMs(job.pane);
  if (since === null) return HEALTHY;
  const idleMs = now - since;
  if (idleMs < ms(cfg.fastMins)) return HEALTHY;

  const unread = s.unreadDmMentionsFor(job.handle);
  if (unread > 0) return { kind: "wedged", path: "fast", evidence: `idle ${minutes(idleMs)}m with ${plural(unread, "unread DM/mention")}` };
  const answered = job.agentSession === null ? null : oldest(s.unconsumedAnswered(job.agentSession));
  if (answered) return { kind: "wedged", path: "fast", evidence: `gate ${answered.id} answered ${minutes(answered.ageMs)}m ago and unconsumed` };

  if (AWAITING_ANSWER.has(job.status) || idleMs < ms(cfg.backstopMins)) return HEALTHY;
  return { kind: "wedged", path: "backstop", evidence: `idle ${minutes(idleMs)}m with no open gate` };
}

/** The shepherd pane is never in the lifecycle's status map, so its idle
    duration is unknowable here: "idle" is the instantaneous pane state, and
    the ages come from the evidence itself (gate age, report age). A herd
    with no recorded shepherd pane is judged on evidence alone. */
export function evaluateShepherd(herd: HerdRow, s: WatchdogSensors, cfg: WatchdogConfig): WedgeVerdict {
  if (herd.status !== "active") return HEALTHY;
  if (herd.shepherdPane !== null && s.paneState(herd.shepherdPane) === "working") return HEALTHY;
  const now = s.now();

  const gate = oldest(s.openHumanGates(herdPrefix(herd.id)).filter((g) => g.ageMs >= ms(cfg.shepherdFastMins)));
  if (gate) return { kind: "wedged", path: "fast", evidence: `human gate ${gate.id} open ${minutes(gate.ageMs)}m unanswered` };
  const unread = s.unreadDmMentionsFor(herd.shepherdHandle);
  if (unread > 0) return { kind: "wedged", path: "fast", evidence: `${plural(unread, "unread DM/mention")} waiting` };

  const jobs = s.jobs(herd.id);
  for (const job of jobs) {
    const lingering = finishedLingering(job, s, cfg, now);
    if (lingering) return { kind: "wedged", path: "fast", evidence: lingering.evidence };
  }
  for (const job of jobs) {
    const age = reportAgeMs(job, now);
    if (age !== null && age >= ms(cfg.backstopMins)) {
      return { kind: "wedged", path: "backstop", evidence: `${job.name} done with report ${minutes(age)}m ago, not yet closed` };
    }
  }
  return HEALTHY;
}
