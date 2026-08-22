import { listRecords } from "../registry/records.ts";
import { readRoutes, MATTSTACK_TLD } from "../../core/discover.ts";
import { ensureRoute } from "../../core/routes-writer.ts";
import { getPlatformSettings, updatePlatformSettings } from "./platform-settings.ts";

/** Ownership-driven TLD rehome: managed records (managedBy set to anything
    but "user") are mattstack products and get a name.mattstack route
    ensured; the platform tlds list is then re-derived from the routes that
    actually exist. tlds is a derived cache of portless state, never
    hand-authored configuration. */
export function reconcileMattstackTld(): void {
  for (const r of listRecords()) {
    const owned = r.managedBy != null && r.managedBy !== "user";
    if (owned && r.port != null) ensureRoute(`${r.name}.${MATTSTACK_TLD}`, r.port);
  }
  const next = deriveTlds(readRoutes().map((r) => String(r.hostname)));
  if (JSON.stringify(getPlatformSettings().tlds) !== JSON.stringify(next)) {
    updatePlatformSettings({ tlds: next });
  }
}

/** The tlds cache is exactly the set of trailing labels the route table
    serves, localhost always present and first. */
export function deriveTlds(hostnames: string[]): string[] {
  const tlds = new Set<string>(["localhost"]);
  for (const h of hostnames) {
    const labels = h.split(".");
    if (labels.length > 1) tlds.add(labels[labels.length - 1]!);
  }
  return [...tlds].sort((a, b) => (a === "localhost" ? -1 : b === "localhost" ? 1 : a.localeCompare(b)));
}
