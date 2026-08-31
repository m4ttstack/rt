export interface RailwayDriver {
  ensureService(name: string, opts: { projectId: string; environmentId: string }): Promise<{ serviceId: string; created: boolean }>;
  configureService(serviceId: string, cfg: { buildCommand?: string; startCommand: string; port: number; variables: Record<string, string> }): Promise<void>;
  up(serviceId: string, opts: { cwd: string; token: string }): Promise<{ ok: boolean; log: string }>;
  ensureCustomDomain(serviceId: string, host: string, targetPort: number): Promise<{ cnameTarget: string; txtName: string; txtValue: string; created: boolean }>;
  domainStatus(serviceId: string, host: string): Promise<{ verified: boolean; proxyDetected: boolean }>;
  removeCustomDomain(serviceId: string, host: string): Promise<void>;
  deleteService(serviceId: string): Promise<void>;
}

type ExecOut = (argv: string[], opts: { cwd: string; env: Record<string, string> }) => Promise<{ code: number; stdout: string }>;
type FetchLike = typeof fetch;

const realExec: ExecOut = async (argv, opts) => {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stderr: "pipe", stdout: "pipe", stdin: "ignore" });
  const stdout = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { code: await proc.exited, stdout };
};

function bin(): string {
  return process.env.LOCAL_RAILWAY_BIN ?? "railway";
}

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

export interface RailwayCliConfig {
  /** Account/team token — GraphQL service management (create/configure/delete). */
  apiToken: string;
  /** Project token — CLI `railway up` + `railway domain` (gives the CLI implicit project context). */
  projectToken: string;
  projectId: string;
  environmentId: string;
  exec?: ExecOut;
  doFetch?: FetchLike;
}

/** Shape of `railway domain … --json` (customDomainCreate) and `railway domain status … --json`. */
interface DomainJson {
  customDomainCreate?: { id: string; status?: { dnsRecords?: DnsRecord[] } };
  domain?: { id: string; dnsRecords?: DnsRecord[]; verification?: { verified: boolean; dnsHost: string; token: string } };
}
interface DnsRecord { recordType: string; requiredValue: string; purpose?: string }

/**
 * Real Railway driver. Service management goes through the public GraphQL API
 * with the account/team token; source upload and custom-domain management go
 * through the `railway` CLI with the project token (the CLI needs a project
 * token for implicit project context, and the account token yields "no linked
 * project" there). Both are validated against the live API.
 */
export class RailwayCli implements RailwayDriver {
  constructor(private cfg: RailwayCliConfig) {}
  private get exec(): ExecOut { return this.cfg.exec ?? realExec; }
  private get doFetch(): FetchLike { return this.cfg.doFetch ?? fetch; }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.doFetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiToken}` },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`railway graphql ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`railway graphql error: ${json.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    if (!json.data) throw new Error("railway graphql: empty response");
    return json.data;
  }

  /** CLI in a neutral cwd with the project token (domains don't care about cwd). */
  private async railway(args: string[]): Promise<{ code: number; stdout: string }> {
    return this.exec([bin(), ...args], { cwd: process.cwd(), env: { RAILWAY_TOKEN: this.cfg.projectToken } });
  }

  async ensureService(name: string, opts: { projectId: string; environmentId: string }): Promise<{ serviceId: string; created: boolean }> {
    const found = await this.graphql<{ project: { services: { edges: { node: { id: string; name: string } }[] } } }>(
      `query($id:String!){ project(id:$id){ services{ edges{ node{ id name } } } } }`,
      { id: opts.projectId },
    );
    const hit = found.project.services.edges.find((e) => e.node.name === name);
    if (hit) return { serviceId: hit.node.id, created: false };
    const created = await this.graphql<{ serviceCreate: { id: string } }>(
      `mutation($i:ServiceCreateInput!){ serviceCreate(input:$i){ id } }`,
      { i: { projectId: opts.projectId, name } },
    );
    return { serviceId: created.serviceCreate.id, created: true };
  }

  async configureService(serviceId: string, cfg: { buildCommand?: string; startCommand: string; port: number; variables: Record<string, string> }): Promise<void> {
    await this.graphql(
      `mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i) }`,
      { s: serviceId, e: this.cfg.environmentId, i: { startCommand: cfg.startCommand, ...(cfg.buildCommand ? { buildCommand: cfg.buildCommand } : {}) } },
    );
    await this.graphql(
      `mutation($i:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$i) }`,
      { i: { projectId: this.cfg.projectId, environmentId: this.cfg.environmentId, serviceId, variables: { ...cfg.variables, PORT: String(cfg.port) }, skipDeploys: true } },
    );
  }

  async up(serviceId: string, opts: { cwd: string; token: string }): Promise<{ ok: boolean; log: string }> {
    const { code, stdout } = await this.exec([bin(), "up", "--service", serviceId, "--ci"], {
      cwd: opts.cwd,
      env: { RAILWAY_TOKEN: opts.token },
    });
    if (code !== 0) return { ok: false, log: stdout.slice(0, 2000) };
    return { ok: true, log: stdout.slice(0, 2000) };
  }

  async ensureCustomDomain(serviceId: string, host: string, targetPort: number): Promise<{ cnameTarget: string; txtName: string; txtValue: string; created: boolean }> {
    const add = await this.railway(["domain", host, "--service", serviceId, "--port", String(targetPort), "--json"]);
    // Idempotent resume: an already-present domain errors on create; fall through to status.
    let created = add.code === 0;
    let cnameTarget = "";
    if (add.code === 0) {
      const j = JSON.parse(add.stdout) as DomainJson;
      cnameTarget = cnameFrom(j.customDomainCreate?.status?.dnsRecords);
    } else if (!/already|exist/i.test(add.stdout)) {
      throw new Error(`railway domain ${host} failed: ${add.stdout.slice(0, 300)}`);
    } else {
      created = false;
    }
    // Status carries the TXT ownership record (and the CNAME when we resumed).
    const st = await this.railway(["domain", "status", host, "--service", serviceId, "--json"]);
    if (st.code !== 0) throw new Error(`railway domain status ${host} failed: ${st.stdout.slice(0, 300)}`);
    const s = JSON.parse(st.stdout) as DomainJson;
    if (!cnameTarget) cnameTarget = cnameFrom(s.domain?.dnsRecords);
    const v = s.domain?.verification;
    if (!v) throw new Error(`railway domain status ${host}: no verification record`);
    return { cnameTarget, txtName: v.dnsHost, txtValue: v.token, created };
  }

  async domainStatus(_serviceId: string, host: string): Promise<{ verified: boolean; proxyDetected: boolean }> {
    const st = await this.railway(["domain", "status", host, "--service", _serviceId, "--json"]);
    if (st.code !== 0) throw new Error(`railway domain status ${host} failed: ${st.stdout.slice(0, 300)}`);
    const verified = (JSON.parse(st.stdout) as DomainJson).domain?.verification?.verified ?? false;
    // Railway's own `verified` already means ownership confirmed (TXT + CF proxy);
    // the driver's proxyDetected is folded into it.
    return { verified, proxyDetected: verified };
  }

  async removeCustomDomain(serviceId: string, host: string): Promise<void> {
    const { code, stdout } = await this.railway(["domain", "delete", host, "-y", "--service", serviceId]);
    if (code !== 0 && !/not found|no such|does not/i.test(stdout)) {
      throw new Error(`railway domain delete ${host} failed: ${stdout.slice(0, 300)}`);
    }
  }

  async deleteService(serviceId: string): Promise<void> {
    await this.graphql(`mutation($id:String!){ serviceDelete(id:$id) }`, { id: serviceId });
  }
}

function cnameFrom(records?: DnsRecord[]): string {
  const r = (records ?? []).find((x) => x.recordType.includes("CNAME"));
  if (!r) throw new Error("railway domain: no CNAME record in response");
  return r.requiredValue;
}
