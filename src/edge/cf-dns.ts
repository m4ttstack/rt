// src/edge/cf-dns.ts: the real Cloudflare DNS driver. Loud-failure style,
// same as src/edge/access.ts -- every non-`success` Cloudflare response
// throws a truncated message rather than degrading silently. Callers
// construct it with { zoneId, token, fetchImpl }, sourcing zoneId/token
// from readDeckSecrets (cfApiToken/cfZoneId).
const BASE = "https://api.cloudflare.com/client/v4";

export type ZoneSslMode = "off" | "flexible" | "full" | "strict";

export interface CfDns {
  zoneSslMode(): Promise<ZoneSslMode>;
  tokenCanEditDns(): Promise<boolean>;
  writeTxt(name: string, value: string): Promise<void>;
  deleteTxt(name: string): Promise<void>;
  writeProxiedCname(host: string, target: string): Promise<void>;
  cnameTarget(host: string): Promise<string | null>;
  deleteHostRecords(host: string): Promise<void>;
}

interface CfResult<T> {
  success: boolean;
  result: T;
}

interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  [key: string]: unknown;
}

export class CfDnsApi implements CfDns {
  private zoneId: string;
  private token: string;
  private fetchImpl: typeof fetch;

  constructor(opts: { zoneId: string; token: string; fetchImpl?: typeof fetch }) {
    this.zoneId = opts.zoneId;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req<T>(method: string, url: string, payload?: unknown): Promise<T> {
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = (await res.json()) as CfResult<T>;
    if (!data.success) {
      throw new Error(`Cloudflare API ${method} ${url} failed: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.result;
  }

  private async listRecords(name: string, type?: string): Promise<CfDnsRecord[]> {
    const q = new URLSearchParams({ name });
    if (type) q.set("type", type);
    return this.req<CfDnsRecord[]>("GET", `${BASE}/zones/${this.zoneId}/dns_records?${q.toString()}`);
  }

  async zoneSslMode(): Promise<ZoneSslMode> {
    const result = await this.req<{ value: ZoneSslMode }>("GET", `${BASE}/zones/${this.zoneId}/settings/ssl`);
    return result.value;
  }

  async tokenCanEditDns(): Promise<boolean> {
    // An Access-scoped token can be `status: "active"` on /user/tokens/verify
    // yet still fail a dns_records read -- the only reliable signal is to
    // probe the real DNS read the token would need for writeTxt/writeProxiedCname.
    try {
      await this.req("GET", `${BASE}/zones/${this.zoneId}/dns_records?per_page=1`);
      return true;
    } catch {
      return false;
    }
  }

  async writeTxt(name: string, value: string): Promise<void> {
    await this.req("POST", `${BASE}/zones/${this.zoneId}/dns_records`, {
      type: "TXT",
      name,
      content: value,
    });
  }

  async deleteTxt(name: string): Promise<void> {
    const records = await this.listRecords(name, "TXT");
    for (const record of records) {
      await this.req("DELETE", `${BASE}/zones/${this.zoneId}/dns_records/${record.id}`);
    }
  }

  async writeProxiedCname(host: string, target: string): Promise<void> {
    const payload = { type: "CNAME", name: host, content: target, proxied: true };
    const existing = (await this.listRecords(host, "CNAME"))[0];
    if (existing) {
      await this.req("PATCH", `${BASE}/zones/${this.zoneId}/dns_records/${existing.id}`, payload);
      return;
    }
    await this.req("POST", `${BASE}/zones/${this.zoneId}/dns_records`, payload);
  }

  async cnameTarget(host: string): Promise<string | null> {
    const existing = (await this.listRecords(host, "CNAME"))[0];
    return existing ? existing.content : null;
  }

  async deleteHostRecords(host: string): Promise<void> {
    const records = await this.listRecords(host);
    for (const record of records) {
      await this.req("DELETE", `${BASE}/zones/${this.zoneId}/dns_records/${record.id}`);
    }
  }
}
