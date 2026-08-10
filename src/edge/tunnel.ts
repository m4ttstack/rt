import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface TunnelDriver {
  create(name: string): Promise<{ uuid: string }>;
  routeDns(name: string, hostname: string): Promise<void>;
  deleteTunnel(name: string): Promise<void>;
}

type ExecOut = (argv: string[]) => Promise<{ code: number; stdout: string }>;

const realExec: ExecOut = async (argv) => {
  const proc = Bun.spawn(argv, { stderr: "pipe", stdout: "pipe" });
  const stdout = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { code: await proc.exited, stdout };
};

function bin(): string {
  return process.env.LOCAL_CLOUDFLARED_BIN ?? "cloudflared";
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export class CloudflaredCli implements TunnelDriver {
  constructor(private exec: ExecOut = realExec) {}

  async create(name: string): Promise<{ uuid: string }> {
    const { code, stdout } = await this.exec([bin(), "tunnel", "create", name]);
    if (code !== 0) throw new Error(`cloudflared tunnel create ${name} failed: ${stdout.slice(0, 300)}`);
    const uuid = stdout.match(UUID_RE)?.[0];
    if (!uuid) throw new Error("cloudflared did not report a tunnel id");
    return { uuid };
  }

  async routeDns(name: string, hostname: string): Promise<void> {
    const { code, stdout } = await this.exec([bin(), "tunnel", "route", "dns", name, hostname]);
    if (code !== 0) throw new Error(`cloudflared route dns failed: ${stdout.slice(0, 300)}`);
  }

  async deleteTunnel(name: string): Promise<void> {
    const { code, stdout } = await this.exec([bin(), "tunnel", "delete", name]);
    if (code !== 0) throw new Error(`cloudflared tunnel delete failed: ${stdout.slice(0, 300)}`);
  }
}

/** The proven yml shape from the skill's dedicated-tunnel section, wildcarded. */
export function writeTunnelConfig(opts: {
  name: string; uuid: string; domain: string; gatewayPort: number; cloudflaredDir?: string;
}): string {
  const dir = opts.cloudflaredDir ?? join(homedir(), ".cloudflared");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${opts.name}.yml`);
  writeFileSync(path, `tunnel: ${opts.uuid}
credentials-file: ${join(dir, `${opts.uuid}.json`)}

ingress:
  - hostname: "*.${opts.domain}"
    service: http://localhost:${opts.gatewayPort}
  - service: http_status:404
`);
  return path;
}

export class FakeTunnelDriver implements TunnelDriver {
  calls: string[][] = [];
  async create(name: string) { this.calls.push(["create", name]); return { uuid: "fake-uuid" }; }
  async routeDns(name: string, hostname: string) { this.calls.push(["routeDns", name, hostname]); }
  async deleteTunnel(name: string) { this.calls.push(["deleteTunnel", name]); }
}
