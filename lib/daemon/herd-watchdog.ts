/**
 * Wedge detection for herd participants (workers and the shepherd), read
 * through sensors over the daemon's own stores, and the escalation ladder that
 * acts on the verdicts through injected actuators. The evaluators are pure:
 * one verdict per participant per reading, no timers, no I/O. The ladder keeps
 * only in-memory strike state and runs when the caller sweeps; it owns no timer.
 */
import type { Logger } from "pino";
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

/** The published report is the clock for both the nag and the shepherd
    backstop, and only while the pane is still open: a done job whose pane is
    gone has been closed (or its close was missed), and nobody can act on it.
    lastReport is the report's chat message id, not a time, so the age comes
    from updatedAt, which setJobStatus stamps as the job goes done (RT-193). */
function openReportAgeMs(job: HerdJobRow, s: WatchdogSensors, now: number): number | null {
  if (job.status !== "done" || job.lastReport === null || job.pane === null) return null;
  if (s.paneState(job.pane) === "gone") return null;
  return now - job.updatedAt;
}

type Lingering = Extract<WedgeVerdict, { kind: "finished-lingering" }>;

const closeRemedy = (job: HerdJobRow) => `run rt herd close ${job.name} --herd ${job.herd}`;

function finishedLingering(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig, now: number): Lingering | null {
  const age = openReportAgeMs(job, s, now);
  if (age === null || age < ms(cfg.nagMins)) return null;
  return { kind: "finished-lingering", evidence: `${job.name} done with report ${minutes(age)}m ago, pane still open; ${closeRemedy(job)}` };
}

export function evaluateJob(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig): WedgeVerdict {
  const now = s.now();
  if (job.status === "done") return finishedLingering(job, s, cfg, now) ?? HEALTHY;
  if (!LIVE.has(job.status) || job.pane === null) return HEALTHY;

  const state = s.paneState(job.pane);
  const since = s.idleSinceMs(job.pane);
  // The spawn path owns a spawning pane's trust prompt and missing agent.
  if (job.status !== "spawning") {
    if (state === "dead") return { kind: "dead" };
    // A registered agent's own trust dialog shows blocked for a few seconds
    // before the spawn path parks it (herdr detects the agent first), so a
    // fresh blocked reading is that race, not a wedge: require the same idle
    // threshold as the fast path before calling it a real modal wedge.
    if (state === "modal" && since !== null && now - since >= ms(cfg.fastMins)) return { kind: "modal" };
  }
  if (state !== "idle") return HEALTHY;

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
    const age = openReportAgeMs(job, s, now);
    if (age !== null && age >= ms(cfg.backstopMins)) {
      return { kind: "wedged", path: "backstop", evidence: `${job.name} done with report ${minutes(age)}m ago, not yet closed; ${closeRemedy(job)}` };
    }
  }
  return HEALTHY;
}

export interface WatchdogActuators {
  /** The adapter resolves the herdr socket (job panes ride HerdRow.herdrSocket,
      the shepherd pane sits on the default socket). False means the text was
      not delivered: the injector refuses blocked agents and queues on working. */
  poke(pane: string, text: string): Promise<boolean>;
  parkStuckAtModal(herd: string, job: string): void;
  /** Try the folder-trust accept on a blocked pane, the same driver every
      spawn path uses. True means the pane came back; false means it is a
      dialog the daemon may not answer, or one the accept did not clear. */
  acceptTrustModal(herd: string, job: string, pane: string): Promise<boolean>;
  /** The click-to-focus notification that rides with a park: the human is the
      only party who can accept a trust dialog, so it goes out on the park
      itself rather than waiting for the ladder's third rung, and it carries
      the pane so the tray click lands on the stuck pane. */
  notifyStuckAtModal(herd: string, job: string, pane: string): void;
  /** `pane` is the wedged party's own pane when there is one, so the tray
      click focuses it; null when the party has no pane to focus. */
  notifyHuman(summary: string, pane: string | null): void;
}

interface Ladder { strikes: number; lastPokeAt: number | null; since: number; parked: boolean }

const SHEPHERD = "@shepherd";
const WORKER_CAP = 5;
const SHEPHERD_CAP = 3;
const DEAD_EVIDENCE = "pane open but the agent is gone";
const MODAL_EVIDENCE = "blocked at a modal prompt, parked stuck-at-modal";

const pokeText = (evidence: string) => `watchdog: ${evidence}. Consume it or post status.`;
const summaryText = (party: string, evidence: string, ladder: Ladder, now: number) =>
  `watchdog: ${party}: ${evidence}; strike ${ladder.strikes}, flagged ${minutes(now - ladder.since)}m ago. Check on it.`;

/**
 * Escalation ladder over the evaluators. Worker strikes 1-2 poke the worker,
 * 3-4 poke the shepherd with a one-line summary, 5 notifies the human; dead and
 * modal verdicts enter at strike 3 (never injected), modal is parked once.
 * Shepherd strikes 1-2 poke its pane, 3 notifies the human. A herd with no
 * recorded shepherd pane routes every shepherd rung to the human. A strike is
 * earned only while still wedged and retryMins after the previous action;
 * a healthy verdict clears the ladder.
 */
export class HerdWatchdog {
  /** In memory by design: a daemon restart resets every ladder to strike 1 and
      reopens every herd's notification quiet period. */
  private readonly ladders = new Map<string, Ladder>();
  private readonly notifiedAt = new Map<string, number>();
  /** When each party was last acted on, kept ACROSS a ladder clear. A poke
      wakes its party, so the next sweep reads it healthy and drops the ladder;
      without this the party's next idle moment would start a fresh strike 1
      with no memory of the poke, and retryMins would never apply (the live
      double-nag three minutes apart, both logged at strike 1). */
  private readonly lastActionAt = new Map<string, number>();
  /** A sweep pokes panes over the network, so it can outlive its interval.
      The next tick is dropped rather than queued: the ladder's retry clock
      already paces the actions, and two sweeps in flight would double-strike
      every party still wedged. */
  private sweeping = false;
  private readonly sensors: WatchdogSensors;
  private readonly act: WatchdogActuators;
  private readonly cfg: () => WatchdogConfig;
  private readonly log: Logger;

  constructor(deps: { sensors: WatchdogSensors; act: WatchdogActuators; cfg(): WatchdogConfig; log: Logger }) {
    this.sensors = deps.sensors;
    this.act = deps.act;
    this.cfg = deps.cfg;
    this.log = deps.log;
  }

  /** True while a sweep is in flight, so the caller can skip the reading it
      would otherwise take first: refreshing mid-sweep swaps the snapshot the
      running sweep is still judging. */
  get busy(): boolean {
    return this.sweeping;
  }

  async sweep(): Promise<void> {
    const cfg = this.cfg();
    if (!cfg.enabled) {
      // Disabled is a reset, not a pause: a ladder that survived it would
      // resume mid-escalation against evidence nobody watched in between, and
      // a surviving quiet period would swallow the first notification after.
      this.ladders.clear();
      this.notifiedAt.clear();
      this.lastActionAt.clear();
      return;
    }
    if (this.sweeping) {
      this.log.debug({}, "watchdog sweep skipped: the previous one is still running");
      return;
    }
    this.sweeping = true;
    try {
      const now = this.sensors.now();
      for (const herd of this.sensors.herds()) {
        if (herd.status !== "active") continue;
        for (const job of this.sensors.jobs(herd.id)) await this.walkWorker(herd, job, cfg, now);
        await this.walkShepherd(herd, cfg, now);
      }
    } finally {
      this.sweeping = false;
    }
  }

  annotations(herd: string, job: string): { strikes: number; lastPokeAt: number | null } | null {
    const ladder = this.ladders.get(`${herd}/${job}`);
    return ladder ? { strikes: ladder.strikes, lastPokeAt: ladder.lastPokeAt } : null;
  }

  private async walkWorker(herd: HerdRow, job: HerdJobRow, cfg: WatchdogConfig, now: number): Promise<void> {
    const key = `${herd.id}/${job.name}`;
    const verdict = evaluateJob(job, this.sensors, cfg);
    if (verdict.kind === "healthy" || verdict.kind === "finished-lingering" || job.pane === null) {
      this.ladders.delete(key);
      return;
    }
    const ladder = this.track(key, now);
    if (verdict.kind === "modal" && !ladder.parked) {
      // Entering a freshly provisioned worktree re-prompts for folder trust
      // mid-session (trust is per directory), and that one the daemon may
      // answer for itself: it provisioned the tree. Anything else, and any
      // accept that does not clear the pane, parks as before. Only a
      // daemon-provisioned tree qualifies -- a job pointed at a directory
      // someone passed in is not rt's to trust on the human's behalf.
      if (job.tree !== null && await this.act.acceptTrustModal(herd.id, job.name, job.pane)) {
        this.ladders.delete(key);
        this.log.info({ herd: herd.id, job: job.name, pane: job.pane }, "accepted a mid-run trust dialog");
        return;
      }
      ladder.parked = true;
      this.act.parkStuckAtModal(herd.id, job.name);
      // Deliberately outside notify(): the park happens once, so this cannot
      // repeat, and the quiet period that paces repeated rung-3 summaries
      // would only drop the one notification that names a pane to click.
      if (cfg.notifyHuman) this.act.notifyStuckAtModal(herd.id, job.name, job.pane);
      this.log.info({ herd: herd.id, job: job.name, pane: job.pane }, "parked job stuck at modal");
    }
    if (!this.canAct(key, ladder, now, cfg)) return;
    // Unread counts and gate rows are read live, not from the pane snapshot,
    // so a worker that woke while this sweep was poking other panes is already
    // healthy here. Re-read before committing: a poke naming evidence the
    // worker has since consumed is worse than no poke at all, and stamping a
    // strike for a verdict that turned out healthy would refuse a genuine
    // wedge inside the very next retryMins with nothing having been sent.
    // The fresh verdict supplies the floor too, not the stale one: a dead or
    // modal reading that has since resolved to merely idle is a fresh wedge
    // at strike 1, not a stale dead/modal jumping straight to strike 3.
    const fresh = evaluateJob(job, this.sensors, cfg);
    if (fresh.kind === "healthy" || fresh.kind === "finished-lingering") {
      this.ladders.delete(key);
      return;
    }
    this.commit(key, ladder, now, fresh.kind === "wedged" ? 1 : 3, WORKER_CAP);
    const evidence = fresh.kind === "wedged" ? fresh.evidence : fresh.kind === "dead" ? DEAD_EVIDENCE : MODAL_EVIDENCE;
    const ctx = { herd: herd.id, job: job.name, verdict: fresh.kind, strike: ladder.strikes };
    if (ladder.strikes <= 2) {
      await this.poke(job.pane, pokeText(evidence), ctx, "poked worker");
      return;
    }
    const summary = summaryText(key, evidence, ladder, now);
    if (ladder.strikes >= WORKER_CAP || herd.shepherdPane === null) this.notify(herd.id, summary, job.pane, cfg, now, ctx);
    else await this.poke(herd.shepherdPane, summary, ctx, "escalated to shepherd");
  }

  private async walkShepherd(herd: HerdRow, cfg: WatchdogConfig, now: number): Promise<void> {
    const key = `${herd.id}/${SHEPHERD}`;
    const verdict = evaluateShepherd(herd, this.sensors, cfg);
    if (verdict.kind !== "wedged") {
      this.ladders.delete(key);
      return;
    }
    const ladder = this.track(key, now);
    if (!this.canAct(key, ladder, now, cfg)) return;
    // Same re-read-before-commit as the worker path, for the same reason.
    const fresh = evaluateShepherd(herd, this.sensors, cfg);
    if (fresh.kind !== "wedged") {
      this.ladders.delete(key);
      return;
    }
    this.commit(key, ladder, now, 1, SHEPHERD_CAP);
    const ctx = { herd: herd.id, job: SHEPHERD, path: fresh.path, strike: ladder.strikes };
    if (ladder.strikes >= SHEPHERD_CAP || herd.shepherdPane === null) this.notify(herd.id, summaryText(key, fresh.evidence, ladder, now), herd.shepherdPane, cfg, now, ctx);
    else await this.poke(herd.shepherdPane, pokeText(fresh.evidence), ctx, "poked shepherd");
  }

  private track(key: string, now: number): Ladder {
    let ladder = this.ladders.get(key);
    if (!ladder) {
      ladder = { strikes: 0, lastPokeAt: null, since: now, parked: false };
      this.ladders.set(key, ladder);
    }
    return ladder;
  }

  /** True once retryMins has elapsed since the last action, without
      mutating anything: the caller re-reads the verdict before committing a
      strike, so gating must not itself stamp a strike for a reading that
      might turn out to have nothing to send. */
  private canAct(key: string, ladder: Ladder, now: number, cfg: WatchdogConfig): boolean {
    const last = ladder.lastPokeAt ?? this.lastActionAt.get(key) ?? null;
    return last === null || now - last >= ms(cfg.retryMins);
  }

  private commit(key: string, ladder: Ladder, now: number, floor: number, cap: number): void {
    ladder.strikes = Math.min(Math.max(ladder.strikes + 1, floor), cap);
    ladder.lastPokeAt = now;
    this.lastActionAt.set(key, now);
  }

  /** The adapter's own poke already logs warn for a real failure (herdr
      error, throw) and info for an expected refusal (queued, blocked at a
      prompt); the ladder logs every non-delivery at info so a routine
      refused-at-a-prompt every retryMins doesn't read as a warning here too. */
  private async poke(pane: string, text: string, ctx: object, event: string): Promise<void> {
    const delivered = await this.act.poke(pane, text);
    if (delivered) this.log.info({ ...ctx, pane }, event);
    else this.log.info({ ...ctx, pane }, `${event} (not delivered)`);
  }

  private notify(herd: string, summary: string, pane: string | null, cfg: WatchdogConfig, now: number, ctx: object): void {
    if (!cfg.notifyHuman) {
      this.log.info({ ...ctx, summary }, "human notification disabled");
      return;
    }
    const last = this.notifiedAt.get(herd);
    if (last !== undefined && now - last < ms(cfg.notifyQuietMins)) {
      this.log.debug({ ...ctx, summary }, "human notification suppressed by quiet period");
      return;
    }
    this.notifiedAt.set(herd, now);
    this.act.notifyHuman(summary, pane);
    this.log.info({ ...ctx, summary }, "notified human");
  }
}

/** The daemon's scheduleSweep tick, extracted so the wiring itself is
    testable: `sweep()` owns what "disabled" means (a reset, not a pause),
    so this must call it every tick regardless of enabled -- only the
    refresh is conditional, since there is nothing to read a fresh snapshot
    for if the sweep is about to reset and return. A short-circuit here
    that skips `sweep()` on disabled would make the reset unreachable. */
export async function runWatchdogSweep(deps: {
  watchdog: { readonly busy: boolean; sweep(): Promise<void> };
  sensors: { refresh(): Promise<void> };
  cfg(): WatchdogConfig;
}): Promise<void> {
  if (deps.watchdog.busy) return;
  if (deps.cfg().enabled) await deps.sensors.refresh();
  await deps.watchdog.sweep();
}
