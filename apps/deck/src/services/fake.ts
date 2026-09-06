import type { ServiceManager, ServiceSpec } from "./manager.ts";

/** Deterministic in-memory manager for API tests. */
export class FakeServiceManager implements ServiceManager {
  installed = new Map<string, ServiceSpec>();
  kickstarts: string[] = [];
  /** When set to a label, the next operation on it throws (loud-degradation tests). */
  failNext: string | null = null;

  private maybeFail(label: string, op: string): void {
    if (this.failNext === label) {
      this.failNext = null;
      throw new Error(`fake launchd: ${op} failed for ${label}`);
    }
  }

  async install(spec: ServiceSpec): Promise<void> {
    this.maybeFail(spec.label, "install");
    this.installed.set(spec.label, spec);
  }
  async uninstall(label: string): Promise<void> {
    this.maybeFail(label, "uninstall");
    this.installed.delete(label);
  }
  async kickstart(label: string): Promise<boolean> {
    this.kickstarts.push(label);
    return this.installed.has(label);
  }
  async isInstalled(label: string): Promise<boolean> {
    return this.installed.has(label);
  }
}
