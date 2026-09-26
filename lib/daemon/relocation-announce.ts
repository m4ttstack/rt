/**
 * Drives Claude Code's EnterWorktree permission-root relocation dialog on an
 * attended pane, scoped to the one tree the session announced.
 *
 * A hook fires before the dialog paints, so the watch is a short poll: long
 * enough for EnterWorktree to provision and paint, short enough that a stale
 * announcement cannot answer a later, unrelated dialog.
 */
import { resolve } from "node:path";
import type { Logger } from "pino";
import type { Commands } from "../../packages/rt-client/src/commands.ts";
import { resolveLivePane, type LivePane } from "./pane-resolve-live.ts";
import type { RelocationDriveOutcome } from "./trust-accept.ts";

export interface RelocationWatcherDeps {
  snapshot: () => Promise<LivePane[] | null>;
  drive: (pane: LivePane, allowed: (path: string) => boolean) => Promise<RelocationDriveOutcome>;
  isRegisteredTree: (path: string) => boolean;
  isHerdPane: (paneRef: string) => boolean;
  enabled: () => boolean;
  realpath: (p: string) => string;
  log: Pick<Logger, "info" | "warn" | "debug">;
  windowMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Announce = Commands["pane:announce-relocation"]["payload"];
type Scheduled = Commands["pane:announce-relocation"]["data"];

export interface RelocationWatcher {
  announce(a: Announce): Promise<Scheduled>;
}

export type PaneDriveGuard = <R>(paneRef: string, run: () => Promise<R>) => Promise<R | "no-dialog">;

/** One relocation drive per pane at a time, shared by every seam that drives
    the dialog: a second walker's Enter can land after the first closed the
    dialog, submitting whatever the person had typed. A pane already in
    flight reports no-dialog without reading or pressing. */
export function createPaneDriveGuard(): PaneDriveGuard {
  const inFlight = new Set<string>();
  return async (paneRef, run) => {
    if (inFlight.has(paneRef)) return "no-dialog";
    inFlight.add(paneRef);
    try {
      return await run();
    } finally {
      inFlight.delete(paneRef);
    }
  };
}

const WINDOW_MS = 8_000;
const POLL_MS = 500;

export function createRelocationWatcher(deps: RelocationWatcherDeps): RelocationWatcher {
  const windowMs = deps.windowMs ?? WINDOW_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));

  const same = (a: string, b: string): boolean => {
    try { return deps.realpath(a) === deps.realpath(b); } catch { return false; }
  };

  function allowedFor(a: Announce): (path: string) => boolean {
    const want = resolve(a.cwd, a.path as string);
    return (p) => deps.isRegisteredTree(p) && same(p, want);
  }

  async function watch(pane: LivePane, allowed: (p: string) => boolean, a: Announce): Promise<void> {
    const deadline = Date.now() + windowMs;
    while (Date.now() <= deadline) {
      let outcome: RelocationDriveOutcome;
      try {
        outcome = await deps.drive(pane, allowed);
      } catch (err) {
        deps.log.warn({ err, pane: pane.paneRef }, "relocation: drive threw; leaving the dialog to the human");
        return;
      }
      if (outcome === "accepted") {
        deps.log.info({ pane: pane.paneRef, tool: a.tool, path: a.path }, "relocation: accepted an announced relocation");
        return;
      }
      if (outcome !== "no-dialog") {
        deps.log.info({ pane: pane.paneRef, outcome }, "relocation: not accepting; the human answers");
        return;
      }
      await sleep(pollMs);
    }
    deps.log.debug({ pane: pane.paneRef, tool: a.tool }, "relocation: no dialog inside the window");
  }

  /** herdr pane ids are per-server sequential, so a pane id alone can name a
      different server's pane; the session decides and the pane id may only
      agree with it. Two panes can report the same session (a stale one
      left behind by a crashed pane, a race on registration): with a
      paneId, only the matching one of those is a hit; without one, more
      than one match is as unusable as none. The pane id stands in only
      for a pane that reports no session at all. */
  function paneFor(a: Announce, panes: LivePane[]): LivePane | null {
    const bySession = panes.filter((p) => p.sessionId === a.sessionId);
    if (bySession.length > 0) {
      if (a.paneId === undefined) return bySession.length === 1 ? bySession[0]! : null;
      return bySession.find((p) => p.paneRef === a.paneId) ?? null;
    }
    if (a.paneId === undefined) return null;
    const byPane = resolveLivePane({ paneId: a.paneId }, panes);
    return byPane && byPane.sessionId === undefined ? byPane : null;
  }

  return {
    async announce(a) {
      const panes = (await deps.snapshot()) ?? [];
      const pane = paneFor(a, panes);
      if (!pane) return { scheduled: false, pane: null, reason: "no-pane" };
      if (a.path === undefined) return { scheduled: false, pane: pane.paneRef, reason: "awaiting-path" };
      if (deps.isHerdPane(pane.paneRef)) return { scheduled: false, pane: pane.paneRef, reason: "herd-pane" };
      if (!deps.enabled()) return { scheduled: false, pane: pane.paneRef, reason: "disabled" };
      void watch(pane, allowedFor(a), a);
      return { scheduled: true, pane: pane.paneRef };
    },
  };
}
