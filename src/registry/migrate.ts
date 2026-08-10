import { readRoutes, readServices, servicePrefixes, bareName, dedupeRoutes } from "../../core/discover.ts";
import { getPlatformSettings, updatePlatformSettings } from "../api/platform-settings.ts";
import { getRecord, putRecord } from "./records.ts";

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

  for (const route of routes) {
    const name = bareName(route.hostname, tlds);
    if (getRecord(name)) { skipped.push(name); continue; }
    const svc = services.find((s) => s.port === route.port);
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
    adopted.push(name);
  }

  // Services with no route at all (e.g. the old tunnel agent) stay orphans on
  // the board, exactly as today - adopting them would invent routes.
  return { adopted, skipped };
}
