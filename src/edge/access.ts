// src/edge/access.ts — the real Cloudflare Access driver. Lists/creates/updates
// a single "self_hosted" Access app per hostname and its one "local tier"
// allow policy. Every failure is loud: recorded as a `cloudflare` SyncIssue on
// the app's registry record, never thrown past syncAccessTier.
import type { AccessTier } from "./access-tiers.ts";
import type { ApiDeps } from "../api/server.ts";
import { addIssue } from "../registry/records.ts";
import { getPlatformSettings } from "../api/platform-settings.ts";

const BASE = "https://api.cloudflare.com/client/v4";

interface CfListResult<T> {
  success: boolean;
  result: T;
}

interface CfAccessApp {
  id: string;
  domain: string;
  [key: string]: unknown;
}

interface CfAccessPolicy {
  id: string;
  name: string;
  [key: string]: unknown;
}

export function tierToInclude(tier: AccessTier): unknown[] {
  switch (tier.tier) {
    case "only-me":
      return [{ email: { email: tier.email } }];
    case "work-domain":
      return [{ email_domain: { domain: tier.emailDomain } }];
    case "custom":
      return tier.emails.map((email) => ({ email: { email } }));
    default:
      return [];
  }
}

export class CfAccess {
  private token: string;
  private zoneId: string;
  private fetchImpl: typeof fetch;

  constructor(opts: { token: string; zoneId: string; fetchImpl?: typeof fetch }) {
    this.token = opts.token;
    this.zoneId = opts.zoneId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${BASE}/zones/${this.zoneId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = (await res.json()) as CfListResult<T>;
    if (!data.success) {
      throw new Error(`Cloudflare API ${method} ${path} failed`);
    }
    return data.result;
  }

  private async findAppByHostname(hostname: string): Promise<CfAccessApp | undefined> {
    const apps = await this.req<CfAccessApp[]>("GET", "/access/apps");
    return apps.find((a) => a.domain === hostname);
  }

  async sync(appName: string, hostname: string, tier: AccessTier): Promise<void> {
    const payload = {
      name: `local: ${appName}`,
      domain: hostname,
      type: "self_hosted",
      session_duration: "24h",
    };

    const existing = await this.findAppByHostname(hostname);
    let app: CfAccessApp;
    let policies: CfAccessPolicy[] = [];
    if (existing) {
      app = await this.req<CfAccessApp>("PUT", `/access/apps/${existing.id}`, payload);
      // Only a pre-existing app can have a pre-existing "local tier" policy;
      // a freshly created app has none, so skip the list round-trip.
      policies = await this.req<CfAccessPolicy[]>("GET", `/access/apps/${app.id}/policies`);
    } else {
      app = await this.req<CfAccessApp>("POST", "/access/apps", payload);
    }

    const policyPayload = {
      name: "local tier",
      decision: "allow",
      include: tierToInclude(tier),
    };

    const existingPolicy = policies.find((p) => p.name === "local tier");
    if (existingPolicy) {
      await this.req("PUT", `/access/apps/${app.id}/policies/${existingPolicy.id}`, policyPayload);
    } else {
      await this.req("POST", `/access/apps/${app.id}/policies`, policyPayload);
    }
  }

  async remove(hostname: string): Promise<void> {
    const existing = await this.findAppByHostname(hostname);
    if (!existing) return;
    await this.req("DELETE", `/access/apps/${existing.id}`);
  }
}

export async function syncAccessTier(
  app: string,
  tier: AccessTier,
  deps: ApiDeps,
): Promise<{ ok: boolean }> {
  const settings = getPlatformSettings();
  const { cfApiToken, cfZoneId } = settings.secrets;
  const hostname = `${app}.${settings.publicDomain}`;

  if (tier.tier !== "only-me" && tier.tier !== "work-domain" && tier.tier !== "custom") {
    // Non-CF tiers (public/password) don't need an Access app, but a
    // downgrade must still tear down any CF Access app left from before.
    if (!cfApiToken || !cfZoneId) return { ok: true };
    try {
      const cf = new CfAccess({ token: cfApiToken, zoneId: cfZoneId, fetchImpl: deps.accessFetch });
      await cf.remove(hostname);
      return { ok: true };
    } catch (err) {
      addIssue(app, { source: "cloudflare", message: String(err).slice(0, 300), at: new Date().toISOString() });
      return { ok: false };
    }
  }

  if (!cfApiToken || !cfZoneId) {
    addIssue(app, {
      source: "cloudflare",
      message: "Cloudflare API token/zone not configured",
      at: new Date().toISOString(),
    });
    return { ok: false };
  }

  try {
    const cf = new CfAccess({ token: cfApiToken, zoneId: cfZoneId, fetchImpl: deps.accessFetch });
    await cf.sync(app, hostname, tier);
    return { ok: true };
  } catch (err) {
    addIssue(app, { source: "cloudflare", message: String(err).slice(0, 300), at: new Date().toISOString() });
    return { ok: false };
  }
}
