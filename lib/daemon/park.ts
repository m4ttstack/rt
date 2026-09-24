/**
 * Flavor park. Runs at the TOP of lib/daemon.ts module scope: everything
 * below it arms live subsystems (cron, the home-snapshot auto-committer,
 * sweeps) and startDaemon() SIGTERMs the shared rt.pid, so a daemon that
 * must not serve never gets past this function.
 *
 * A daemon serves when its own flavor (MATTSTACK_FLAVOR from its launchd
 * job, else its build) matches the job that started it. Parking is a loop,
 * not an exit: KeepAlive={SuccessfulExit:false} on both flavor plists means
 * a failing exit would respawn-churn. Standoff waits out only a live holder
 * of a DIFFERENT known flavor, the other app's daemon draining after a
 * takeover; a same-flavor holder (restart orphan) or an unidentified one
 * returns instead, so startDaemon()'s evictStaleDaemon still owns those.
 */
import { DAEMON_SOCK_PATH } from "../daemon-config.ts";
import { daemonLabelFor, processFlavor, type Flavor } from "../flavor.ts";

export function daemonFlavor(): Flavor {
  return processFlavor();
}

export interface SocketHolder {
  flavor: string;
  pid: number | null;
}

export interface ParkDeps {
  myFlavor: Flavor;
  probeHolder: () => Promise<SocketHolder | null>;
  sleep: (ms: number) => Promise<void>;
  log: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  /** The mattstack daemon label of the launchd job that started this process,
      or null when launchd did not start it (foreground `rt daemon`, e2e). */
  myLaunchdLabel: () => string | null;
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

export async function parkUntilServable(deps: ParkDeps): Promise<void> {
  const myLabel = deps.myLaunchdLabel();
  const ownLabel = daemonLabelFor(deps.myFlavor);
  if (myLabel !== null && myLabel !== ownLabel) {
    deps.log.info(
      { myLabel, myFlavor: deps.myFlavor },
      `parked: a ${deps.myFlavor} daemon started by ${myLabel}, which is not the ${deps.myFlavor} app's job (${ownLabel})`,
    );
    for (;;) await deps.sleep(PARK_INTERVAL_MS);
  }

  let announcedStandoff = false;
  for (;;) {
    const holder = await deps.probeHolder();
    if (holder && holder.flavor !== deps.myFlavor && holder.flavor !== "unknown flavor") {
      if (!announcedStandoff) {
        deps.log.info(
          { holderFlavor: holder.flavor, holderPid: holder.pid },
          `standoff: rt.sock held by ${holder.flavor} pid ${holder.pid ?? "?"}, waiting for it to drain`,
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
