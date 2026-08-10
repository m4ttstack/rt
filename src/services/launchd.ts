import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ServiceManager, ServiceSpec } from "./manager.ts";
import { renderPlist } from "./plist.ts";

export type Exec = (argv: string[]) => Promise<number>;

const realExec: Exec = async (argv) => {
  const proc = Bun.spawn(argv, { stderr: "ignore", stdout: "ignore" });
  return await proc.exited;
};

export function agentsDir(): string {
  return process.env.LOCAL_AGENTS_DIR ?? join(homedir(), "Library", "LaunchAgents");
}

export class LaunchdManager implements ServiceManager {
  constructor(private exec: Exec = realExec) {}

  private plistPath(label: string): string {
    return join(agentsDir(), `${label}.plist`);
  }

  async install(spec: ServiceSpec): Promise<void> {
    mkdirSync(agentsDir(), { recursive: true });
    const path = this.plistPath(spec.label);
    writeFileSync(path, renderPlist(spec));
    const code = await this.exec(["launchctl", "load", path]);
    if (code !== 0) throw new Error(`launchctl load failed for ${spec.label} (exit ${code})`);
  }

  async uninstall(label: string): Promise<void> {
    const path = this.plistPath(label);
    // Unload before removing; a failed unload (already unloaded) is not fatal.
    await this.exec(["launchctl", "unload", path]);
    rmSync(path, { force: true });
  }

  async kickstart(label: string): Promise<boolean> {
    const uid = process.getuid?.() ?? 0;
    return (await this.exec(["launchctl", "kickstart", "-k", `gui/${uid}/${label}`])) === 0;
  }

  async isInstalled(label: string): Promise<boolean> {
    return existsSync(this.plistPath(label));
  }
}
