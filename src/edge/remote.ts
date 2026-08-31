import { getRecord, putRecord, addIssue, clearIssues, listRecords, type AppRecord } from "../registry/records.ts";
import type { FlowResult } from "../api/register.ts";
import { RailwayCli, type RailwayDriver } from "./railway.ts";
import { CfDnsApi, type CfDns } from "./cf-dns.ts";
import type { DeckSecretsResult } from "./rt-secrets.ts";
import { getPlatformSettings } from "../api/platform-settings.ts";

export interface RefuseCtx {
  record: AppRecord;
  publicDomain: string | null;
  railway: { projectId: string; environmentId: string } | null;
  oauth: { mode: "off" | "emails" | "domains" };
  hasRailwayToken: boolean;
  cfCanEditDns: boolean;
  zoneSslMode: "off" | "flexible" | "full" | "strict";
}
export type Refusal = { status: number; body: { error: string } };

function refuse(status: number, error: string): Refusal { return { status, body: { error } }; }

export function remoteRefuseChecks(ctx: RefuseCtx): Refusal | null {
  const { record } = ctx;
  if (record.kind !== "service" || !record.command?.length) return refuse(400, "no start command, cannot push");
  if (!ctx.publicDomain) return refuse(400, "no-domain-bound");
  if (ctx.publicDomain.split(".").length !== 2) return refuse(400, "public-domain-must-be-first-level");
  if (!ctx.railway) return refuse(400, "railway-not-configured");
  if (ctx.oauth.mode === "off") return refuse(400, "remote-requires-access");
  if (!ctx.hasRailwayToken) return refuse(428, "railway-token-required");
  if (!ctx.cfCanEditDns) return refuse(400, "cf-token-needs-zone-dns");
  if (ctx.zoneSslMode !== "full") return refuse(400, "zone-ssl-mode-full-required");
  return null;
}

/**
 * The real Railway/Cloudflare-DNS drivers, resolved once per request from
 * whichever secrets that request already read. A single shared constructor
 * so the remote/push routes and unregisterApp's teardown never each build a
 * divergently-configured instance; deps.railway/deps.dns let tests inject
 * fakes in place of either.
 */
export function resolveRemoteDrivers(
  deps: { railway?: RailwayDriver; dns?: CfDns },
  sec: DeckSecretsResult,
): { railway: RailwayDriver; dns: CfDns } {
  const rc = getPlatformSettings().railway;
  return {
    railway: deps.railway ?? new RailwayCli({
      apiToken: sec.ok ? sec.railwayApiToken ?? "" : "",
      projectToken: sec.ok ? sec.railwayToken ?? "" : "",
      projectId: rc?.projectId ?? "",
      environmentId: rc?.environmentId ?? "",
    }),
    dns: deps.dns ?? new CfDnsApi({
      zoneId: sec.ok ? sec.cfZoneId ?? "" : "",
      token: sec.ok ? sec.cfDnsToken ?? sec.cfApiToken ?? "" : "",
    }),
  };
}

export interface PushDeps {
  railway: RailwayDriver;
  token: string;
  provenance(dir: string): { sha: string; dirty: boolean };
  hasUntrackedEnv(dir: string): boolean;
  projectId: string; environmentId: string;
}

export async function pushRemote(name: string, deps: PushDeps): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record?.remote) return { status: 404, body: { error: "not in remote mode" } };
  const dir = record.sourceDirectory ?? record.workingDirectory!; // matches the command route's cwd
  if (deps.hasUntrackedEnv(dir)) return { status: 400, body: { error: "untracked .env would upload; add it to .gitignore first" } };

  const { serviceId } = await deps.railway.ensureService(`deck-${name}`, { projectId: deps.projectId, environmentId: deps.environmentId });
  await deps.railway.configureService(serviceId, {
    buildCommand: record.commands?.build,
    startCommand: record.command!.join(" "),
    port: record.port,
    variables: { ...(record.env ?? {}), PORT: String(record.port) },
  });
  const { ok, log } = await deps.railway.up(serviceId, { cwd: dir, token: deps.token });
  if (!ok) {
    addIssue(name, { source: "railway", message: log.slice(0, 300), at: new Date().toISOString() });
    return { status: 502, body: { error: "railway build failed", log: log.slice(0, 2000) } };
  }
  clearIssues(name, "railway");
  const prov = deps.provenance(dir);
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, serviceId, lastPush: { ...prov, at: new Date().toISOString() } } });
  return { status: 200, body: { ok: true, lastPush: getRecord(name)!.remote!.lastPush } };
}

export interface EnableDeps extends PushDeps {
  dns: CfDns;
  publicDomain: string | null;
  oauth: { mode: "off" | "emails" | "domains" };
  hasRailwayToken: boolean;
  railwayConf: { projectId: string; environmentId: string } | null;
  pollBudgetMs: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export async function enableRemote(name: string, deps: EnableDeps): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record) return { status: 404, body: { error: "unknown app" } };

  // Local-only gates first, with passing dns placeholders -- avoids touching
  // the dns driver until the record/domain/oauth/token checks already pass.
  const localOnly = remoteRefuseChecks({
    record, publicDomain: deps.publicDomain, railway: deps.railwayConf, oauth: deps.oauth,
    hasRailwayToken: deps.hasRailwayToken, cfCanEditDns: true, zoneSslMode: "full",
  });
  if (localOnly) return localOnly;

  const refusal = remoteRefuseChecks({
    record, publicDomain: deps.publicDomain, railway: deps.railwayConf, oauth: deps.oauth,
    hasRailwayToken: deps.hasRailwayToken, cfCanEditDns: await deps.dns.tokenCanEditDns(),
    zoneSslMode: await deps.dns.zoneSslMode(),
  });
  if (refusal) return refusal;

  const host = `${name}.${deps.publicDomain}`;
  putRecord({ ...record, remote: { ...record.remote, target: "railway", serviceId: record.remote?.serviceId ?? "", customDomain: host, status: "deploying" } });

  const push = await pushRemote(name, deps); // ensureService + configure + up + provenance
  if (push.status !== 200) return push;
  const serviceId = getRecord(name)!.remote!.serviceId;

  const dom = await deps.railway.ensureCustomDomain(serviceId, host, record.port);
  await deps.dns.writeTxt(dom.txtName, dom.txtValue);
  // nextPollAt spans the whole enable window so reconcileRemote's 5s tick stays
  // out of this record's way while enable is the one actively driving it; if
  // enable dies mid-loop, reconcile resumes after the budget elapses.
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, status: "verifying", cnameTarget: dom.cnameTarget, txtName: dom.txtName, nextPollAt: new Date(deps.now() + deps.pollBudgetMs).toISOString() } });

  const deadline = deps.now() + deps.pollBudgetMs;
  let cutover: "verified-first" | "cname-first" = "cname-first";
  while (deps.now() < deadline) {
    const s = await deps.railway.domainStatus(serviceId, host);
    if (s.verified && s.proxyDetected) { cutover = "verified-first"; break; }
    await deps.sleep(15000);
  }
  await deps.dns.writeProxiedCname(host, dom.cnameTarget); // the cutover -- always last
  putRecord({ ...getRecord(name)!, remote: { ...getRecord(name)!.remote!, status: "live", cutover, url: `https://${host}` } });
  return { status: 200, body: { ok: true, url: `https://${host}`, cutover } };
}

const POLL_BACKOFF_MS = 30000;

// Guards against overlapping 5s ticks driving the same record twice (e.g. one
// tick's awaits outlive the 5s interval). Module-level: reconcileRemote has a
// single timer source, so one flag per process is correct.
let reconcileInFlight = false;

export async function reconcileRemote(deps: { railway: RailwayDriver; dns: CfDns; now(): number }): Promise<void> {
  if (reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    await reconcileRemoteOnce(deps);
  } finally {
    reconcileInFlight = false;
  }
}

async function reconcileRemoteOnce(deps: { railway: RailwayDriver; dns: CfDns; now(): number }): Promise<void> {
  for (const r of listRecords()) {
    const rem = r.remote;
    if (!rem || (rem.status !== "deploying" && rem.status !== "verifying")) continue;
    if (rem.nextPollAt && deps.now() < Date.parse(rem.nextPollAt)) continue;
    const s = await deps.railway.domainStatus(rem.serviceId, rem.customDomain);
    if (s.verified && s.proxyDetected && rem.cnameTarget) {
      await deps.dns.writeProxiedCname(rem.customDomain, rem.cnameTarget); // stored Railway-assigned target, never a guessed host
      putRecord({ ...getRecord(r.name)!, remote: { ...rem, status: "live", cutover: rem.cutover ?? "verified-first", url: `https://${rem.customDomain}` } });
    } else {
      putRecord({ ...getRecord(r.name)!, remote: { ...rem, nextPollAt: new Date(deps.now() + POLL_BACKOFF_MS).toISOString() } });
    }
  }
}

export async function disableRemote(name: string, deps: { railway: RailwayDriver; dns: CfDns }): Promise<FlowResult> {
  const record = getRecord(name);
  if (!record?.remote) return { status: 200, body: { ok: true, alreadyOff: true } };
  const { serviceId, customDomain, txtName } = record.remote;
  await deps.dns.deleteHostRecords(customDomain);      // wildcard tunnel reclaims the host
  if (txtName) await deps.dns.deleteTxt(txtName);       // stored Railway-returned name, never a guessed one
  await deps.railway.removeCustomDomain(serviceId, customDomain);
  await deps.railway.deleteService(serviceId);
  const { remote: _drop, ...rest } = getRecord(name)!;
  putRecord(rest);
  clearIssues(name, "railway");
  return { status: 200, body: { ok: true } };
}
