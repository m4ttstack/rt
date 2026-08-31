import { existsSync, readFileSync } from "fs";
import type { TunnelDriver } from "./tunnel.ts";
import { writeTunnelConfig } from "./tunnel.ts";
import type { CfDns } from "./cf-dns.ts";
import type { ServiceManager } from "../services/manager.ts";
import type { LaunchdService } from "../../core/discover.ts";
import { getPlatformSettings } from "../api/platform-settings.ts";
import { TUNNEL_LABEL, EDGE_METRICS_PORT, credentialsPath, expectedTunnelConfig, tunnelConfigPath, tunnelServiceSpec } from "./domain.ts";

export const EDGE_LOCAL_INTERVAL_MS = 30_000;
export const EDGE_CF_INTERVAL_MS = 10 * 60_000;
export const EDGE_ERROR_BACKOFF_MS = 60_000;

export interface EdgeReconcileDeps {
  tunnel: TunnelDriver;
  manager: ServiceManager;
  dns(): Promise<CfDns | null>;
  services(): Promise<LaunchdService[]>;
  now(): number;
  cloudflaredDir: string;
  cloudflaredBin: string;
  gatewayPort: number;
}

let inFlight = false;
let nextLocalAt = 0;
let nextCfAt = 0;
let drift = { tunnelGone: false };

export function edgeDrift(): { tunnelGone: boolean } { return drift; }
export function edgeBindingChanged(): void { nextLocalAt = 0; nextCfAt = 0; drift = { tunnelGone: false }; }
export function resetEdgeReconcileForTests(): void { inFlight = false; edgeBindingChanged(); }

// Never creates a tunnel or a DNS record from nothing: only deck domain binds.
export async function reconcileEdge(deps: EdgeReconcileDeps): Promise<void> {
  const { publicDomain, tunnel } = getPlatformSettings();
  if (!publicDomain || !tunnel) { drift = { tunnelGone: false }; return; }
  const now = deps.now();
  if (inFlight || now < nextLocalAt) return;
  inFlight = true;
  try {
    const configPath = tunnelConfigPath();
    const expected = expectedTunnelConfig({ uuid: tunnel.uuid, domain: publicDomain, cfDir: deps.cloudflaredDir, gatewayPort: deps.gatewayPort });
    let restart = false;
    if (!existsSync(configPath) || readFileSync(configPath, "utf8") !== expected) {
      writeTunnelConfig(configPath, { uuid: tunnel.uuid, credentialsFile: credentialsPath(deps.cloudflaredDir, tunnel.uuid), domain: publicDomain, gatewayPort: deps.gatewayPort, metricsPort: EDGE_METRICS_PORT });
      restart = true;
    }
    if (!(await deps.manager.isInstalled(TUNNEL_LABEL))) {
      await deps.manager.install(tunnelServiceSpec({ configPath, cloudflaredBin: deps.cloudflaredBin }));
      restart = true;
    }
    const svc = (await deps.services()).find((s) => s.label === TUNNEL_LABEL);
    if (restart || !svc || svc.pid === null) await deps.manager.kickstart(TUNNEL_LABEL);
    nextLocalAt = now + EDGE_LOCAL_INTERVAL_MS;

    if (now >= nextCfAt) {
      const dns = await deps.dns();
      if (dns) {
        const listed = await deps.tunnel.list();
        drift = { tunnelGone: !listed.some((t) => t.uuid === tunnel.uuid) };
        if (!drift.tunnelGone) {
          const host = `*.${publicDomain}`;
          const target = `${tunnel.uuid}.cfargotunnel.com`;
          const cur = await dns.cnameTarget(host);
          if (!cur || cur.target !== target || !cur.proxied) await dns.writeProxiedCname(host, target);
        }
        nextCfAt = now + EDGE_CF_INTERVAL_MS;
      }
    }
  } catch (err) {
    nextLocalAt = now + EDGE_ERROR_BACKOFF_MS;
    console.error("edge reconcile failed:", err);
  } finally {
    inFlight = false;
  }
}
