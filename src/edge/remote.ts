import { getRecord, putRecord, addIssue, clearIssues, type AppRecord } from "../registry/records.ts";
import type { FlowResult } from "../api/register.ts";
import type { RailwayDriver } from "./railway.ts";

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
