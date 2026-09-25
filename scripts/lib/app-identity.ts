// An app's launcher identity (name, icon, badge) as the mattstack.app bundle
// ships it at Contents/Resources/apps/<name>/: staged into each app tarball by
// bundle-apps, materialized by fetch-deps, landed by build.sh, asserted by
// check-bundle.sh. Imported by the bundle-apps build job, which never installs
// this repo's dependencies, so every runtime import stays in node builtins.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";

export const IDENTITY_MANIFEST = "mattstack.deck.json";

// Parity anchor: m4ttstack/apps apps/deck/src/registry/manifest.ts
// (MAX_ICON_BYTES, SVG_ROOT) and deck-manifest.ts (NAME_RE, the badge rule).
// Deck silently drops an identity it refuses, so these rules move with deck's.
const MAX_ICON_BYTES = 64 * 1024;
const SVG_ROOT = /^\s*(?:<\?xml\b[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\b[^>]*>\s*)*<svg[\s>]/i;
const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;

export interface AppIdentity {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  badge?: string;
}

/** The icon path's segments below the identity dir. */
export function iconSegments(icon: string): string[] {
  if (isAbsolute(icon)) throw new Error(`icon ${icon} must be relative to the app dir`);
  const segs = icon.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.includes("..")) throw new Error(`icon ${icon} must not contain ".." segments`);
  if (segs.length === 0) throw new Error(`icon ${icon} names no file`);
  // Same rule as skills dirs: a dotted directory inside the bundle can read to
  // codesign as a nested bundle.
  for (const dir of segs.slice(0, -1)) {
    if (dir.includes(".")) throw new Error(`icon ${icon}: directory ${dir} contains a dot`);
  }
  return segs;
}

export function isSvgIcon(path: string): boolean {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return false;
  }
  return bytes.byteLength <= MAX_ICON_BYTES && SVG_ROOT.test(bytes.toString("utf8"));
}

export function readDeclaredIdentity(dir: string): AppIdentity | null {
  const path = join(dir, IDENTITY_MANIFEST);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`no ${IDENTITY_MANIFEST} in ${dir}`);
    throw err;
  }
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be a JSON object`);
  }
  const m = parsed as Record<string, unknown>;
  if (m.displayName === undefined || m.icon === undefined) return null;
  const { name, displayName, description, icon, badge } = m;
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error(`${path}: name must match ${NAME_RE}`);
  if (typeof displayName !== "string" || !displayName) throw new Error(`${path}: displayName must be a non-empty string`);
  if (typeof icon !== "string" || !icon) throw new Error(`${path}: icon must be a non-empty string`);
  if (description !== undefined && typeof description !== "string") throw new Error(`${path}: description must be a string`);
  if (badge !== undefined && (typeof badge !== "string" || !badge.startsWith("/") || badge.startsWith("//"))) {
    throw new Error(`${path}: badge must be a path on the app's own origin, like /api/badge`);
  }
  if (!isSvgIcon(join(dir, ...iconSegments(icon)))) {
    throw new Error(`${path}: icon ${icon} is missing, over 64 KB, or not an svg`);
  }
  return {
    name,
    displayName,
    ...(description !== undefined ? { description } : {}),
    icon,
    ...(badge !== undefined ? { badge } : {}),
  };
}

export function serializeIdentity(id: AppIdentity): string {
  const out: Record<string, string> = { name: id.name, displayName: id.displayName };
  if (id.description !== undefined) out.description = id.description;
  out.icon = id.icon;
  if (id.badge !== undefined) out.badge = id.badge;
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function writeIdentity(id: AppIdentity, iconSource: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, IDENTITY_MANIFEST), serializeIdentity(id));
  const dest = join(outDir, ...iconSegments(id.icon));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(iconSource, dest);
}

/** Writes appDir's identity to outDir in the staged form, or returns null (outDir removed) when it declares none. */
export function stageIdentity(appDir: string, outDir: string, expectedName?: string): AppIdentity | null {
  rmSync(outDir, { recursive: true, force: true });
  const id = readDeclaredIdentity(appDir);
  if (!id) return null;
  if (expectedName !== undefined && id.name !== expectedName) {
    throw new Error(`${appDir}: manifest name ${id.name} does not match ${expectedName}`);
  }
  writeIdentity(id, join(appDir, ...iconSegments(id.icon)), outDir);
  return id;
}
