// src/edge/domain.ts
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TunnelDriver } from "./tunnel.ts";
import { renderTunnelConfig, writeTunnelConfig } from "./tunnel.ts";
import type { CfDns } from "./cf-dns.ts";
import { mintTunnelName, randomSuffix } from "./machine-key.ts";
import { LABEL_PREFIX, type ServiceManager, type ServiceSpec } from "../services/manager.ts";
import { composeServicePath, resolveProgram } from "../services/exec-env.ts";
import { getPlatformSettings, updatePlatformSettings, type TunnelIdentity } from "../api/platform-settings.ts";
import { logsDir, stateDir } from "../api/state.ts";
import { listRecords } from "../registry/records.ts";
import { getAppSettings } from "../../core/settings.ts";
import type { FlowResult } from "../api/register.ts";

export const TUNNEL_LABEL = `${LABEL_PREFIX}tunnel`;
export const EDGE_METRICS_PORT = 7951;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CONNECTOR_POLLS = 5;
const CONNECTOR_POLL_MS = 3000;

export interface EdgeDeps { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns }
export interface EdgeOpts {
  gatewayPort?: number;
  cloudflaredDir?: string;
  force?: boolean;
  random?: () => string;
  resolveBin?: () => string | null;
  sleep?: (ms: number) => Promise<void>;
}

export function tunnelConfigPath(): string { return join(stateDir(), "tunnel.yml"); }
export function credentialsPath(cfDir: string, uuid: string): string { return join(cfDir, `${uuid}.json`); }
// process.env.HOME over homedir() alone: Bun freezes homedir() to whatever HOME
// was at process start, so a test's later HOME reassignment (see state.ts) never moves it.
function defaultCfDir(): string { return join(process.env.HOME ?? homedir(), ".cloudflared"); }
export function resolveCloudflared(): string | null { return resolveProgram("cloudflared", composeServicePath()); }

// launchd does not search PATH for ProgramArguments[0]; the caller passes an absolute path.
export function tunnelServiceSpec(o: { configPath: string; cloudflaredBin: string }): ServiceSpec {
  return {
    label: TUNNEL_LABEL,
    programArguments: [o.cloudflaredBin, "tunnel", "--config", o.configPath, "run"],
    workingDirectory: stateDir(),
    environment: {},
    stdoutPath: join(logsDir(), "tunnel.out.log"),
    stderrPath: join(logsDir(), "tunnel.err.log"),
  };
}

export function expectedTunnelConfig(o: { uuid: string; domain: string; cfDir: string; gatewayPort: number }): string {
  return renderTunnelConfig({
    uuid: o.uuid, credentialsFile: credentialsPath(o.cfDir, o.uuid), domain: o.domain,
    gatewayPort: o.gatewayPort, metricsPort: EDGE_METRICS_PORT,
  });
}

export async function bindDomain(domain: string, deps: EdgeDeps, opts: EdgeOpts = {}): Promise<FlowResult> {
  if (!DOMAIN_RE.test(domain)) return { status: 400, body: { error: "bad domain" } };
  const cfDir = opts.cloudflaredDir ?? defaultCfDir();
  const bin = (opts.resolveBin ?? resolveCloudflared)();
  if (!bin) return { status: 400, body: { error: "cloudflared-missing", hint: "brew install cloudflared" } };
  // The guided flow checks the operator step; it never performs the browser login.
  if (!existsSync(join(cfDir, "cert.pem"))) {
    return { status: 428, body: { error: "cloudflared-login-required", command: "cloudflared tunnel login" } };
  }
  if (!(await deps.dns.tokenCanEditDns())) {
    return { status: 400, body: { error: "cf-token-needs-zone-dns", hint: "rt secrets set deck cfDnsToken (Zone.DNS:Edit)" } };
  }

  const current = getPlatformSettings().publicDomain;
  if (current && current !== domain) {
    const remoteApps = listRecords().filter((r) => r.remote).map((r) => r.name);
    if (remoteApps.length && !opts.force) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
    const torn = await unbindDomain(deps, { force: true, cloudflaredDir: cfDir });
    if (torn.status !== 200) return torn;
  }

  const identity = await resolveTunnel(deps.tunnel, cfDir, opts.random ?? randomSuffix);
  updatePlatformSettings({ tunnel: identity });

  const gatewayPort = opts.gatewayPort ?? 7950;
  const configPath = tunnelConfigPath();
  writeTunnelConfig(configPath, {
    uuid: identity.uuid, credentialsFile: credentialsPath(cfDir, identity.uuid), domain, gatewayPort, metricsPort: EDGE_METRICS_PORT,
  });
  await deps.dns.writeProxiedCname(`*.${domain}`, `${identity.uuid}.cfargotunnel.com`);
  await deps.manager.install(tunnelServiceSpec({ configPath, cloudflaredBin: bin }));
  await deps.manager.kickstart(TUNNEL_LABEL);
  updatePlatformSettings({ publicDomain: domain });
  const connectors = await awaitConnector(deps.tunnel, identity.name, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  return { status: 200, body: { domain, tunnel: identity, connectors } };
}

// Edge registration takes a few seconds after kickstart; a bounded poll keeps a
// healthy bind from reporting zero connectors.
async function awaitConnector(tunnel: TunnelDriver, name: string, sleep: (ms: number) => Promise<void>): Promise<number> {
  let connectors = 0;
  for (let i = 0; i < CONNECTOR_POLLS; i++) {
    ({ connectors } = await tunnel.info(name));
    if (connectors > 0) break;
    if (i < CONNECTOR_POLLS - 1) await sleep(CONNECTOR_POLL_MS);
  }
  return connectors;
}

// Recreating under the recorded name is safe: the minted suffix makes it this
// deck's alone, never another machine's live tunnel.
async function resolveTunnel(tunnel: TunnelDriver, cfDir: string, random: () => string): Promise<TunnelIdentity> {
  const recorded = getPlatformSettings().tunnel;
  if (!recorded) {
    const name = mintTunnelName(random);
    const { uuid } = await tunnel.create(name);
    return { name, uuid };
  }
  const listed = (await tunnel.list()).find((t) => t.name === recorded.name);
  if (!listed) {
    const { uuid } = await tunnel.create(recorded.name);
    return { name: recorded.name, uuid };
  }
  if (existsSync(credentialsPath(cfDir, listed.uuid))) return { name: recorded.name, uuid: listed.uuid };
  await tunnel.delete(recorded.name);
  const { uuid } = await tunnel.create(recorded.name);
  return { name: recorded.name, uuid };
}

export async function unbindDomain(
  deps: { tunnel: TunnelDriver; manager: ServiceManager; dns: CfDns | null },
  opts: { force?: boolean; cloudflaredDir?: string } = {},
): Promise<FlowResult> {
  const { publicDomain, tunnel } = getPlatformSettings();
  if (!publicDomain && !tunnel) return { status: 200, body: { ok: true, alreadyUnbound: true } };
  const records = listRecords();
  const remoteApps = records.filter((r) => r.remote).map((r) => r.name);
  if (remoteApps.length && !opts.force) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
  const served = records.filter((r) => !r.remote && getAppSettings(r.name).published).map((r) => r.name);
  if (served.length && !opts.force) return { status: 409, body: { error: "apps-will-go-offline", apps: served } };

  const cfDir = opts.cloudflaredDir ?? defaultCfDir();
  await deps.manager.uninstall(TUNNEL_LABEL);
  if (publicDomain && deps.dns) await deps.dns.deleteHostRecords(`*.${publicDomain}`);
  if (tunnel) {
    await deps.tunnel.delete(tunnel.name);
    rmSync(credentialsPath(cfDir, tunnel.uuid), { force: true });
  }
  rmSync(tunnelConfigPath(), { force: true });
  updatePlatformSettings({ publicDomain: null, tunnel: null });
  return { status: 200, body: { ok: true } };
}
