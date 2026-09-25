#!/usr/bin/env bun

/**
 * rt daemon — entry point and orchestration layer.
 *
 * Runs as a long-lived Bun process managed by launchd.
 * Listens on a Unix domain socket at ~/.mattstack/rt/rt.sock (CLI/tray IPC) and on
 * 127.0.0.1:9401 (REST + WebSocket for external clients).
 *
 * Responsibilities:
 *  1. Watch .git/config for known repos → re-apply core.hooksPath if clobbered
 *  2. Proactively refresh branch/MR/Linear cache on a timer
 *  3. Serve cached data instantly to CLI commands via socket IPC
 *  4. Zero-config port discovery via lsof + CWD matching
 *
 * Structure: `buildUnits(ctx)` assembles the ordered `DaemonUnit[]` that IS
 * the boot order (spec §5.1). Each unit's `start()` both constructs and arms
 * its subsystem and writes any shared handle onto the `BootContext`; `stop()`
 * runs in reverse. Nothing arms at import; only the `import.meta.main` call
 * to `startDaemon()` at the bottom does. The 12-entry order and reverse-stop
 * teardown are covered by `__tests__/boot-order.test.ts`.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Server } from "bun";
import type { Logger } from "pino";
import type { Database } from "bun:sqlite";

import { RT_DIR, DAEMON_PID_PATH } from "./daemon-config.ts";
import { buildFlavor, captureProcessFlavor } from "./flavor.ts";
import {
  getDaemonLogger,
  installCrashHandlers,
  redirectNativeStderr,
  type DaemonLoggerHandle,
} from "./daemon-logger.ts";
import { onNotification, notifyEnabled, notifyEvent, loadNotificationPrefs } from "./notifier.ts";
import { checkInviteReplies, INVITE_REPLIES_NS, listInviteSlugs, MEMBER_JOINED_CATEGORY } from "./daemon/invite-replies.ts";
import { readInviteRecords } from "./team/invite-records.ts";
import { createRelayClient, inviteRelayUrl } from "./team/relay-client.ts";
import { openReply } from "./team/invite-crypto.ts";
import { base64ToKey, isValidAgePublicKey } from "./team/members.ts";
import { hasKvValue, setKvValueCritical } from "./state/kv-blob.ts";
import { appBundleRoot } from "./bundle-layout.ts";
import { reconcile as reconcileLinks } from "./deps/links.ts";
import { createRealProbes } from "./setup/probes.ts";
import { runAccountsSweep, type IntegrationTarget } from "./credential-health/sweep.ts";
import { INTEGRATIONS, type ValidateCtx } from "./setup/integrations.ts";
import type { Integration } from "./setup/contract.ts";
import { isValidHostname, isValidHttpsUrl } from "./setup/host-validate.ts";
import { discoverTeams, readTeamSnapshot, readUserIntegrationOverrides, type TeamSnapshot, type UserIntegrationOverrides } from "./setup/team-settings.ts";
import { createRealAgeKeySeam } from "./home/age-key.ts";
import { readSecret, createRealSecretsExecSeam, type SecretsSeams } from "./secrets/store.ts";

import { SystemProcessScanner } from "./daemon/system-process-scanner.ts";

import { parkUntilServable, probeSocketHolder, daemonFlavor, launchdLabelFromEnv } from "./daemon/park.ts";
import { evictStaleDaemon } from "./daemon/boot-reconcile.ts";
import { resolveUserPath } from "./daemon/user-path.ts";
import { shortReqId, makeSuppressor } from "./daemon/command-attribution.ts";
import { unknownCommandReply } from "./daemon/unknown-command.ts";
// Every state.db API is reached through the lib/state barrel, never through
// ./state/db.ts directly: importing the barrel is what guarantees every
// store module has registered its legacy-JSON importer before the one-shot
// v0->v1 migration runs (see lib/state/index.ts).
import { getBranchCacheStore, getStateDb, closeStateDb, persistOrWarn, prunePresence, pruneMessages, pruneAgents, markAgentGone, snapshotRegistryDeps, quickCheck, backupTo, stampedBackupPath, pruneStateBackups, setBusyLogSink, enqueueNotification, listAgents, getAgent, type BranchCacheStore } from "./state/index.ts";
import { createCacheRefresher } from "./daemon/cache-refresh.ts";
import { createWorktreeReconciler } from "./daemon/worktree-reconciler.ts";
import { loadRepoIndex } from "./daemon/repo-index.ts";
import { primeTeamTrackingIdentityMap } from "./repo-tracking.ts";
import { createHooksGuard } from "./daemon/hooks-guard.ts";
import { runBootIdentityMigration } from "./daemon/boot-migrate.ts";
import { runCapture } from "./subprocess.ts";
import { buildRoutedHandlers } from "./daemon/command-router.ts";
import { findRunningRunByWorktree } from "./runs/store.ts";
import { createChatDeliverySweep } from "./daemon/handlers/chat.ts";
import { startSocketServer } from "./daemon/socket-server.ts";
import { startApiServer, withApiPortParkRetry, broadcast, apiWsClientCount, clearWsClients } from "./daemon/api-server.ts";
import { deriveFailure } from "./daemon/failure.ts";
import { loadCronConfig, startCron } from "./daemon/cron.ts";
import { startPollers } from "./daemon/pollers.ts";
import { startHomeSnapshot } from "./daemon/home-snapshot.ts";
import { startTeamSnapshots } from "./daemon/team-snapshots.ts";
import { startAgentStatusPoller } from "./daemon/agent-status-poller.ts";
import { startNotifyBridge, parseEventBridgeRules, type EventBridgeRule } from "./notify-bridge.ts";
import { herdrRequest, herdrSocketPath } from "./herdr/client.ts";
import type { HerdrSnapshot } from "./daemon/handlers/pane.ts";
import {
  initFreshness,
  reconcileFreshness,
  disposeFreshness,
  getFreshnessSnapshot,
  type FreshnessEnv,
} from "./daemon/freshness.ts";
import { startLoopMonitor } from "./daemon/loop-monitor.ts";
import { createHealthSampler } from "./daemon/health-sampler.ts";
import { writeHeartbeat } from "./daemon/heartbeat-file.ts";
import { computeHealth } from "./daemon/health.ts";
import { isCrashLooping, readSupervisionState } from "./daemon/supervision-state.ts";
import { setSettingsWarnSink } from "./settings/resolve.ts";
import { createDiscussionsPoller } from "./daemon/discussions-poller.ts";
import { installSignalHandlers, removeRuntimeFiles } from "./daemon/shutdown.ts";
import { createEventsBus, type EventsBus } from "./daemon/events-bus.ts";
import { createGatesStore, type GatesStore } from "./daemon/gates-store.ts";
import { createGitBadges, type GitBadgesStore } from "./daemon/git-badges-store.ts";
import { createGitStatusSweep, type GitStatusSweep, type GitStatusConfig } from "./daemon/git-status-sweep.ts";
import { createHerdStore, type HerdStore } from "./daemon/herd-store.ts";
import { herdJobTreeHold } from "./daemon/reconciler/job-release.ts";
import { createHerdLifecycle, type HerdLifecycle } from "./daemon/herd-lifecycle.ts";
import { HerdWatchdog, runWatchdogSweep } from "./daemon/herd-watchdog.ts";
import { createWatchdogActuators, createWatchdogSensors, readWatchdogConfig } from "./daemon/herd-watchdog-adapters.ts";
import { driveRelocationAccept } from "./daemon/trust-accept.ts";
import { findTreeByPath } from "./worktree/registry.ts";
import { createBgService, type BgService } from "./daemon/bg-service.ts";
import { createBgClaimsStore, type BgClaimsStore } from "./daemon/bg-claims-store.ts";
import { createGatePush, type GatePush } from "./daemon/gate-push.ts";
import { createGateEscalation, type GateEscalation } from "./daemon/gate-escalation.ts";
import { createEscapeInjector } from "./daemon/gate-escape.ts";
import { createReconciler, type Reconciler } from "./daemon/reconciler.ts";
import { snapshotPanes, type LivePane } from "./daemon/pane-resolve-live.ts";
import type { CommandResult } from "./daemon/handlers/types.ts";
import { deliverToInbox } from "./daemon/inbox.ts";
import { resolveLiveInbox, resolveAllLiveInboxes } from "./claude-registry.ts";
import {
  writeBreadcrumb,
  recordBootAttempt,
  recordDaemonReady,
  recordBootFailure,
  recordCleanExit,
  type BootPhase,
} from "./daemon/supervision-state.ts";
import { safeInterval, safeTimeout, scheduleSweep } from "./daemon/safe-timers.ts";
import { BOOT_DELAY_MS as CD_CACHE_BOOT_DELAY_MS, REFRESH_MS as CD_CACHE_REFRESH_MS, refreshCdCache } from "./daemon/cd-cache-refresh.ts";
import { maybeSendTriageSummary, localDay, TRIAGE_CATEGORY } from "./daemon/triage-summary.ts";
import { getKvValue, setKvValue } from "./state/kv-blob.ts";
import { pruneRuns } from "./runs/prune.ts";
import { pruneLogs } from "./log-janitor.ts";
import { getSetting } from "./settings/resolve.ts";
import { releaseEndpointsForWorktree } from "./daemon/handlers/endpoint.ts";
import type { HandlerContext } from "./daemon/handlers/types.ts";
import type { PortEntry } from "./port-scanner.ts";
import { runUnits, stopUnits, type DaemonUnit } from "./daemon/lifecycle.ts";

// Legacy state migration (RT-46). Must run BEFORE the logger's first write can
// create the new rt dir and turn a clean rename of a real legacy tree into a
// conflict, so it is the first thing unit 1 does, above redirectNativeStderr.
// Idempotent: the CLI entry (cli.ts) also runs it, but `bun run lib/daemon.ts`
// skips cli.ts.
import { migrateLegacyRtDir, migrateLegacyPluginsDir, LEGACY_RT_LABEL, RT_DIR_LABEL, logsDir } from "./rt-paths.ts";

/**
 * A third copy of `ctxFor` (lib/setup/validators/accounts.ts and
 * commands/setup.ts each already carry one, by the same doc-comment
 * convention: no shared ConnectDeps to route it through). Only a host the
 * USER confirmed (rt.integrations, via `connect --host`) is ever eligible to
 * receive the accounts-sweep token; a team's declared host is surfaced as
 * `declaredHost` for the row's own detail text, never fetched against.
 */
function credentialHealthCtxFor(id: Integration, team: TeamSnapshot, overrides: UserIntegrationOverrides): ValidateCtx {
  const base = { team: { slug: team.slug, remote: team.remote }, linearTeamKey: team.integrations.linear?.teamKey ?? null };
  if (id === "gitlab") {
    const declaredHost = team.integrations.forge?.provider === "gitlab" ? team.integrations.forge.host : null;
    const host = overrides.forgeHost && isValidHostname(overrides.forgeHost) ? overrides.forgeHost : null;
    return { ...base, host, declaredHost };
  }
  if (id === "switchboard") {
    const declaredHost = team.integrations.switchboard?.url ?? null;
    const host = overrides.switchboardUrl && isValidHttpsUrl(overrides.switchboardUrl) ? overrides.switchboardUrl : null;
    return { ...base, host, declaredHost };
  }
  return { ...base, host: null };
}

const EMPTY_TEAM_SNAPSHOT: TeamSnapshot = { slug: "", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null };

type HandleCommand = (cmd: string, payload: any, signal?: AbortSignal) => Promise<any>;

export interface HandleCommandDeps {
  routeCommand: (cmd: string, payload: any, signal?: AbortSignal) => Promise<any>;
  /** Read as `ctx.log` on every call (not captured once), so this stays
   *  correct across the boot-time swap from the bootstrap logger to the real
   *  one (unit 1 reassigns `ctx.log` after `buildUnits` has already wired
   *  this closure). */
  ctx: { log: Logger };
  rejectSuppressor: ReturnType<typeof makeSuppressor>;
  redactDigest: (payload: any) => Record<string, unknown>;
  currentCmd: { cmd: string | null };
  slowCommandMs?: number;
}

/**
 * Wraps `routeCommand` with request-id stamping, reject/slow-command logging,
 * and a handler-throw safety net (R035): a thrown error becomes an additive
 * `{ ok: false, error, failure: { code, message } }` envelope instead of
 * propagating to the transport as an uncaught exception. `error` stays the
 * plain string every rt-client wrapper already displays; `failure` is the
 * new structured key, filled from the same throw.
 */
export function createHandleCommand(deps: HandleCommandDeps): HandleCommand {
  const { routeCommand, ctx, rejectSuppressor, redactDigest, currentCmd } = deps;
  const slowCommandMs = deps.slowCommandMs ?? 2000;
  return async (cmd, payload, signal) => {
    const t0 = Date.now();
    const reqId = shortReqId();
    const caller = payload && typeof payload._client === "string" ? payload._client : "unknown";
    currentCmd.cmd = cmd;
    try {
      const result = await routeCommand(cmd, payload, signal);
      const durationMs = Date.now() - t0;
      if (result && result.ok === false) {
        const key = `${cmd}|${result.error ?? ""}`;
        const { emit: shouldEmit, suppressed } = rejectSuppressor.check(key, Date.now());
        if (shouldEmit) {
          ctx.log.warn(
            { reqId, cmd, caller, error: result.error, durationMs, digest: redactDigest(payload), ...(suppressed ? { suppressed } : {}) },
            "command rejected",
          );
        }
        return { ...result, reqId };
      }
      if (durationMs > slowCommandMs) {
        ctx.log.info({ reqId, cmd, caller, durationMs }, "command handled (slow)");
      } else {
        ctx.log.debug({ reqId, cmd, caller, durationMs }, "command handled");
      }
      return result;
    } catch (err) {
      ctx.log.error({ err, reqId, cmd, caller, durationMs: Date.now() - t0, digest: redactDigest(payload) }, "command failed");
      const { code, message } = deriveFailure(err);
      return { ok: false, error: message, failure: { code, message }, reqId };
    } finally {
      currentCmd.cmd = null;
    }
  };
}

/**
 * The out-of-process / process-global operations a unit performs, injected so
 * the in-process boot test can supply fakes (servers, pid, crash/signal
 * handlers) without binding sockets or mutating the test runner's process.
 * Production supplies `realSeams()`.
 */
export interface BootSeams {
  redirectNativeStderr: () => void;
  /** Flavor/park gate; seamed so the boot test isn't subject to an ambient launchd label or a live rt.sock holder. */
  parkGate: (log: Logger) => Promise<void>;
  /** Login-shell PATH scrape (spawns shells); seamed so the boot test stays hermetic. */
  resolveUserPath: (log: Logger) => Promise<string>;
  installCrashHandlers: (handle: DaemonLoggerHandle, opts: { booting?: () => boolean }) => void;
  installSignalHandlers: (opts: {
    cleanup: () => void | Promise<void>;
    flushLogs: () => void;
    log: Logger;
    wasVerbShutdown: () => boolean;
  }) => void;
  bindApiServer: (handleCommand: HandleCommand, log: Logger) => Promise<Server<any>>;
  bindSocketServer: (handleCommand: HandleCommand, log: Logger) => Server<any>;
  writePid: (pid: number) => void;
  closeStateDb: () => void;
}

/**
 * Mutable state shared across units and read by `startDaemon`'s fatal-boot
 * handler. Units fill in the handles later units (or the test) consume by
 * name here rather than through a module singleton.
 */
export interface BootContext {
  seams: BootSeams;
  servers: { socket?: Server<any>; api?: Server<any> };
  log: Logger;
  loggerHandle?: DaemonLoggerHandle;
  stateDb?: Database;
  units: DaemonUnit[];
  bootPhase: "booting" | "ready";
  currentPhase: BootPhase;
  /** Optional ordered-event recorder for the boot-order test; unused in production. */
  spy?: string[];
}

function realSeams(): BootSeams {
  return {
    redirectNativeStderr,
    parkGate: (log) =>
      parkUntilServable({
        myFlavor: daemonFlavor(),
        probeHolder: probeSocketHolder,
        myLaunchdLabel: () => launchdLabelFromEnv(),
        sleep: (ms) => Bun.sleep(ms),
        log,
      }),
    resolveUserPath,
    installCrashHandlers,
    installSignalHandlers,
    bindApiServer: (handleCommand, log) =>
      withApiPortParkRetry(() => startApiServer({ handleCommand, log }), { sleep: (ms) => Bun.sleep(ms), log }),
    bindSocketServer: (handleCommand, log) => startSocketServer({ handleCommand, log }),
    writePid: (pid) => writeFileSync(DAEMON_PID_PATH, String(pid)),
    closeStateDb,
  };
}

/** A stand-in logger used only until unit 1 installs the real one on the ctx. */
function bootstrapLogger(): Logger {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop, level: "info" } as unknown as Logger;
}

export function makeBootContext(seamOverrides: Partial<BootSeams> = {}): BootContext {
  return {
    seams: { ...realSeams(), ...seamOverrides },
    servers: {},
    log: bootstrapLogger(),
    bootPhase: "booting",
    currentPhase: "start",
    units: [],
  };
}

/**
 * Builds the ordered `DaemonUnit[]`: the single source of truth for boot
 * order (spec §5.1). Every subsystem the daemon used to arm at module scope
 * is constructed inside the `start()` of its unit; shared handles are held in
 * this function's closure and mirrored onto `ctx` where the test or the
 * fatal-boot handler needs them.
 */
export function buildUnits(ctx: BootContext): DaemonUnit[] {
  const { seams } = ctx;

  // ─── Shared handles (assigned as units start; read by later units) ─────────
  let loggerHandle: DaemonLoggerHandle;
  let log: Logger = ctx.log;
  let eventsBus: EventsBus;
  let gatesStore: GatesStore;
  let herdStore: HerdStore;
  let herdLifecycle: HerdLifecycle | undefined;
  let herdWatchdog: HerdWatchdog | undefined;
  let bgClaims: BgClaimsStore;
  let gatePush: GatePush;
  let gateEscalation: GateEscalation;
  let reconciler: Reconciler;
  let gitBadges: GitBadgesStore;
  let gitStatusSweep: GitStatusSweep;
  let identity: {
    flavor: "dev" | "prod";
    version: string;
    sourceRev: string | null;
    startedAt: number;
  };
  let hooksGuard: ReturnType<typeof createHooksGuard>;
  let cron: ReturnType<typeof startCron>;
  let worktreeReconciler: ReturnType<typeof createWorktreeReconciler>;
  let refreshCache: () => Promise<void>;
  // Set in phase 6 ("background-subsystems"), read in phase 7 ("handlers")
  // when wiring the accounts-recheck IPC handler through buildRoutedHandlers.
  let accountsSweepFn: () => Promise<void>;
  let homeSnapshot: ReturnType<typeof startHomeSnapshot>;
  let teamSnapshots: ReturnType<typeof startTeamSnapshots>;
  let agentStatusPoller: ReturnType<typeof startAgentStatusPoller>;
  let notifyBridgeStop: (() => void) | undefined;
  let healthSampler: ReturnType<typeof createHealthSampler>;
  let healthInterval: ReturnType<typeof setInterval> | null = null;
  let loopMon: ReturnType<typeof startLoopMonitor>;
  let handlerCtx: HandlerContext;
  let freshnessEnv: FreshnessEnv;
  let routedHandlers: ReturnType<typeof buildRoutedHandlers> | undefined;
  let pollersHandle: ReturnType<typeof startPollers> | null = null;
  let discussionsPoller: ReturnType<typeof createDiscussionsPoller> | null = null;
  let freshnessInitTimer: ReturnType<typeof setTimeout> | null = null;

  // Shared by the reconciler's own dep (phase 4, "events-db") and the gate
  // handlers' answer-time executor guarantee (phase 7, "handlers"): both
  // relaunch through the SAME agent:resume verb, one closure so they can
  // never drift. routedHandlers (phase 7) is not built yet when phase 4
  // runs, so this always reads it fresh at call time, never before the
  // boot-delayed sweeps that are its only callers.
  const resumeAgent = async (agentId: string): Promise<{ ok: boolean; error?: string }> => {
    const handlers = routedHandlers;
    if (!handlers) return { ok: false, error: "daemon handlers not ready yet" };
    const res = await handlers["agent:resume"]!({ id: agentId }) as CommandResult<"agent:resume">;
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  };

  const sweepHandles: Array<{ stop(): void }> = [];
  // Shared with buildRoutedHandlers (phase 7) below, so the delivery sweep
  // (phase 6) and a normal chat:post/chat:dm push serialize through the
  // same per-(room,handle) chain instead of racing each other.
  const chatDeliveryChains = new Map<string, Promise<void>>();

  // ─── Plain, non-arming shared refs ─────────────────────────────────────────
  const systemProcessScanner = new SystemProcessScanner();

  // The branch-cache store, opened LAZILY: everything below is wired before the
  // state.db unit opens it, so it gets this façade: same BranchCacheStore
  // surface, resolved on first use. `entries` is a getter, never a captured
  // value, so it always yields the store's own live map object.
  let branchCacheStore: BranchCacheStore | null = null;
  const openBranchCacheStore = (): BranchCacheStore => {
    if (!branchCacheStore) branchCacheStore = getBranchCacheStore(getStateDb("daemon"));
    return branchCacheStore;
  };
  const cache: BranchCacheStore = {
    get entries() { return openBranchCacheStore().entries; },
    put:    (branch, entry)      => openBranchCacheStore().put(branch, entry),
    delete: (branch)             => openBranchCacheStore().delete(branch),
    reload: ()                   => openBranchCacheStore().reload(),
    gc:     (repos, maxAgeMs)    => openBranchCacheStore().gc(repos, maxAgeMs),
  };
  // Port scan cache, held as a single mutable ref so handler modules read fresh
  // values without getters; the port poller mutates it in place.
  const portCacheRef = { ports: [] as PortEntry[], updatedAt: 0 };
  // Refresh-cycle status ref (last cycle's outcome), also mutated in place.
  const refreshStatusRef = { lastRefreshAt: 0, lastSuccessAt: 0, failedRepos: 0, enrichErrors: 0 };
  const startedAt = Date.now();
  // In-flight command name, polled by the loop monitor to spot a handler that
  // never returns. Captured by the monitor's `currentCmd` closure.
  const currentCmd: { cmd: string | null } = { cmd: null };

  const rejectSuppressor = makeSuppressor(60_000);
  const SLOW_COMMAND_MS = 2000;

  // Set by the `shutdown` verb before it exits, so a bare OS signal arriving
  // mid-teardown is still distinguishable from the intentional stop.
  let shuttingDownViaVerb = false;

  // Reverse-order teardown; the shutdown verb and the signal handlers both
  // route through this.
  let units: DaemonUnit[] = [];
  const stopAll = (): Promise<void> => stopUnits(units, log);

  // Tracks the finer-grained boot phase for the breadcrumb file and for
  // attributing a fatal boot error to the phase it happened in. Db-free
  // (writeBreadcrumb only writes a file).
  const setPhase = (phase: BootPhase): void => {
    ctx.currentPhase = phase;
    writeBreadcrumb(phase);
  };

  // Injected at compile time via `bun build --define RT_VERSION=...` (see
  // cli.ts): undefined when running from source.
  const rtVersion = (): string => (typeof RT_VERSION !== "undefined" ? RT_VERSION : "source");

  // ─── Serving-core closures (defined once, invoked once units are wired) ────

  // Both fan-out reactions (cron, worktree:disposed) fire off eventsBus.fanOut,
  // keyed on the real (type, data) pair (not a wrapped "event" frame), so the
  // cron trigger match and the type check see exactly what they did as inline
  // branches. fanOut does NOT persist (only command-router's emitEvent path
  // writes rows), so emit() still writes zero rows to events.db.
  const emit: typeof broadcast = (type, data) => {
    broadcast(type, data);
    eventsBus.fanOut(type, data);
  };

  /** Loggable, secret-free summary of a command payload: top-level key names
   *  plus a whitelist of identifying fields safe to echo into logs. */
  const redactDigest = (payload: any): Record<string, unknown> => {
    if (!payload || typeof payload !== "object") return {};
    const keys = Object.keys(payload);
    const pick = (k: string): Record<string, unknown> => (payload[k] !== undefined ? { [k]: payload[k] } : {});
    return { keys, ...pick("repo"), ...pick("repoName"), ...pick("branch"), ...pick("iid"), ...pick("room") };
  };

  const routeCommand = async (cmd: string, payload: any, signal?: AbortSignal): Promise<any> => {
    const routed = routedHandlers?.[cmd];
    if (routed) return routed(payload, signal);

    switch (cmd) {
      case "shutdown":
        log.info("received shutdown command");
        // Set before the delay, not inside the callback: a bare SIGTERM in the
        // 100ms window must see this flag already true, or the signal handler
        // treats an intentional stop as a crash (exit 1, launchd respawns).
        shuttingDownViaVerb = true;
        // Delay teardown so this response is written first, then stopUnits
        // force-closes all in-flight connections, including the one that
        // carried the shutdown request.
        setTimeout(() => {
          void (async () => {
            recordCleanExit("shutdown", 0);
            await stopAll();
            loggerHandle.flush?.();
            process.exit(0);
          })();
        }, 100);
        return { ok: true, message: "shutting down" };

      default:
        return unknownCommandReply(cmd, rtVersion());
    }
  };

  const handleCommand: HandleCommand = createHandleCommand({
    routeCommand,
    ctx,
    rejectSuppressor,
    redactDigest,
    currentCmd,
    slowCommandMs: SLOW_COMMAND_MS,
  });

  /** Not cached: computeHealth is pure/cheap and every input is a live ref or a
   *  fast getter, so recomputing per call keeps the snapshot honest without a
   *  staleness window. */
  const buildHealthSnapshot = () => {
    const now = Date.now();
    const sup = readSupervisionState();
    const failuresLastHour = sup.recentFailures.filter((f) => f.at > now - 60 * 60_000).length;
    return computeHealth({
      now,
      uptimeMs: now - startedAt,
      mem: process.memoryUsage(),
      rssBaseline: healthSampler.rssBaseline(),
      wsClients: apiWsClientCount(),
      watchers: hooksGuard.watchedConfigs.size,
      freshness: getFreshnessSnapshot(),
      refresh: {
        lastSuccessAt: refreshStatusRef.lastSuccessAt,
        failedRepos: refreshStatusRef.failedRepos,
        enrichErrors: refreshStatusRef.enrichErrors,
      },
      refreshIntervalMs: 5 * 60_000,
      eventLoop: { ...loopMon.stats },
      supervisionFailuresLastHour: failuresLastHour,
      crashLooping: isCrashLooping(sup, now),
      loggerDegraded: loggerHandle.loggerDegraded?.() ?? false,
      recoveredErrorRateLastWindow: loggerHandle.recoveredErrorCount?.() ?? 0,
      freeBytes: healthSampler.freeBytes(),
    });
  };

  const logRetentionDays = (): number => {
    try {
      const v = getSetting<unknown>("rt.logRetentionDays").value;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : 14;
    } catch {
      return 14;
    }
  };

  // 0 is a meaningful value here (escalate on the first sweep), unlike
  // logRetentionDays's n > 0 guard -- so this only rejects negative/NaN.
  // A typeof guard (not Number(v)) matters because Number(null) === 0: an
  // explicitly-null stored setting must fall back to the default, not be
  // read as the valid "escalate immediately" value.
  const escalationTtlMinutes = (): number => {
    try {
      const v = getSetting<unknown>("rt.gates.escalationTtlMinutes").value;
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 10;
    } catch {
      return 10;
    }
  };

  const gitStatusConfig = (repoIdentity: string | null): GitStatusConfig => {
    try {
      const v = getSetting<Record<string, unknown>>(
        "rt.gitStatus",
        repoIdentity ? { repoIdentity } : undefined,
      ).value ?? {};
      const interval = Number((v as any).sweepIntervalSec);
      const f = Number((v as any).fetchIntervalSec);
      return {
        sweep: (v as any).sweep !== false,
        sweepIntervalSec: Number.isFinite(interval) && interval > 0 ? interval : 300,
        fetchIntervalSec: Number.isFinite(f) && f >= 0 ? f : 900,
      };
    } catch {
      return { sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 };
    }
  };

  const watchdogConfig = () => readWatchdogConfig(getSetting);
  // RT_HERD_WATCHDOG_SWEEP_MS replaces both the boot delay and the interval,
  // so a test daemon can be swept in well under the production minute.
  const watchdogSweepMs = (() => {
    const n = Number(process.env.RT_HERD_WATCHDOG_SWEEP_MS);
    return Number.isInteger(n) && n > 0 ? n : 60_000;
  })();

  // ─── The ordered unit list ─────────────────────────────────────────────────

  units = [
    // 1: stderr redirect + logger + crash handlers, first so any later throw
    // is captured; depends on nothing but paths.
    {
      name: "logger",
      async start() {
        const rtMigration = migrateLegacyRtDir();
        const pluginsMigration = migrateLegacyPluginsDir();
        seams.redirectNativeStderr();
        loggerHandle = await getDaemonLogger();
        log = loggerHandle.logger;
        ctx.loggerHandle = loggerHandle;
        ctx.log = log;
        // R052: route lib/state/busy.ts's busy-write warn/error lines onto
        // this process's own daemon surface, via the same childLogger a
        // handler's ctx.log would use — not the module's own dynamic
        // getDaemonLogger() default, which a CLI process sharing this code
        // would also fall into.
        setBusyLogSink({
          warn: (module, context, message) => loggerHandle!.childLogger(module).warn(context, message),
          error: (module, context, message) => loggerHandle!.childLogger(module).error(context, message),
        });
        // Route the settings resolver's dedup'd warn sink into structured
        // logging so a hot-path getSetting on a disallowed-scope key surfaces
        // once here instead of the resolver's console fallback.
        setSettingsWarnSink((m) => log.warn({ src: "settings" }, m));
        seams.installCrashHandlers(loggerHandle, { booting: () => ctx.bootPhase === "booting" });
        setPhase("start");
        if (pluginsMigration === "migrated") log.info("moved user plugins from rt/plugins to user/plugins");
        else if (pluginsMigration === "conflict") log.warn("plugins exist in both rt/plugins (retired) and user/plugins; only user/plugins is read");
        if (rtMigration === "migrated") {
          log.info(`migrated legacy ${LEGACY_RT_LABEL} state to ${RT_DIR_LABEL}`);
        } else if (rtMigration === "conflict") {
          log.warn(
            `rt state is split between ${LEGACY_RT_LABEL} and ${RT_DIR_LABEL}: the daemon reads only ` +
            `${RT_DIR_LABEL}; merge the legacy ${LEGACY_RT_LABEL} directory into it by hand, then delete it`,
          );
        }
      },
      stop() {},
    },

    // 2: flavor/park gate. MUST precede every subsystem that arms: below it
    // arm cron, the home-snapshot auto-committer and sweeps, and shutdown
    // SIGTERMs the shared rt.pid: a wrong-flavor daemon past this line would
    // kill the serving daemon and double-commit the home repo.
    {
      name: "park-gate",
      async start() {
        await seams.parkGate(log);
      },
      stop() {},
    },

    // 3: PATH resolution, before any unit that spawns git or herdr. Phase 6
    // made resolveUserPath async; this unit awaits it.
    {
      name: "path-resolution",
      async start() {
        // The user's full PATH overlaid onto the daemon's env: under launchd
        // the inherited PATH is /usr/bin:/bin:/usr/sbin:/sbin, so without this
        // nothing the daemon spawns can find node, pnpm, doppler or bun.
        // runCapture forwards process.env explicitly (Bun.spawn ignores this
        // assignment for its OWN executable resolution, which resolved at start).
        const resolvedPath = await seams.resolveUserPath(log);
        if (resolvedPath) process.env.PATH = resolvedPath;
        // Prepend the bundle's Helpers dir and ~/.local/bin (where tagged links
        // live). Call-time HOME (mirrors rt-paths.ts's own home()), not a
        // module-load constant.
        const home = (): string => process.env.HOME ?? homedir();
        const root = appBundleRoot();
        const prefix = [root ? join(root, "Contents", "Helpers") : null, join(home(), ".local", "bin")].filter(
          (p): p is string => p !== null,
        );
        process.env.PATH = [...prefix, process.env.PATH].filter(Boolean).join(":");
      },
      stop() {},
    },

    // 4: events.db (createEventsBus, with the quarantine guard) and
    // gates.db (createGatesStore, same guard) side by side -- both are
    // small daemon-local SQLite journals with no dependency on state.db.
    {
      name: "events-db",
      start() {
        // events-bus mkdirs its own dir; do RT_DIR too so the pid write and
        // state.db open below never race a missing parent.
        mkdirSync(RT_DIR, { recursive: true });
        eventsBus = createEventsBus({ dbPath: join(RT_DIR, "events.db"), log });
        gatesStore = createGatesStore({ dbPath: join(RT_DIR, "gates.db"), log });
        herdStore = createHerdStore({ dbPath: join(RT_DIR, "herds.db"), log });
        bgClaims = createBgClaimsStore({ dbPath: join(RT_DIR, "bg-claims.db"), log });
        // Session id -> socket resolution goes through the claude-registry
        // (pane inboxes), never a bespoke lookup: it's the same binding
        // rt chat delivery already resolves through.
        gatePush = createGatePush({
          store: gatesStore,
          deliver: deliverToInbox,
          // Liveness-checked, as the chat delivery path is: a pane that
          // crashed after its doorbell leaves its registry row behind, and
          // resolving on the row alone reads that as a live session whose
          // write merely failed, which is the one shape the dead-pane pass
          // must not miss.
          resolveSession: resolveLiveInbox,
          resolveAll: resolveAllLiveInboxes,
          log,
          injectEscape: createEscapeInjector(),
        });
        gateEscalation = createGateEscalation({
          store: gatesStore,
          ttlMs: () => escalationTtlMinutes() * 60_000,
          emit: (topic, payload) => {
            const emittedAt = Date.now();
            const eventId = eventsBus.emitAt(topic, payload, emittedAt);
            emit("event", { id: eventId, topic, payload, emittedAt });
          },
          log,
          herds: {
            shepherdPane: (id) => herdStore.get(id)?.shepherdPane ?? null,
            quietMs: () => watchdogConfig().notifyQuietMins * 60_000,
          },
        });
        reconciler = createReconciler({
          store: gatesStore,
          listAgents: () => listAgents({}, getStateDb("daemon")),
          snapshot: snapshotPanes,
          peek: async (pane: LivePane) => {
            const paneId = pane.paneRef.startsWith("bg:") ? pane.paneRef.slice("bg:".length) : pane.paneRef;
            const res = await herdrRequest<{ read: { text: string } }>(
              "pane.read", { pane_id: paneId, source: "visible" }, { sockPath: pane.sockPath },
            );
            return res.ok ? res.result.read.text : "";
          },
          emit: (topic, payload) => {
            const emittedAt = Date.now();
            const eventId = eventsBus.emitAt(topic, payload, emittedAt);
            emit("event", { id: eventId, topic, payload, emittedAt });
          },
          injectEscape: createEscapeInjector(),
          resumeAgent,
          markAgentGone: (agentId, at) => markAgentGone(agentId, at, getStateDb("daemon")),
          // RT-200: the same key the watchdog reads, resolved per attempt so
          // a settings flip needs no restart. Off maps to "no-dialog": the
          // normal attention-gate path takes the pane.
          relocationAccept: async (pane: LivePane) => {
            let enabled = true;
            try {
              const v = getSetting<unknown>("panes.relocationAutoAccept").value;
              if (typeof v === "boolean") enabled = v;
            } catch { /* unreadable key keeps the default */ }
            if (!enabled) return "no-dialog";
            // A herd worker's pane belongs to the watchdog's modal ladder:
            // two seams driving one dialog can race the loser's Enter onto
            // whatever paints after it clears, so the reconciler stands
            // down for panes an active herd job owns.
            try {
              for (const herd of herdStore.list({ status: "active" })) {
                if (herdStore.jobs(herd.id).some((j) => j.pane === pane.paneRef)) return "no-dialog";
              }
            } catch {
              return "no-dialog";
            }
            const paneId = pane.paneRef.startsWith("bg:") ? pane.paneRef.slice("bg:".length) : pane.paneRef;
            const outcome = await driveRelocationAccept({
              herdr: herdrRequest, sock: { sockPath: pane.sockPath }, pane: paneId,
              log, context: { paneRef: pane.paneRef },
              isRegisteredTree: (path) => findTreeByPath(path) !== null,
            });
            if (outcome === "accepted") return "accepted";
            // "unchecked" is a screen nobody could read: evidence of
            // nothing, so it keeps the normal attention-gate path rather
            // than claiming a prompt nobody saw.
            if (outcome === "no-dialog" || outcome === "unchecked") return "no-dialog";
            return "failed";
          },
          notify: (n) => {
            enqueueNotification({
              id: crypto.randomUUID(), title: n.title, message: n.message,
              category: "reconciler", timestamp: Date.now(), paneId: n.paneId,
            }, getStateDb("daemon"));
          },
          log,
        });
        setPhase("events-db");
      },
      stop() {
        // Optional chaining: a throw earlier in start() (before either is
        // assigned) must surface as ITS OWN error, not a masking TypeError
        // from stop() reaching into an undefined variable.
        eventsBus?.close();
        gatesStore?.close_();
        herdStore?.close_();
        bgClaims?.close_();
      },
    },

    // 5: state.db (open + migrate) before serving, per the state.db spec's
    // contention rule. The one long transaction is the legacy-JSON import; it
    // must never land inside the event loop, so a mid-import CLI blocks here.
    {
      name: "state-db",
      start() {
        setPhase("state-db");
        openBranchCacheStore();
        ctx.stateDb = getStateDb("daemon");
        recordBootAttempt();
        log.info({ count: Object.keys(cache.entries).length }, "branch cache loaded from state.db");
        // Integrity check, not a boot gate (R055): a state.db that fails
        // quick_check should be loud, not fatal -- the daemon still has a
        // repo-index-backed cache path and rt state restore is the recovery,
        // not a crash loop.
        const problems = quickCheck(ctx.stateDb);
        if (problems.length > 0) log.warn({ problems }, "state.db failed PRAGMA quick_check");
        // One-shot re-key of every legacy NAME-keyed store row onto its
        // serialized repo identity. Fire-and-forget: it must be on the boot
        // path (before anything prunes the repo index) but not block the
        // socket bind: a prune only arrives as a command to a running daemon.
        runBootIdentityMigration(log).catch((err) => {
          log.warn({ err }, "boot identity migration failed");
        });
        // Best-effort presence prune at startup; a concurrent CLI writer's
        // SQLITE_BUSY must not abort startup before the socket binds.
        let prunedPresence = 0;
        persistOrWarn("daemon", () => { prunedPresence = prunePresence(Date.now(), getStateDb("daemon"), snapshotRegistryDeps()); }, { op: "prunePresence" });
        if (prunedPresence > 0) log.info({ prunedPresence }, "chat: pruned stale presence rows at daemon startup");
      },
      stop() {
        seams.closeStateDb();
      },
    },

    // 6: background subsystems: hooks guard, cron, reconciler, home-snapshot,
    // agent-status poller, health sampler, loop monitor, and the sweep units.
    {
      name: "background-subsystems",
      async start() {
        // Daemon self-description. Only a dev daemon runs from a real checkout,
        // so only dev can shell out for the commit it serves from.
        const sourceRev = buildFlavor() === "dev"
          ? await runCapture(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir, timeoutMs: 5_000 })
              .then((r) => r.stdout.trim() || null)
              .catch(() => null)
          : null;
        identity = { flavor: daemonFlavor(), version: rtVersion(), sourceRev, startedAt };

        hooksGuard = createHooksGuard(log);

        gitBadges = createGitBadges(getStateDb("daemon"));
        gitStatusSweep = createGitStatusSweep({
          repoIndex: () => loadRepoIndex(),
          store: gitBadges,
          log,
          emit,
          readConfig: gitStatusConfig,
        });

        // Periodic sweeps (events retention, run prune, log prune): each gets a
        // boot-time fire plus its recurring interval via scheduleSweep, and its
        // stop handle joins the reverse-stop below.
        sweepHandles.push(scheduleSweep(
          "events-sweep",
          () => { eventsBus.sweep(); },
          { bootDelayMs: 30_000, intervalMs: 60 * 60 * 1000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "gates-sweep",
          () => { gatesStore.sweep(); },
          { bootDelayMs: 30_000, intervalMs: 60 * 60 * 1000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "gate-nudge-retry",
          async () => { await gatePush.retryDeadPanes(); },
          { bootDelayMs: 30_000, intervalMs: 30_000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "gate-escalation",
          () => { gateEscalation.sweep(); },
          { bootDelayMs: 30_000, intervalMs: 60_000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "reconciler-sweep",
          async () => { await reconciler.sweep(); },
          { bootDelayMs: 30_000, intervalMs: 60_000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "runs-prune",
          () => {
            const { removed } = pruneRuns();
            if (removed.length > 0) log.info({ removed: removed.length }, "pruned old pipeline runs");
          },
          { bootDelayMs: 60_000, intervalMs: 24 * 60 * 60 * 1000 },
          log,
        ));
        // rt.logRetentionDays is read fresh each sweep so a mid-run settings
        // change takes effect on the next tick.
        sweepHandles.push(scheduleSweep(
          "logs-prune",
          () => {
            const { removed } = pruneLogs(logsDir(), logRetentionDays(), Date.now(),
              (phase, err, file) => log.warn({ err, phase, file }, "log prune step failed"));
            if (removed.length > 0) log.info({ removed: removed.length }, "pruned old surface logs");
          },
          { bootDelayMs: 60_000, intervalMs: 24 * 60 * 60 * 1000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "chat-prune",
          () => {
            const { removed } = pruneMessages(getStateDb("daemon"));
            if (removed > 0) log.info({ removed }, "pruned old chat messages");
          },
          { bootDelayMs: 60_000, intervalMs: 24 * 60 * 60 * 1000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "agents-prune",
          () => {
            const { removed } = pruneAgents(getStateDb("daemon"));
            if (removed > 0) log.info({ removed }, "pruned old agent records");
          },
          { bootDelayMs: 60_000, intervalMs: 24 * 60 * 60 * 1000 },
          log,
        ));
        // Invites last at most 7 days and only exist on the owner's machine,
        // so the switchboard read is a no-op almost everywhere.
        sweepHandles.push(scheduleSweep(
          "invite-replies",
          async () => {
            const probes = createRealProbes();
            const relay = createRelayClient(probes.fetch, inviteRelayUrl(probes.env));
            const db = getStateDb("daemon");
            const { notified } = await checkInviteReplies({
              slugs: () => listInviteSlugs(probes.home),
              records: (slug) => readInviteRecords(probes, slug),
              readReply: (id, creatorSecret) => relay.readReply(id, creatorSecret),
              openReply: async (blob, keyB64, id) => {
                const opened = await openReply(blob, base64ToKey(keyB64), id);
                if (!isValidAgePublicKey(opened.agePublicKey)) throw new Error("reply's age public key is not a well-formed age1 recipient");
                return opened.agePublicKey;
              },
              isNotified: (id) => hasKvValue(INVITE_REPLIES_NS, id, db),
              // Critical: a dropped mark re-announces the same reply next sweep.
              markNotified: (id, outcome) => { setKvValueCritical(INVITE_REPLIES_NS, id, { outcome, at: Date.now() }, db); },
              notify: notifyEvent,
              enabled: () => loadNotificationPrefs()[MEMBER_JOINED_CATEGORY] !== false,
              now: () => Date.now(),
              // An unreachable relay repeats every tick while offline; that is debug, not a warning.
              warn: (message) => (message.includes("relay-unreachable") ? log.debug : log.warn).call(log, { sweep: "invite-replies" }, message),
            });
            for (const n of notified) log.info({ team: n.slug, handle: n.handle }, "invite reply landed; owner notified");
          },
          { bootDelayMs: 90_000, intervalMs: 5 * 60 * 1000 },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "state-backup",
          async () => {
            const { isBackupConfigured, runFullBackup, pruneOldBackups } = await import("./state/backup-orchestrator");

            if (!isBackupConfigured()) {
              backupTo(getStateDb("daemon"), stampedBackupPath());
              const { removed } = pruneStateBackups();
              if (removed.length > 0) log.info({ removed: removed.length }, "pruned old state.db backups");
              return;
            }

            try {
              const result = await runFullBackup();

              if (result.backed.length === 0 && result.skipped.length === 0 && result.errors.length > 0) {
                log.error({ errors: result.errors }, "all encrypted sources failed, falling back to local");
                backupTo(getStateDb("daemon"), stampedBackupPath());
                pruneStateBackups();
                return;
              }

              log.info(
                { backed: result.backed.length, errors: result.errors.length },
                "encrypted state backup complete",
              );
              if (result.errors.length > 0) {
                log.warn({ errors: result.errors }, "backup errors");
              }

              const { removed } = await pruneOldBackups();
              if (removed.length > 0) {
                log.info({ removed: removed.length }, "pruned old encrypted backups");
              }
            } catch (err) {
              log.error({ err }, "encrypted backup failed, falling back to local");
              backupTo(getStateDb("daemon"), stampedBackupPath());
              pruneStateBackups();
            }
          },
          { bootDelayMs: 60_000, intervalMs: 4 * 60 * 60 * 1000 },
          log,
        ));
        // Cadence lives in rt.gitStatus (read fresh each tick inside the sweep), so the
        // timer interval here is only the polling floor, not the sweep rate.
        sweepHandles.push(scheduleSweep(
          "git-status-sweep",
          async () => { await gitStatusSweep.tick(); },
          { bootDelayMs: 45_000, intervalMs: 60_000 },
          log,
        ));
        // Periodically re-validates every stored integration credential
        // (RT-132): resolves one target per integration that has a stored
        // secret, runs runAccountsSweep, and fires a desktop notification on
        // a dead/expiring transition. accountsSweepFn is also handed to
        // buildRoutedHandlers (phase 7) below as the accounts-recheck IPC
        // handler's implementation, so `rt accounts --recheck` runs this
        // exact same cycle on demand instead of waiting for the interval.
        const accountsProbes = createRealProbes();
        const accountsSecretsSeams: SecretsSeams = { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
        accountsSweepFn = async () => {
          const teams = discoverTeams(accountsProbes);
          const team = teams[0] ? readTeamSnapshot(accountsProbes, teams[0]) : EMPTY_TEAM_SNAPSHOT;
          const overrides = readUserIntegrationOverrides();

          const targets: IntegrationTarget[] = [];
          for (const [id, def] of Object.entries(INTEGRATIONS)) {
            if (!def.secret) continue;
            let token: string | null;
            try {
              token = await readSecret(def.secret.domain, def.secret.key, accountsSecretsSeams);
            } catch (err) {
              log.warn({ err, integration: id }, "accounts-sweep: readSecret failed");
              continue;
            }
            if (!token) continue;
            const ctx = credentialHealthCtxFor(id as Integration, team, overrides);
            targets.push({ id, def, token, ctx });
          }

          await runAccountsSweep({
            db: getStateDb("daemon"),
            targets: async () => targets,
            probes: accountsProbes,
            notifyEnabled,
            emitEvent: (topic, payload) => {
              const emittedAt = Date.now();
              const eventId = eventsBus.emitAt(topic, payload, emittedAt);
              emit("event", { id: eventId, topic, payload, emittedAt });
            },
            now: () => Date.now(),
            log: loggerHandle.childLogger("accounts-sweep"),
          });
        };
        sweepHandles.push(scheduleSweep(
          "accounts-sweep",
          accountsSweepFn,
          { bootDelayMs: 90_000, intervalMs: 6 * 60 * 60 * 1000 },
          log,
        ));
        // Catches a chat delivery that neither deliverPost's own retry nor a
        // later post to the same recipient recovered -- the case a 2-party
        // DM at a wait-point can hit, since neither side sends again.
        const chatDeliverySweep = createChatDeliverySweep({
          db: getStateDb("daemon"),
          deliveryChains: chatDeliveryChains,
          log: loggerHandle.childLogger("chat"),
        });
        sweepHandles.push(scheduleSweep(
          "chat-delivery-sweep",
          async () => { await chatDeliverySweep(); },
          { bootDelayMs: 30_000, intervalMs: 30_000 },
          log,
        ));
        // Keeps cd-cache.json warm for `rt cd`; uses the async repo-index
        // builder, never execSync, since this runs on the daemon thread.
        sweepHandles.push(scheduleSweep(
          "cd-cache-refresh",
          () => refreshCdCache(loggerHandle.childLogger("cd-cache")),
          { bootDelayMs: CD_CACHE_BOOT_DELAY_MS, intervalMs: CD_CACHE_REFRESH_MS },
          log,
        ));
        sweepHandles.push(scheduleSweep(
          "worktree-triage-summary",
          async () => { await maybeSendTriageSummary({
            now: () => new Date(),
            counts: async () => {
              const res = await handleCommand("worktree:triage", {});
              return res.ok ? res.data.counts : { needsDecision: 0, safe: 0 };
            },
            notify: (title, message) => notifyEnabled(TRIAGE_CATEGORY, title, message, undefined, undefined, `worktree-triage-${localDay(new Date())}`),
            loadLastSent: () => getKvValue<string | null>("worktree-triage", "last-summary-day", null),
            saveLastSent: (day) => setKvValue("worktree-triage", "last-summary-day", day),
          }); },
          { bootDelayMs: 60_000, intervalMs: 15 * 60_000 },
          log,
        ));

        // Cron trigger layer (mechanism-only): sees every broadcast frame.
        cron = startCron(loadCronConfig(log), { log });
        eventsBus.onBroadcast((type, data) => cron.onBroadcast(type, data));
        eventsBus.onBroadcast((type, data) => {
          if (type !== "worktree:disposed") return;
          const d = data as { repo?: string; path?: string };
          if (d?.repo && d?.path) releaseEndpointsForWorktree({ log }, d.repo, d.path);
        });

        // Worktree lifecycle reconciler. Kicked detached off the tail of every
        // cache refresh; `emit` (not bare broadcast) so reconciler events also
        // reach the cron trigger layer.
        worktreeReconciler = createWorktreeReconciler({
          cache,
          repoIndex: loadRepoIndex,
          emit,
          log,
          findRunningRunByWorktree,
          jobTreeHold: (rec) => herdJobTreeHold(herdStore, rec),
        });

        refreshCache = createCacheRefresher({
          log, cache, refreshStatusRef, portCacheRef,
          repoIndex: loadRepoIndex,
          broadcast: emit,
          statusSnapshot: () => handleCommand("tray:status", {}),
          reconcileSubscriptions: () => reconcileFreshness(freshnessEnv),
          worktreeKick: worktreeReconciler.kick,
        });

        // Home-repo snapshot daemon: watches ~/.mattstack/user, auto-commits
        // outside a claimed zone. Construction builds and arms it; inert on its
        // own if rt.homeSnapshot is disabled or ~/.mattstack/user isn't a repo.
        homeSnapshot = startHomeSnapshot({
          log: loggerHandle.childLogger("home-snapshot"),
          broadcast: emit,
        });

        // Never awaited here: `ready` only settles boot-time scan/watch
        // arming and always resolves (never rejects), so awaiting it would
        // just delay boot for no signal this path needs.
        teamSnapshots = startTeamSnapshots({
          log: loggerHandle.childLogger("team-snapshots"),
          broadcast: emit,
        });

        // Herdr agent-status transitions write no run event, so the mirror on
        // run summaries needs its own change detector.
        agentStatusPoller = startAgentStatusPoller({
          emitEvent: (topic, payload) => {
            const emittedAt = Date.now();
            const id = eventsBus.emitAt(topic, payload, emittedAt);
            emit("event", { id, topic, payload, emittedAt });
          },
          log: loggerHandle.childLogger("agent-status"),
        });

        // Settings-driven notifier event bridge: turns a matching
        // events-bus broadcast into a queued desktop notification,
        // suppressed when the event's paneId is the currently focused
        // herdr pane. rules() re-reads rt.notify.eventBridges per event so
        // a settings edit takes effect live, without a daemon restart.
        const notifyBridgeLog = loggerHandle.childLogger("notify-bridge");
        notifyBridgeStop = startNotifyBridge({
          onBroadcast: eventsBus.onBroadcast,
          rules: (): EventBridgeRule[] => {
            let raw: unknown;
            try {
              raw = getSetting<unknown>("rt.notify.eventBridges").value;
            } catch (err) {
              notifyBridgeLog.warn({ err }, "rt.notify.eventBridges: getSetting threw");
              return [];
            }
            return parseEventBridgeRules(raw, (o, msg) => { notifyBridgeLog.warn(o, msg); });
          },
          enqueue: enqueueNotification,
          paneFocused: async (paneId: string): Promise<boolean> => {
            try {
              const snap = await herdrRequest<{ snapshot: HerdrSnapshot }>("session.snapshot", {});
              if (!snap.ok) return false;
              const pane = snap.result.snapshot.panes.find((p) => p.pane_id === paneId);
              return pane?.focused === true;
            } catch {
              return false;
            }
          },
          log: notifyBridgeLog,
        });

        // 5-min metrics log + the two cached signals health needs.
        healthSampler = createHealthSampler({
          log,
          rtDir: RT_DIR,
          wsClients: apiWsClientCount,
          watchers: () => hooksGuard.watchedConfigs.size,
          startedAt,
        });
        healthSampler.sample(); // seed baseline/free now, don't wait 5min
        healthInterval = safeInterval(() => healthSampler.sample(), 5 * 60_000, "health-sample", log);

        // 250ms event-loop drift monitor; also writes the cross-process
        // liveness heartbeat file every ~2s. Both timers unref'd and db-free.
        loopMon = startLoopMonitor({
          log,
          currentCmd: () => currentCmd.cmd,
          onHeartbeat: (at, seq) => writeHeartbeat(RT_DIR, { at, seq }),
        });
      },
      stop() {
        loopMon?.stop();
        if (healthInterval) clearInterval(healthInterval);
        agentStatusPoller?.stop();
        notifyBridgeStop?.();
        homeSnapshot?.stop();
        teamSnapshots?.stop();
        for (const h of sweepHandles) h.stop();
        cron?.dispose();
        hooksGuard?.closeAll();
      },
    },

    // 7: handlers (buildRoutedHandlers over the started subsystems).
    {
      name: "handlers",
      start() {
        handlerCtx = {
          cache, refreshCache,
          log,
          startedAt,
          identity,
          portCacheRef,
          watchedConfigs: hooksGuard.watchedConfigs,
          repoIndex: loadRepoIndex,
          checkAndRepairHooksPath: hooksGuard.checkAndRepairHooksPath,
          startWatchingRepo: hooksGuard.startWatchingRepo,
          refreshStatusRef,
          getHealth: buildHealthSnapshot,
          heartbeatSeq: loopMon.seq,
          setLogLevel: (l) => { log.level = l; log.info({ level: l }, "log level changed"); },
          getLogLevel: () => log.level,
        };
        freshnessEnv = { ctx: handlerCtx, broadcast: emit };
        const bgService: BgService = createBgService({ log });
        routedHandlers = buildRoutedHandlers({
          ctx: handlerCtx,
          broadcast: emit,
          systemProcessScanner,
          worktree: {
            emit,
            kick: worktreeReconciler.kick,
            cdCacheKick: () => void refreshCdCache(loggerHandle.childLogger("cd-cache")),
            creationInFlight: worktreeReconciler.creationInFlight,
            withReconcilerHeld: worktreeReconciler.withReconcilerHeld,
            findRunningRunByWorktree,
          },
          eventsBus,
          gatesStore,
          gatePush,
          reconciler,
          resumeAgent,
          getAgentRecord: (agentId) => getAgent(agentId, getStateDb("daemon")),
          herdStore,
          // The lifecycle is built from this router's own gate/chat handlers,
          // so it cannot exist yet; the holder delegates once it does.
          herdLifecycle: {
            connected: (socket) => herdLifecycle?.connected(socket) ?? false,
            watch: (socket) => herdLifecycle?.watch(socket),
            sweepClaims: () => herdLifecycle?.sweepClaims() ?? Promise.resolve(),
          },
          herdWatchdog: { annotations: (herd, job) => herdWatchdog?.annotations(herd, job) ?? null },
          herdJobsRoot: join(RT_DIR, "herds"),
          bgService,
          bgClaims,
          homeSnapshot,
          teamSnapshots,
          repos: {
            withReconcilerHeld: worktreeReconciler.withReconcilerHeld,
            refreshWatchedRepos: hooksGuard.refreshWatchedRepos,
          },
          gitBadges,
          gitStatusSweep,
          stateDb: getStateDb("daemon"),
          chatDeliveryChains,
          accountsSweep: accountsSweepFn,
        });
        herdLifecycle = createHerdLifecycle({
          store: herdStore,
          gate: { "gate:close": routedHandlers["gate:close"]!, "gate:list": routedHandlers["gate:list"]! },
          chat: { "chat:post": routedHandlers["chat:post"]! },
          bus: eventsBus,
          gateStore: gatesStore,
          defaultSocket: herdrSocketPath(),
          bgSocket: bgService.socketPath(),
          bgClaims,
          watchdogEnabled: () => watchdogConfig().enabled,
          log,
        });
        herdLifecycle.start();
        const watchdogLog = loggerHandle.childLogger("herd-watchdog");
        const watchdogSensors = createWatchdogSensors({
          herdStore, gatesStore, lifecycle: herdLifecycle, herdr: herdrRequest,
          defaultSocket: herdrSocketPath(), db: getStateDb("daemon"), log: watchdogLog,
        });
        const watchdog = new HerdWatchdog({
          sensors: watchdogSensors,
          act: createWatchdogActuators({ herdStore, db: getStateDb("daemon"), socketFor: watchdogSensors.socketFor, herdr: herdrRequest, log: watchdogLog }),
          cfg: watchdogConfig,
          log: watchdogLog,
        });
        herdWatchdog = watchdog;
        sweepHandles.push(scheduleSweep(
          "herd-watchdog",
          () => runWatchdogSweep({ watchdog, sensors: watchdogSensors, cfg: watchdogConfig }),
          { bootDelayMs: watchdogSweepMs, intervalMs: watchdogSweepMs },
          log,
        ));
      },
      stop() {
        herdLifecycle?.stop();
      },
    },

    // 8: API server. A failed bind exits fatally (fatal-boot handler), and
    // binding API before the unix socket means that exit never strands a
    // socket-bound zombie. evictStaleDaemon first, so an orphan holding the
    // socket/port is gone before either bind.
    {
      name: "api-server",
      async start() {
        await evictStaleDaemon(log);
        // Auto-unlink any tagged tool link whose tool now has a genuine user
        // copy elsewhere on PATH. reconcile() is synchronous; setTimeout(0)
        // pushes it past the server binds and pid write below.
        setTimeout(() => {
          try {
            const { removed } = reconcileLinks(createRealProbes());
            if (removed.length > 0) log.info({ removed }, "deps: auto-unlinked tools now shadowed by a user copy");
          } catch (err) {
            log.warn({ err }, "deps: link reconcile failed");
          }
        }, 0);
        log.info("daemon starting");
        setPhase("api");
        ctx.servers.api = await seams.bindApiServer(handleCommand, log);
      },
      stop() {
        try { ctx.servers.api?.stop(true); } catch { /* server already stopped */ }
        clearWsClients();
      },
    },

    // 9: socket server.
    {
      name: "socket-server",
      start() {
        setPhase("socket");
        ctx.servers.socket = seams.bindSocketServer(handleCommand, log);
      },
      stop() {
        try { ctx.servers.socket?.stop(true); } catch { /* server already stopped */ }
      },
    },

    // 10: rt.pid, written only after both servers are bound: a boot that fails
    // before this point must never leave a live-pid file with no servers.
    {
      name: "rt-pid",
      start() {
        seams.writePid(process.pid);
      },
      stop() {
        // Reverse-stop runs this before the server units stop; the ownership
        // check keeps that safe (unlinks only if rt.pid still names this pid).
        removeRuntimeFiles({ log });
      },
    },

    // 11: pollers, freshness, discussions poller (plus the serving-startup
    // kicks that follow the pid write today).
    {
      name: "pollers",
      start() {
        // Wire notification broadcasts to WebSocket clients.
        onNotification(emit);
        // Discover and watch repos.
        hooksGuard.refreshWatchedRepos();
        // Team tracking intent resolves through a primed identity→name map;
        // the 60s hooks-scan poller is the only re-prime mechanism now that the
        // repo index lives in state.db.
        primeTeamTrackingIdentityMap(loadRepoIndex()).catch((err) => {
          log.warn({ err }, "repo-tracking: failed to prime team-intent identity map");
        });

        pollersHandle = startPollers({
          log, refreshCache, portCacheRef, broadcast: emit, systemProcessScanner,
          repoIndex: loadRepoIndex,
          checkAndRepairHooksPath: hooksGuard.checkAndRepairHooksPath,
        });

        // Kick off the events watchers once the first refresh has populated the
        // cache with repoName stamps. reconcileFreshness (via the cache
        // refresher) follows repo-index changes from there.
        freshnessInitTimer = safeTimeout(() => {
          initFreshness(freshnessEnv).catch((err) => {
            log.error({ err }, "freshness: init failed");
          });
        }, 7000, "freshness-init", log);

        // Background sweep for new MR comments → `discussions:new-comments`.
        discussionsPoller = createDiscussionsPoller({ ctx: handlerCtx, broadcast: emit });
        discussionsPoller.start();
      },
      stop() {
        if (freshnessInitTimer) clearTimeout(freshnessInitTimer);
        // disposeFreshness/reconcileFreshness operate on the shared default
        // core the handlers, cache-refresh and command-router also read, so the
        // daemon drives that core rather than a forked createFreshness instance
        // (adopting the instance is 5.3's per-factory dep work).
        disposeFreshness();
        discussionsPoller?.stop();
        pollersHandle?.stop();
      },
    },

    // 12: signal handlers, then the ready breadcrumb.
    {
      name: "ready",
      start() {
        seams.installSignalHandlers({
          cleanup: stopAll,
          flushLogs: () => loggerHandle.flush?.(),
          log,
          wasVerbShutdown: () => shuttingDownViaVerb,
        });
        ctx.bootPhase = "ready";
        recordDaemonReady();
        setPhase("ready");
        log.info({ pid: process.pid }, "daemon ready");
      },
      stop() {},
    },
  ];

  ctx.units = units;
  return units;
}

/**
 * Construct the boot context, run the ordered units, and on any unit-start
 * failure log fatal + record the boot-failure phase + exit(1) (runUnits has
 * already stopped the units that did start, in reverse). Signal handlers are
 * installed by the ready unit; the shutdown verb and signals both derive
 * teardown from stopUnits.
 */
export async function startDaemon(opts?: { seams?: Partial<BootSeams> }): Promise<void> {
  const ctx = makeBootContext(opts?.seams ?? {});
  const units = buildUnits(ctx);
  try {
    await runUnits(units, ctx.log);
  } catch (err) {
    ctx.log.fatal?.({ err }, "daemon boot failed");
    recordBootFailure(ctx.currentPhase, String(err));
    try { ctx.loggerHandle?.flush?.(); } catch (flushErr) { ctx.log.warn?.({ err: flushErr }, "daemon boot log flush failed"); }
    process.exit(1);
  }
}

// Injected at compile time via `bun build --define RT_VERSION='"v1.x.x"'`.
declare const RT_VERSION: string | undefined;

// Auto-run when executed directly (source mode: bun run lib/daemon.ts).
if (import.meta.main) {
  captureProcessFlavor();
  startDaemon();
}
