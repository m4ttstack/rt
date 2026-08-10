import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface EdgeProxy {
  alias(name: string, port: number): Promise<void>;
  removeAlias(name: string): Promise<void>;
}

export type Exec = (argv: string[]) => Promise<number>;

const realExec: Exec = async (argv) => {
  const proc = Bun.spawn(argv, { stderr: "ignore", stdout: "ignore" });
  return await proc.exited;
};

/**
 * Registration goes through the portless CLI, never its files (ruled). The one
 * sanctioned file write stays core/routes-writer.ts (override repointing, whose
 * in-place-write discipline is load-bearing). Reads of routes.json / proxy.tlds
 * are fine and already established practice.
 */
export class PortlessCli implements EdgeProxy {
  // Resolved once at construction against the CURRENT PATH, not looked up
  // per call: defense in depth alongside the plist-level PATH fixes (see
  // registry/bootstrap.ts, services/plist.ts) for the platform's own process,
  // which shells out to portless directly rather than through a plist.
  private readonly portlessBin: string;

  constructor(private exec: Exec = realExec) {
    // Bun.which() with no PATH option resolves against a PATH snapshot taken
    // at Bun's own process startup, not the live process.env.PATH; passing
    // it explicitly is what actually picks up PATH as it stands right now
    // (the installing shell's captured PATH, once the platform's own plist
    // carries one; see registry/bootstrap.ts).
    this.portlessBin = Bun.which("portless", { PATH: process.env.PATH ?? "" }) ?? "portless";
  }

  async alias(name: string, port: number): Promise<void> {
    const argv = [this.portlessBin, "alias", name, String(port)];
    if ((await this.exec(argv)) !== 0) throw new Error(`\`portless alias ${name} ${port}\` failed`);
  }

  async removeAlias(name: string): Promise<void> {
    const argv = [this.portlessBin, "alias", "--remove", name];
    if ((await this.exec(argv)) !== 0) throw new Error(`\`portless alias --remove ${name}\` failed`);
  }
}

/**
 * Active proxy TLDs (portless 0.15.5 multi-TLD, live-verified: an alias
 * registers under every active TLD). Newline-separated file next to routes.json.
 */
export function readProxyTlds(): string[] {
  const path =
    process.env.LOCAL_PORTLESS_TLDS_PATH ?? join(homedir(), ".portless", "proxy.tlds");
  try {
    const tlds = readFileSync(path, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    if (tlds.length) return tlds;
  } catch {
    // fall through
  }
  return ["localhost"];
}

export class FakeEdgeProxy implements EdgeProxy {
  aliases = new Map<string, number>();
  failNext: string | null = null;

  private maybeFail(name: string): void {
    if (this.failNext === name) {
      this.failNext = null;
      throw new Error(`fake portless: operation failed for ${name}`);
    }
  }

  async alias(name: string, port: number): Promise<void> {
    this.maybeFail(name);
    this.aliases.set(name, port);
  }
  async removeAlias(name: string): Promise<void> {
    this.maybeFail(name);
    this.aliases.delete(name);
  }
}
