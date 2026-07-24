import { readRoutes, type PortlessRoute } from "./discover.ts";
import { getOverrides } from "./settings.ts";
import { setRoutePort } from "./routes-writer.ts";

export type Overrides = Record<string, { devPort: number; basePort: number }>;

// Pure: given current routes and active overrides, list the re-assertions needed
// (apps whose route port has drifted away from the intended devPort).
export function overridesToReassert(
  routes: PortlessRoute[],
  overrides: Overrides,
): Array<{ hostname: string; devPort: number }> {
  const out: Array<{ hostname: string; devPort: number }> = [];
  for (const [app, ov] of Object.entries(overrides)) {
    const route = routes.find((r) => r.hostname.replace(/\.localhost$/, "") === app);
    if (route && route.port !== ov.devPort) out.push({ hostname: app, devPort: ov.devPort });
  }
  return out;
}

// Side-effectful wrapper used by the server's interval. Writes only on drift.
export function reconcileOnce(): void {
  for (const { hostname, devPort } of overridesToReassert(readRoutes(), getOverrides())) {
    setRoutePort(hostname, devPort);
  }
}
