import {
  nextFreePort,
  type LaunchdService,
  type PortlessRoute,
} from "../../core/discover.ts";
import type { AppRecord } from "./records.ts";

/**
 * The registry is the allocator of record, but ports can also be held by routes
 * Deck did not create and by legacy services. Fold registry records in as
 * synthetic routes so nextFreePort (the proven range walk) sees all three.
 */
export function allocatePort(
  records: AppRecord[],
  routes: PortlessRoute[],
  services: LaunchdService[],
): number | null {
  const synthetic: PortlessRoute[] = records.map((r) => ({
    hostname: `${r.name}.localhost`,
    port: r.port,
  }));
  return nextFreePort([...routes, ...synthetic], services);
}
