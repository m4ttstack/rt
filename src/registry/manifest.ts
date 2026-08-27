import { readFileSync } from "fs";
import { join } from "path";

export interface Manifest {
  displayName: string;
  description?: string;
  icon: string;
}

/**
 * Reads and validates `<dir>/mattstack.json`. Returns null for any problem
 * (absent, unparseable, missing required fields) rather than throwing: a bad
 * manifest must never fail the adopt that triggered the read. Icon file
 * existence and SVG validity are checked later, at ingest, not here.
 */
export function readManifest(dir: string): Manifest | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, "mattstack.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (typeof m.displayName !== "string" || m.displayName.length === 0) return null;
  if (typeof m.icon !== "string" || m.icon.length === 0) return null;
  const out: Manifest = { displayName: m.displayName, icon: m.icon };
  if (typeof m.description === "string") out.description = m.description;
  return out;
}
