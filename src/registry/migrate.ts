import { readRoutes, readServices, servicePrefixes, bareName, dedupeRoutes } from "../../core/discover.ts";
import { getPlatformSettings, updatePlatformSettings } from "../api/platform-settings.ts";
import { getRecord, putRecord, listRecords } from "./records.ts";
import { PLATFORM_LABEL } from "../services/manager.ts";

/**
 * Adoption, not conversion (ruled): records point at the EXISTING label, plist,
 * and route. Nothing under ~/Library/LaunchAgents or in portless is written.
 * The old plists keep running under launchd exactly as before; they are simply
 * operable from the board now.
 */
export async function migrate(opts: { legacyPrefix?: string }): Promise<{ adopted: string[]; skipped: string[] }> {
  const legacyPrefix = opts.legacyPrefix ?? "com.matthewgoodwin.";
  const settings = getPlatformSettings();
  if (!settings.legacyPrefixes.includes(legacyPrefix)) {
    updatePlatformSettings({ legacyPrefixes: [...settings.legacyPrefixes, legacyPrefix] });
  }

  const adopted: string[] = [];
  const skipped: string[] = [];
  const tlds = getPlatformSettings().tlds;
  const services = await readServices(servicePrefixes([legacyPrefix]));
  const routes = dedupeRoutes(readRoutes(), tlds);
  const claimedPorts = new Set(listRecords().map((r) => r.port));

  for (const route of routes) {
    const name = bareName(route.hostname, tlds);
    if (getRecord(name) || claimedPorts.has(route.port)) { skipped.push(name); continue; }
    const svc = services.find((s) => s.port === route.port);
    // Defense-in-depth for a hypothetical ordering where migrate() runs before
    // Local's own bootstrap record exists yet (so claimedPorts wouldn't catch
    // it): never adopt a record carrying Local's own platform launchd label
    // under any other name - that record is Local itself, not a new app.
    if (svc?.label === PLATFORM_LABEL) { skipped.push(name); continue; }
    putRecord({
      name,
      managedBy: "user",
      port: route.port,
      kind: svc ? "service" : "external",
      ...(svc && {
        label: svc.label,
        command: svc.program,
        workingDirectory: svc.workingDirectory ?? undefined,
      }),
      grandfathered: true,
      createdAt: new Date().toISOString(),
    });
    claimedPorts.add(route.port); // the port is now claimed for the rest of THIS run too
    adopted.push(name);
  }

  // Services with no route at all (e.g. the old tunnel agent) stay orphans on
  // the board, exactly as today - adopting them would invent routes.
  return { adopted, skipped };
}
