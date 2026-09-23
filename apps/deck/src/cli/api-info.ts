import { isAlive, readApiInfo } from '../api/state.ts';
import { getRecord } from '../registry/records.ts';

/**
 * api.json is rewritten by whichever `deck serve` booted last, so a hand-run
 * `bun run serve` that has since exited leaves it pointing at a dead port
 * while the launchd deck is still up on the self record's port. Trust the
 * file only while its writer is alive; otherwise the registry is the truth.
 */
export function resolveApiInfo(): { port: number } | null {
  const info = readApiInfo();
  if (info && isAlive(info.pid)) return { port: info.port };
  const self = getRecord('deck');
  return self ? { port: self.port } : null;
}
