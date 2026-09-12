/**
 * The finish gate: rows that block the wizard's Finish (never Install) until
 * they are ready, skipped, or waived on this Mac. The waiver lives in the
 * machine-scoped `setup.waived` key and is read and written only through
 * the resolver.
 */

import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { FINISH_GATED_ROW_IDS, type Group } from "./contract.ts";
import { UserActionableError } from "./errors.ts";
import type { SettingsReader } from "./team-settings.ts";

export const WAIVED_SETTING_KEY = "setup.waived";
export const WAIVED_NOTE = "Skipped on this Mac: agents cannot capture screenshots or annotate evidence from your browser. Load it later from Settings.";

/** The row ids waived on this Mac, read through the resolver on every call. A store the resolver cannot read means the waivers are unknown, so the gate stays closed: none. */
export function readWaived(opts: { read?: SettingsReader; warn?: (message: string) => void } = {}): string[] {
  const warn = opts.warn ?? ((message: string) => console.error(message));
  const read = opts.read ?? (<T>(key: string): T | undefined => getSetting<T>(key).value);
  let value: unknown;
  try {
    value = read<unknown>(WAIVED_SETTING_KEY);
  } catch (err) {
    warn(`rt: ${WAIVED_SETTING_KEY} could not be resolved (${err instanceof Error ? err.message : String(err)}), treated as none`);
    return [];
  }
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * In status mode an unwaived finish-gated row reads required:true, so the
 * post-install view names it as owed; a `skipped` one keeps its shape, since
 * there is nothing to load into. Plan mode leaves the validator's shape
 * alone, so Install stays reachable. A waived row reads optional with the
 * note that states the cost, in either mode.
 */
export function applyFinishGate(groups: Group[], mode: "plan" | "status", waived: readonly string[] = []): Group[] {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      if (!r.finishGated) return r;
      if (waived.includes(r.id)) return { ...r, required: false, waived: true, optionalNote: WAIVED_NOTE };
      if (mode === "status" && r.status !== "skipped") return { ...r, required: true, optionalNote: null };
      return r;
    }),
  }));
}

export interface WaiverStore {
  read: () => string[];
  write: (ids: string[]) => void;
}

/** The only writer of `setup.waived`, and only at machine scope. */
export function realWaiverStore(): WaiverStore {
  return { read: () => readWaived(), write: (ids) => setSetting(WAIVED_SETTING_KEY, ids, "machine") };
}

function assertFinishGated(id: string): void {
  if (FINISH_GATED_ROW_IDS.includes(id)) return;
  throw new UserActionableError("not-finish-gated", `${id} is not a finish-gated row; finish-gated rows: ${FINISH_GATED_ROW_IDS.join(", ")}`);
}

/** Records `id` as skipped on this Mac; a second call writes nothing. Returns the stored list. */
export function waiveRow(id: string, store: WaiverStore): string[] {
  assertFinishGated(id);
  const current = store.read();
  if (current.includes(id)) return current;
  const next = [...current, id];
  store.write(next);
  return next;
}

/** Re-arms `id` on this Mac; an id that was not waived writes nothing. Returns the stored list. */
export function unwaiveRow(id: string, store: WaiverStore): string[] {
  assertFinishGated(id);
  const current = store.read();
  if (!current.includes(id)) return current;
  const next = current.filter((x) => x !== id);
  store.write(next);
  return next;
}
