import { MATTSTACK_TLD } from '../../core/discover.ts';
import { repointRoutes } from '../../core/routes-writer.ts';
import { PLATFORM_NAME } from '../services/manager.ts';
import { getRecord, putRecord, reloadRegistry } from './records.ts';

/**
 * The bundle helper's plist carries no PORT, so the port it serves on can
 * differ from the one `deck setup` recorded, and nothing else moves deck's
 * self-record or its routes (the TLD reconcile only adds missing routes).
 * Run once both ports are held, so a losing boot never writes.
 */
export function reconcileSelfPort(port: number): {
  record: boolean;
  routes: string[];
} {
  reloadRegistry();
  const self = getRecord(PLATFORM_NAME);
  const record = self !== undefined && self.port !== port;
  if (record) putRecord({ ...self, port });
  return {
    record,
    routes: repointRoutes(PLATFORM_NAME, port, ['localhost', MATTSTACK_TLD]),
  };
}
