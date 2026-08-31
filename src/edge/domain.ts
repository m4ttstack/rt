// src/edge/domain.ts
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TunnelDriver } from "./tunnel.ts";
import { writeTunnelConfig } from "./tunnel.ts";
import { LABEL_PREFIX, type ServiceManager } from "../services/manager.ts";
import { getPlatformSettings, updatePlatformSettings } from "../api/platform-settings.ts";
import { logsDir, stateDir } from "../api/state.ts";
import { listRecords } from "../registry/records.ts";
import type { FlowResult } from "../api/register.ts";

export const TUNNEL_NAME = "local-edge";
export const TUNNEL_LABEL = `${LABEL_PREFIX}tunnel`;

export async function bindDomain(
  domain: string,
  deps: { tunnel: TunnelDriver; manager: ServiceManager },
  opts: { gatewayPort?: number; cloudflaredDir?: string; cloudflaredBin?: string } = {},
): Promise<FlowResult> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { status: 400, body: { error: "bad domain" } };
  const current = getPlatformSettings().publicDomain;
  if (current && current !== domain) {
    const remoteApps = listRecords().filter((r) => r.remote).map((r) => r.name);
    if (remoteApps.length) return { status: 409, body: { error: "remote-apps-pinned-to-domain", apps: remoteApps } };
  }
  const cfDir = opts.cloudflaredDir ?? join(homedir(), ".cloudflared");
  // The guided flow checks the operator step; it never performs the browser login.
  if (!existsSync(join(cfDir, "cert.pem"))) {
    return { status: 428, body: { error: "cloudflared-login-required", command: "cloudflared tunnel login" } };
  }
  const { uuid } = await deps.tunnel.create(TUNNEL_NAME);
  await deps.tunnel.routeDns(TUNNEL_NAME, `*.${domain}`);
  const configPath = writeTunnelConfig({
    name: TUNNEL_NAME, uuid, domain, gatewayPort: opts.gatewayPort ?? 7950, cloudflaredDir: cfDir,
  });
  await deps.manager.install({
    label: TUNNEL_LABEL,
    programArguments: [opts.cloudflaredBin ?? "cloudflared", "tunnel", "--config", configPath, "run", TUNNEL_NAME],
    workingDirectory: stateDir(),
    environment: {},
    stdoutPath: join(logsDir(), "tunnel.out.log"),
    stderrPath: join(logsDir(), "tunnel.err.log"),
  });
  updatePlatformSettings({ publicDomain: domain });
  return { status: 200, body: { domain, tunnel: TUNNEL_NAME, uuid } };
}
