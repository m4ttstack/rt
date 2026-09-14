import type { Database } from "bun:sqlite";
import type { IntegrationDef, ValidateCtx } from "../setup/integrations.ts";
import type { Probes } from "../setup/probes.ts";
import { readCredentialHealth, writeCredentialHealth } from "./db.ts";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 7;

export interface IntegrationTarget {
  id: string;
  def: IntegrationDef;
  token: string;
  ctx: ValidateCtx;
}

export interface SweepDeps {
  db: Database;
  targets: () => Promise<IntegrationTarget[]>;
  probes: Probes;
  notifyEnabled: (category: string, title: string, message: string, url?: string) => void;
  emitEvent: (topic: string, payload: Record<string, unknown>) => void;
  now: () => number;
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

export function daysUntil(dateStr: string, nowMs: number): number {
  const target = new Date(dateStr).getTime();
  return Math.max(0, Math.ceil((target - nowMs) / (24 * 60 * 60 * 1000)));
}

export async function runAccountsSweep(deps: SweepDeps): Promise<void> {
  const { db, probes, now: getNow, log } = deps;
  let targets: IntegrationTarget[];
  try {
    targets = await deps.targets();
  } catch (err) {
    log.warn("accounts-sweep: failed to resolve targets", { err });
    return;
  }

  for (const { id, def, token, ctx } of targets) {
    try {
      await checkOne(deps, id, def, token, ctx, probes, db, getNow());
    } catch (err) {
      log.warn(`accounts-sweep: ${id} threw`, { err });
      const now = getNow();
      writeCredentialHealth(db, {
        integration: id,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
        expiresAt: null,
        checkedAt: now,
        lastNotifiedAt: null,
        lastNotifiedKind: null,
      });
    }
  }
}

async function checkOne(
  deps: SweepDeps,
  id: string,
  def: IntegrationDef,
  token: string,
  ctx: ValidateCtx,
  probes: Probes,
  db: Database,
  now: number,
): Promise<void> {
  const result = await def.validate(probes, token, ctx);
  const { status, detail } = result;

  let expiresAt: string | null = null;
  if (def.expiry && status === "ready" && token) {
    try {
      const exp = await def.expiry(probes, token, ctx);
      expiresAt = exp?.expiresAt ?? null;
    } catch {
      // Expiry is a best-effort probe (see IntegrationDef.expiry); a failure
      // here must not be conflated with a validate() failure, which is the
      // only thing that can flip status to "error".
    }
  }

  const prev = readCredentialHealth(db, id);

  let notifyKind: "dead" | "expiring" | null = null;

  if (status === "invalid") {
    const wasInvalid = prev?.status === "invalid";
    const recentlyNotified =
      wasInvalid && prev.lastNotifiedAt != null && now - prev.lastNotifiedAt < TWENTY_FOUR_HOURS;
    if (!recentlyNotified) notifyKind = "dead";
  } else if (status === "ready" && expiresAt) {
    const days = daysUntil(expiresAt, now);
    if (days <= WARNING_DAYS && days > 0) {
      const recentlyNotified =
        prev?.lastNotifiedKind === "expiring" &&
        prev.lastNotifiedAt != null &&
        now - prev.lastNotifiedAt < TWENTY_FOUR_HOURS;
      if (!recentlyNotified) notifyKind = "expiring";
    }
  }

  let lastNotifiedAt = prev?.lastNotifiedAt ?? null;
  let lastNotifiedKind = prev?.lastNotifiedKind ?? null;

  if (status === "ready" && prev?.status === "invalid") {
    lastNotifiedAt = null;
    lastNotifiedKind = null;
  }
  if (notifyKind) {
    lastNotifiedAt = now;
    lastNotifiedKind = notifyKind;
  }

  writeCredentialHealth(db, {
    integration: id,
    status,
    detail,
    expiresAt,
    checkedAt: now,
    lastNotifiedAt,
    lastNotifiedKind,
  });

  if (notifyKind === "dead") {
    deps.notifyEnabled(
      "credential_health",
      `${def.title} token rejected`,
      `${detail}. Reconnect in Settings.`,
    );
    deps.emitEvent("credential/health", {
      integration: id, status, detail, transition: "dead",
    });
  } else if (notifyKind === "expiring") {
    const days = daysUntil(expiresAt!, now);
    deps.notifyEnabled(
      "credential_health",
      `${def.title} token expires in ${days} day${days === 1 ? "" : "s"}`,
      `Expires ${expiresAt}. Reconnect in Settings.`,
    );
    deps.emitEvent("credential/health", {
      integration: id, status, expiresAt, transition: "expiring", daysLeft: days,
    });
  }

  if (status === "ready" && prev?.status === "invalid") {
    deps.emitEvent("credential/health", {
      integration: id, status, transition: "recovered",
    });
  }
}
