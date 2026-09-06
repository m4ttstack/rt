import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export interface TunnelDriver {
  create(name: string): Promise<{ uuid: string }>;
  delete(name: string): Promise<void>;
  list(): Promise<Array<{ name: string; uuid: string; connections: number }>>;
  info(name: string): Promise<{ connectors: number }>;
}

type ExecOut = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realExec: ExecOut = async (argv) => {
  const proc = Bun.spawn(argv, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
};

function bin(): string {
  return process.env.LOCAL_CLOUDFLARED_BIN ?? "cloudflared";
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

interface ListedTunnel { id: string; name: string; connections?: unknown[] }

export class CloudflaredCli implements TunnelDriver {
  constructor(private exec: ExecOut = realExec) {}

  private async run(args: string[], what: string): Promise<string> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", ...args]);
    if (code !== 0) throw new Error(`cloudflared tunnel ${what} failed: ${(stdout + stderr).slice(0, 300)}`);
    return stdout + stderr;
  }

  async create(name: string): Promise<{ uuid: string }> {
    const out = await this.run(["create", name], `create ${name}`);
    const uuid = out.match(UUID_RE)?.[0];
    if (!uuid) throw new Error("cloudflared did not report a tunnel id");
    return { uuid };
  }

  // Unforced delete fails while edge connections linger after the launchd
  // service is gone, which would strand the tunnel and its credentials.
  async delete(name: string): Promise<void> {
    await this.run(["delete", "-f", name], `delete ${name}`);
  }

  async list(): Promise<Array<{ name: string; uuid: string; connections: number }>> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", "list", "-o", "json"]);
    if (code !== 0) throw new Error(`cloudflared tunnel list failed: ${(stdout + stderr).slice(0, 300)}`);
    const rows = JSON.parse(stdout) as ListedTunnel[];
    return rows.map((r) => ({ name: r.name, uuid: r.id, connections: r.connections?.length ?? 0 }));
  }

  // Flags must precede the name: cloudflared parses `info <name> -o json` as two arguments.
  async info(name: string): Promise<{ connectors: number }> {
    const { code, stdout, stderr } = await this.exec([bin(), "tunnel", "info", "-o", "json", name]);
    if (code !== 0) throw new Error(`cloudflared tunnel info ${name} failed: ${(stdout + stderr).slice(0, 300)}`);
    const t = JSON.parse(stdout) as { conns?: unknown[] };
    return { connectors: t.conns?.length ?? 0 };
  }
}

export interface TunnelConfig {
  uuid: string;
  credentialsFile: string;
  domain: string;
  gatewayPort: number;
  metricsPort: number;
}

export function renderTunnelConfig(o: TunnelConfig): string {
  return `tunnel: ${o.uuid}
credentials-file: ${o.credentialsFile}
metrics: 127.0.0.1:${o.metricsPort}

ingress:
  - hostname: "*.${o.domain}"
    service: http://localhost:${o.gatewayPort}
  - service: http_status:404
`;
}

export function writeTunnelConfig(path: string, o: TunnelConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderTunnelConfig(o));
}

export class FakeTunnelDriver implements TunnelDriver {
  calls: string[][] = [];
  /** name -> uuid, the account-side view `list()` reports. */
  tunnels = new Map<string, string>();
  connectors = 1;
  private seq = 0;
  constructor(private credsDir?: string) {}
  async create(name: string) {
    this.calls.push(["create", name]);
    const uuid = `fake-uuid-${++this.seq}`;
    this.tunnels.set(name, uuid);
    if (this.credsDir) writeFileSync(join(this.credsDir, `${uuid}.json`), "{}");
    return { uuid };
  }
  async delete(name: string) { this.calls.push(["delete", name]); this.tunnels.delete(name); }
  async list() {
    this.calls.push(["list"]);
    return [...this.tunnels].map(([name, uuid]) => ({ name, uuid, connections: 0 }));
  }
  async info(name: string) { this.calls.push(["info", name]); return { connectors: this.connectors }; }
}
