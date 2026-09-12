/**
 * The finish gate: rows that block the wizard's Finish (never Install) until
 * they are ready, skipped, or waived on this Mac. The waiver lives in the
 * machine-scoped `setup.waived` key and is read and written only through
 * the resolver.
 */

import { getSetting } from "../settings/resolve.ts";
import type { Group } from "./contract.ts";
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
      if (waived.includes(r.id)) return { ...r, required: false, optionalNote: WAIVED_NOTE };
      if (mode === "status" && r.status !== "skipped") return { ...r, required: true, optionalNote: null };
      return r;
    }),
  }));
}
