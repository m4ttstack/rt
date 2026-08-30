import type { RailwayDriver } from "../../src/edge/railway.ts";

export class FakeRailwayDriver implements RailwayDriver {
  services = new Map<string, { name: string }>();
  domains = new Map<string, { serviceId: string; targetPort: number }>();
  status = new Map<string, { verified: boolean; proxyDetected: boolean }>();
  calls: string[] = [];
  upResult: { ok: boolean; log: string } = { ok: true, log: "built" };
  byName = new Map<string, string>();

  async ensureService(name: string, _o: { projectId: string; environmentId: string }) {
    this.calls.push(`ensureService:${name}`);
    const existing = this.byName.get(name);
    if (existing) return { serviceId: existing, created: false };
    const id = `svc_${this.services.size + 1}`;
    this.services.set(id, { name }); this.byName.set(name, id);
    return { serviceId: id, created: true };
  }
  async configureService(id: string, _cfg: any) { this.calls.push(`configure:${id}`); }
  async up(id: string, _o: { cwd: string; token: string }) { this.calls.push(`up:${id}`); return this.upResult; }
  async ensureCustomDomain(serviceId: string, host: string, targetPort: number) {
    this.calls.push(`ensureDomain:${host}`);
    const created = !this.domains.has(host);
    this.domains.set(host, { serviceId, targetPort });
    return { cnameTarget: `kw1ig666.up.railway.app`, txtName: `_railway-verify.${host}`, txtValue: `railway-verify=deadbeef${host.length}`, created };
  }
  async domainStatus(_id: string, host: string) { return this.status.get(host) ?? { verified: false, proxyDetected: false }; }
  async removeCustomDomain(_id: string, host: string) { this.calls.push(`removeDomain:${host}`); this.domains.delete(host); }
  async deleteService(id: string) { this.calls.push(`deleteService:${id}`); this.services.delete(id); }
  setVerified(host: string, s: { verified: boolean; proxyDetected: boolean }) { this.status.set(host, s); }
}
