/**
 * Flavor park. Runs at the TOP of lib/daemon.ts module scope: everything
 * below it arms live subsystems (cron, the home-snapshot auto-committer,
 * sweeps) and startDaemon() SIGTERMs the shared rt.pid — so a daemon that
 * is not this machine's intended flavor must never get past this function.
 * Parking is a loop, not an exit: KeepAlive={SuccessfulExit:false} on both
 * flavor plists means exiting would respawn-churn, and staying alive lets
 * a toggle flip convert this process into the serving daemon within one
 * cycle. Standoff waits out only a live holder of a DIFFERENT known
 * flavor — a same-flavor holder (restart orphan) or an unidentified one
 * returns instead, so startDaemon()'s evictStaleDaemon still owns those
 * cases exactly as it did before this gate existed.
 */
import type { IntendedMode } from "../dev-mode.ts";
import { resolveIntendedMode } from "../dev-mode.ts";
import { DAEMON_SOCK_PATH } from "../daemon-config.ts";

declare const RT_VERSION: string | undefined;

export function daemonFlavor(): "dev" | "prod" {
  return typeof RT_VERSION !== "undefined" ? "prod" : "dev";
}

export interface SocketHolder {
  flavor: string;
  pid: number | null;
}

export interface ParkDeps {
  myFlavor: "dev" | "prod";
  resolveIntent: () => IntendedMode;
  probeHolder: () => Promise<SocketHolder | null>;
  sleep: (ms: number) => Promise<void>;
  log: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  /** The mattstack daemon label of the launchd job that started this process,
      or null when launchd did not start it (foreground `rt daemon`, e2e). */
  myLaunchdLabel: () => string | null;
  /** The label the CURRENT mode says should be serving. Read inside the loop,
      never cached, so flipping dev-mode releases a parked daemon. */
  activeLaunchdLabel: () => string;
}

/**
 * The label of the launchd job that started us, or null if launchd did not.
 * launchd sets XPC_SERVICE_NAME to the job label; anything that is not one of
 * our two daemon labels (a login shell's "0", an unrelated agent, unset) is
 * null, so every non-launchd path falls through the gate untouched.
 */
export function launchdLabelFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const label = env.XPC_SERVICE_NAME;
  if (label !== "com.mattstack.daemon" && label !== "com.mattstack.daemon.dev") return null;
  return label;
}

const PARK_INTERVAL_MS = 30_000;

export async function parkUntilIntended(deps: ParkDeps): Promise<void> {
  let intent: IntendedMode = { mode: deps.myFlavor, provenance: "derived-from-wrapper" };
  let announcedPark = false;
  let announcedStandoff = false;
  let announcedWrongJob = false;

  for (;;) {
    // Job label before build flavor: in dev mode the bundle's rt hands off to
    // the dev source, so the prod job also produces a dev-flavored daemon and
    // daemonFlavor() cannot tell the two jobs apart. Both would then clear the
    // intent check below and evict each other through the shared rt.pid.
    const myLabel = deps.myLaunchdLabel();
    if (myLabel !== null) {
      const activeLabel = deps.activeLaunchdLabel();
      if (myLabel !== activeLabel) {
        if (!announcedWrongJob) {
          deps.log.info(
            { myLabel, activeLabel },
            `parked: started by the wrong launchd job (${myLabel}); ${activeLabel} is the active one — rechecking every ${PARK_INTERVAL_MS / 1000}s`,
          );
          announcedWrongJob = true;
        }
        await deps.sleep(PARK_INTERVAL_MS);
        continue;
      }
    }

    try {
      intent = deps.resolveIntent();
    } catch (err) {
      deps.log.warn({ err }, "intent read failed — keeping previous decision");
    }

    if (intent.mode !== deps.myFlavor) {
      if (!announcedPark) {
        deps.log.info(
          { myFlavor: deps.myFlavor, intended: intent.mode, provenance: intent.provenance },
          `parked: this machine's intended mode is ${intent.mode} — rechecking every ${PARK_INTERVAL_MS / 1000}s (flip with: rt settings dev-mode ${deps.myFlavor})`,
        );
        announcedPark = true;
      }
      await deps.sleep(PARK_INTERVAL_MS);
      continue;
    }

    const holder = await deps.probeHolder();
    // Same-flavor (restart orphan) and "unknown flavor" (pre-identity daemon)
    // holders are eviction's job, not ours — blocking on them here would make
    // startDaemon()'s evictStaleDaemon unreachable and stall forever.
    if (holder && holder.flavor !== deps.myFlavor && holder.flavor !== "unknown flavor") {
      if (!announcedStandoff) {
        deps.log.info(
          { holderFlavor: holder.flavor, holderPid: holder.pid },
          `standoff: rt.sock held by ${holder.flavor} pid ${holder.pid ?? "?"} — waiting for it to drain`,
        );
        announcedStandoff = true;
      }
      await deps.sleep(PARK_INTERVAL_MS);
      continue;
    }

    return;
  }
}

/** CONNECT to rt.sock and ask who answers. A dead/leaked socket file returns null (the boot path's unlink+bind handles it). */
export async function probeSocketHolder(sockPath: string = DAEMON_SOCK_PATH): Promise<SocketHolder | null> {
  try {
    const res = await fetch("http://localhost/ping", { unix: sockPath, signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { pid?: number; flavor?: string };
    return { flavor: body.flavor ?? "unknown flavor", pid: body.pid ?? null };
  } catch {
    return null;
  }
}
