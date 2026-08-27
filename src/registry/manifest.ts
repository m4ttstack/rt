import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { stateDir } from "../api/state.ts";
import { getRecord, putRecord } from "./records.ts";

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

const MAX_ICON_BYTES = 64 * 1024;

export function iconsDir(): string {
  return join(stateDir(), "icons");
}

export function iconPathFor(name: string): string {
  return join(iconsDir(), `${name}.svg`);
}

export function removeIcon(name: string): void {
  const p = iconPathFor(name);
  if (existsSync(p)) rmSync(p);
}

/**
 * Reads the app's manifest from its workingDirectory, validates the icon
 * (svg-rooted, at most 64 KB), copies it to the deck icon store, and writes
 * displayName/description/icon onto the record. Every failure path is a quiet
 * skip that leaves the record's launcher fields untouched: a missing
 * workingDirectory (external, port-only apps have none), a missing or
 * malformed manifest, an icon that fails validation, or the icon store being
 * unwritable (full disk, permissions) partway through the write. Never throws.
 */
export function ingestManifest(name: string): void {
  const record = getRecord(name);
  if (!record || record.workingDirectory === undefined) return;
  const manifest = readManifest(record.workingDirectory);
  if (!manifest) return;
  let svg: string;
  try {
    const iconPath = resolve(record.workingDirectory, manifest.icon);
    const bytes = readFileSync(iconPath);
    if (bytes.byteLength > MAX_ICON_BYTES) return;
    svg = bytes.toString("utf8");
  } catch {
    return;
  }
  if (!svg.trimStart().startsWith("<svg")) return;
  try {
    mkdirSync(iconsDir(), { recursive: true });
    writeFileSync(iconPathFor(name), svg);
    putRecord({
      ...record,
      displayName: manifest.displayName,
      description: manifest.description,
      icon: { ext: "svg" },
    });
  } catch {
    return;
  }
}
