import type { Commands, RtResponse } from '@mattstack/rt-client';
import type { GateDomain, SweepAction } from './sweep.ts';

/** The narrow slice of a domain's state-file writer `executeSweepAction`
    needs: closing a missed-done tab always writes exactly `{status: "done",
    tabId: ""}`, so this is deliberately narrower than `writeReviewState`'s
    (or its respond/doctor siblings') full `Partial<State> & {status}`
    signature -- a function that accepts the wider patch shape satisfies
    this by simple parameter contravariance, so server.ts can wire the real
    writers straight through with no adapter. */
export interface DomainStateIo {
  writeState(path: string, patch: { status: 'done'; tabId: string }): void;
  filePath(mrUrl: string): string;
}

export interface ExecuteSweepActionIo {
  gatePark(
    payload: Commands['gate:park']['payload']
  ): Promise<RtResponse<Commands['gate:park']['data']>>;
  closeTab(tabId: string): Promise<void>;
  review: DomainStateIo;
  respond: DomainStateIo;
  doctor: DomainStateIo;
  now(): number;
  graceMinutes: number;
  log(message: string): void;
  logError(message: string): void;
}

async function closeTabBestEffort(
  action: SweepAction,
  io: ExecuteSweepActionIo
): Promise<void> {
  if (!action.tabId) return;
  try {
    await io.closeTab(action.tabId);
  } catch (err) {
    io.logError(
      `gate sweep: closeTab(${action.tabId}) failed for ${action.mrUrl}: ${err instanceof Error ? err.message : err}`
    );
  }
}

function stateIo(domain: GateDomain, io: ExecuteSweepActionIo): DomainStateIo {
  return io[domain];
}

/**
 * Executes one `planSweep` action. `park` calls the facility's `gatePark`
 * FIRST -- its CAS (`UPDATE ... WHERE status = 'open'`) is the TOCTOU guard
 * now: the plan was computed from a cache snapshot, and by the time this
 * action runs an answer may already have landed (the wrapper's `gate wait`
 * returned and it started posting). An `ok:false` response means exactly
 * that raced, so closeTab and the state write are both skipped -- acting
 * on the stale snapshot would closeTab mid-post. `close-missed-done`
 * carries no such race (a domain's tabId is only ever cleared by this same
 * action) so it needs no guard, and only ever touches its OWN domain's
 * state file -- a done review's missed close never depends on, or clobbers,
 * a live respond or doctor gate on the same MR.
 */
export async function executeSweepAction(
  action: SweepAction,
  io: ExecuteSweepActionIo
): Promise<void> {
  if (action.kind === 'park') {
    if (!action.gateId) return;
    const result = await io.gatePark({ id: action.gateId });
    if (!result.ok) {
      io.log(
        `gate sweep: gate ${action.gateId} for ${action.mrUrl} no longer open (${result.error}); skipping park`
      );
      return;
    }

    await closeTabBestEffort(action, io);
    io.log(
      `gate sweep: parked gate ${action.gateId} for ${action.mrUrl} after ${io.graceMinutes}m with no answer`
    );
    return;
  }

  await closeTabBestEffort(action, io);
  const domainIo = stateIo(action.domain, io);
  // "" (falsy) rather than omitting the field: writeState merges
  // patch.tabId ?? prev.tabId, so leaving tabId out of the patch would
  // keep the stale id and this action would re-fire every sweep.
  domainIo.writeState(domainIo.filePath(action.mrUrl), {
    status: 'done',
    tabId: '',
  });
  io.log(
    `gate sweep: closed missed-done ${action.domain} tab for ${action.mrUrl}`
  );
}
