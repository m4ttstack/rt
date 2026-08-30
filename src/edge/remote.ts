import type { AppRecord } from "../registry/records.ts";

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
