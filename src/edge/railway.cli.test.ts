import { expect, test } from "bun:test";
import { RailwayCli } from "./railway.ts";

const CFG = { apiToken: "team-tok", projectToken: "proj-tok", projectId: "p1", environmentId: "e1" };

// A fetch mock that branches on the GraphQL operation name and records the last body per op.
function fakeGraphql(handlers: Record<string, (vars: any) => any> = {}) {
  const calls: Array<{ op: string; vars: any }> = [];
  const doFetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const op = /mutation\s*\(|query\s*\(/.test(body.query)
      ? (body.query.match(/\b(serviceCreate|serviceInstanceUpdate|variableCollectionUpsert|serviceDelete|project)\b/)?.[1] ?? "unknown")
      : "unknown";
    calls.push({ op, vars: body.variables });
    const data = handlers[op]?.(body.variables) ?? {};
    return { ok: true, status: 200, text: async () => JSON.stringify({ data }) } as any;
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

test("ensureService: creates when absent, reuses when present", async () => {
  const g1 = fakeGraphql({ project: () => ({ project: { services: { edges: [] } } }), serviceCreate: () => ({ serviceCreate: { id: "svc-new" } }) });
  const rw1 = new RailwayCli({ ...CFG, doFetch: g1.doFetch });
  expect(await rw1.ensureService("deck-x", { projectId: "p1", environmentId: "e1" })).toEqual({ serviceId: "svc-new", created: true });
  expect(g1.calls.map((c) => c.op)).toEqual(["project", "serviceCreate"]);

  const g2 = fakeGraphql({ project: () => ({ project: { services: { edges: [{ node: { id: "svc-old", name: "deck-x" } }] } } }) });
  const rw2 = new RailwayCli({ ...CFG, doFetch: g2.doFetch });
  expect(await rw2.ensureService("deck-x", { projectId: "p1", environmentId: "e1" })).toEqual({ serviceId: "svc-old", created: false });
  expect(g2.calls.map((c) => c.op)).toEqual(["project"]); // no serviceCreate
});

test("configureService: sets build/start then upserts variables incl PORT", async () => {
  const g = fakeGraphql({ serviceInstanceUpdate: () => ({ serviceInstanceUpdate: true }), variableCollectionUpsert: () => ({ variableCollectionUpsert: true }) });
  const rw = new RailwayCli({ ...CFG, doFetch: g.doFetch });
  await rw.configureService("svc1", { buildCommand: "b", startCommand: "s", port: 11010, variables: { API: "x" } });
  expect(g.calls.map((c) => c.op)).toEqual(["serviceInstanceUpdate", "variableCollectionUpsert"]);
  expect(g.calls[0]!.vars.i).toEqual({ startCommand: "s", buildCommand: "b" });
  expect(g.calls[1]!.vars.i.variables).toEqual({ API: "x", PORT: "11010" });
  expect(g.calls[1]!.vars.i.skipDeploys).toBe(true);
});

test("deleteService issues serviceDelete with the account token", async () => {
  const g = fakeGraphql({ serviceDelete: () => ({ serviceDelete: true }) });
  let authHeader = "";
  const doFetch = (async (_u: string, init: any) => { authHeader = init.headers.authorization; return g.doFetch(_u, init); }) as any;
  const rw = new RailwayCli({ ...CFG, doFetch });
  await rw.deleteService("svc1");
  expect(g.calls[0]!.op).toBe("serviceDelete");
  expect(authHeader).toBe("Bearer team-tok");
});

// --- CLI-backed methods: mock exec ---
function fakeExec(byCmd: (argv: string[]) => { code: number; stdout: string }) {
  const calls: string[][] = [];
  const exec = async (argv: string[], _o: any) => { calls.push(argv); return byCmd(argv); };
  return { exec, calls };
}

const CREATE_JSON = JSON.stringify({ customDomainCreate: { id: "d1", status: { dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "abc.up.railway.app" }] } } });
const STATUS_JSON = JSON.stringify({ domain: { id: "d1", dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "abc.up.railway.app" }], verification: { verified: true, dnsHost: "_railway-verify.app", token: "railway-verify=hex" } } });

test("ensureCustomDomain parses CNAME (create) + TXT (status)", async () => {
  const { exec, calls } = fakeExec((argv) =>
    argv.includes("status") ? { code: 0, stdout: STATUS_JSON } : { code: 0, stdout: CREATE_JSON });
  const rw = new RailwayCli({ ...CFG, exec });
  const d = await rw.ensureCustomDomain("svc1", "app.m4tthew.dev", 11010);
  expect(d).toEqual({ cnameTarget: "abc.up.railway.app", txtName: "_railway-verify.app", txtValue: "railway-verify=hex", created: true });
  expect(calls[0]).toEqual(["railway", "domain", "app.m4tthew.dev", "--service", "svc1", "--port", "11010", "--json"]);
});

test("domainStatus reads verification.verified", async () => {
  const { exec } = fakeExec(() => ({ code: 0, stdout: STATUS_JSON }));
  const rw = new RailwayCli({ ...CFG, exec });
  expect(await rw.domainStatus("svc1", "app.m4tthew.dev")).toEqual({ verified: true, proxyDetected: true });
});

test("removeCustomDomain tolerates a not-found delete", async () => {
  const { exec, calls } = fakeExec(() => ({ code: 1, stdout: "domain not found" }));
  const rw = new RailwayCli({ ...CFG, exec });
  await rw.removeCustomDomain("svc1", "app.m4tthew.dev"); // no throw
  expect(calls[0]).toEqual(["railway", "domain", "delete", "app.m4tthew.dev", "-y", "--service", "svc1"]);
});

test("up returns ok:true on exit 0, ok:false on non-zero (no throw)", async () => {
  const ok = new RailwayCli({ ...CFG, exec: fakeExec(() => ({ code: 0, stdout: "built" })).exec });
  expect((await ok.up("svc1", { cwd: "/tmp/a", token: "proj-tok" })).ok).toBe(true);
  const bad = new RailwayCli({ ...CFG, exec: fakeExec(() => ({ code: 1, stdout: "boom" })).exec });
  expect((await bad.up("svc1", { cwd: "/tmp/a", token: "proj-tok" })).ok).toBe(false);
});
