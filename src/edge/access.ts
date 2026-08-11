// src/edge/access.ts: the real Cloudflare Access driver. Lists/creates/updates
// a single "self_hosted" Access app per hostname and its one "local tier"
// allow policy. Every failure is loud: recorded as a `cloudflare` SyncIssue on
// the app's registry record, never thrown past syncOAuth.
import type { OAuth } from "./oauth.ts";
import type { ApiDeps } from "../api/server.ts";
import { addIssue, clearIssues } from "../registry/records.ts";
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

export function oauthToInclude(rule: OAuth): unknown[] {
  switch (rule.mode) {
    case "emails":
      return rule.emails.map((email) => ({ email: { email } }));
    case "domains":
      return rule.domains.map((domain) => ({ email_domain: { domain } }));
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

  async sync(appName: string, hostname: string, rule: OAuth): Promise<void> {
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
      include: oauthToInclude(rule),
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

export async function syncOAuth(
  app: string,
  rule: OAuth,
  deps: ApiDeps,
): Promise<{ ok: boolean; message?: string }> {
  const settings = getPlatformSettings();
  const { cfApiToken, cfZoneId } = settings.secrets;

  if (rule.mode === "off") {
    // No sign-in gate needs no Access app, but turning one off must still
    // tear down whatever was left from before.
    if (!cfApiToken || !cfZoneId) return { ok: true };
    // No domain bound means no hostname was ever synced to Cloudflare for
    // this app; removing against a stale "app.null" would just no-op, but
    // skip the call outright for consistency with the identity-tier guard.
    if (!settings.publicDomain) return { ok: true };
    const hostname = `${app}.${settings.publicDomain}`;
    try {
      const cf = new CfAccess({ token: cfApiToken, zoneId: cfZoneId, fetchImpl: deps.accessFetch });
      await cf.remove(hostname);
      clearIssues(app, "cloudflare");
      return { ok: true };
    } catch (err) {
      const message = String(err).slice(0, 300);
      addIssue(app, { source: "cloudflare", message, at: new Date().toISOString() });
      return { ok: false, message };
    }
  }

  if (!cfApiToken || !cfZoneId) {
    const message = "Cloudflare API token/zone not configured";
    addIssue(app, { source: "cloudflare", message, at: new Date().toISOString() });
    return { ok: false, message };
  }

  if (!settings.publicDomain) {
    // Building a hostname from a null publicDomain would silently produce
    // "app.null" and attempt to sync Cloudflare against it. Guard instead.
    const message = "No domain bound yet, bind a domain before setting an identity-gated access tier.";
    addIssue(app, { source: "cloudflare", message, at: new Date().toISOString() });
    return { ok: false, message };
  }

  const hostname = `${app}.${settings.publicDomain}`;
  try {
    const cf = new CfAccess({ token: cfApiToken, zoneId: cfZoneId, fetchImpl: deps.accessFetch });
    await cf.sync(app, hostname, rule);
    clearIssues(app, "cloudflare");
    return { ok: true };
  } catch (err) {
    const message = String(err).slice(0, 300);
    addIssue(app, { source: "cloudflare", message, at: new Date().toISOString() });
    return { ok: false, message };
  }
}
