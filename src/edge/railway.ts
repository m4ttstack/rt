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
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stderr: "pipe", stdout: "pipe" });
  const stdout = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { code: await proc.exited, stdout };
};

function bin(): string {
  return process.env.LOCAL_RAILWAY_BIN ?? "railway";
}

const GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

/**
 * Thin skeleton: `up` shells the `railway` CLI, everything else hits Railway's
 * GraphQL API. Real payload shapes are intentionally not modeled here -- the
 * fake in test/fixture/remote.ts carries the behavior the rest of the feature
 * is tested against.
 */
export class RailwayCli implements RailwayDriver {
  constructor(
    private exec: ExecOut = realExec,
    private doFetch: FetchLike = fetch,
  ) {}

  private async graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.doFetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`railway graphql ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`railway graphql error: ${json.errors[0]!.message.slice(0, 300)}`);
    if (!json.data) throw new Error("railway graphql: empty response");
    return json.data;
  }

  async ensureService(name: string, opts: { projectId: string; environmentId: string }): Promise<{ serviceId: string; created: boolean }> {
    throw new Error(`RailwayCli.ensureService not implemented (${name}, ${opts.projectId}/${opts.environmentId})`);
  }

  async configureService(serviceId: string, _cfg: { buildCommand?: string; startCommand: string; port: number; variables: Record<string, string> }): Promise<void> {
    throw new Error(`RailwayCli.configureService not implemented (${serviceId})`);
  }

  async up(serviceId: string, opts: { cwd: string; token: string }): Promise<{ ok: boolean; log: string }> {
    const { code, stdout } = await this.exec([bin(), "up", "--service", serviceId, "--ci"], {
      cwd: opts.cwd,
      env: { RAILWAY_TOKEN: opts.token },
    });
    if (code !== 0) throw new Error(`railway up ${serviceId} failed: ${stdout.slice(0, 300)}`);
    return { ok: true, log: stdout.slice(0, 300) };
  }

  async ensureCustomDomain(serviceId: string, host: string, targetPort: number): Promise<{ cnameTarget: string; txtName: string; txtValue: string; created: boolean }> {
    throw new Error(`RailwayCli.ensureCustomDomain not implemented (${serviceId}, ${host}, ${targetPort})`);
  }

  async domainStatus(serviceId: string, host: string): Promise<{ verified: boolean; proxyDetected: boolean }> {
    throw new Error(`RailwayCli.domainStatus not implemented (${serviceId}, ${host})`);
  }

  async removeCustomDomain(serviceId: string, host: string): Promise<void> {
    throw new Error(`RailwayCli.removeCustomDomain not implemented (${serviceId}, ${host})`);
  }

  async deleteService(serviceId: string): Promise<void> {
    throw new Error(`RailwayCli.deleteService not implemented (${serviceId})`);
  }
}
