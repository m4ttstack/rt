// An app's launcher identity (name, icon, badge) as the mattstack.app bundle
// ships it at Contents/Resources/apps/<name>/: staged into each app tarball by
// build-apps.ts, materialized by fetch-deps, landed by build.sh, asserted by
// check-bundle.sh. Every caller reaches it as a bare bun invocation (a direct
// import from build-apps.ts, or a CLI call from build.sh/check-bundle.sh), so
// every runtime import stays in node builtins.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, resolve, sep } from "path";
import type { DepsLockTool } from "../../lib/bundle-layout.ts";

export const IDENTITY_MANIFEST = "mattstack.deck.json";

// Parity anchor: m4ttstack/apps apps/deck/src/registry/manifest.ts
// (MAX_ICON_BYTES, SVG_ROOT) and deck-manifest.ts (NAME_RE, the badge rule).
// Deck silently drops an identity it refuses, so these rules move with deck's.
const MAX_ICON_BYTES = 64 * 1024;
const SVG_ROOT = /^\s*(?:<\?xml\b[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\b[^>]*>\s*)*<svg[\s>]/i;
const NAME_RE = /^[a-z0-9][a-z0-9.-]*$/;
const IDENTITY_KEYS = new Set(["name", "displayName", "description", "icon", "badge"]);

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

/**
 * The icon's path under dir, refused unless it is a regular svg file deck
 * would serve. A symlink is refused outright: copied as a link it would ship
 * pointing at the build runner's filesystem.
 */
export function iconFile(dir: string, icon: string): string {
  const path = join(dir, ...iconSegments(icon));
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new Error(`icon ${icon} is missing`);
  }
  if (st.isSymbolicLink()) throw new Error(`icon ${icon} is a symbolic link; commit the svg itself`);
  if (!st.isFile()) throw new Error(`icon ${icon} is not a file`);
  if (!realpathSync(path).startsWith(realpathSync(dir) + sep)) throw new Error(`icon ${icon} resolves outside ${dir}`);
  if (st.size > MAX_ICON_BYTES) throw new Error(`icon ${icon} is ${st.size} bytes, over 64 KB`);
  if (!SVG_ROOT.test(readFileSync(path, "utf8"))) throw new Error(`icon ${icon} is not an svg`);
  return path;
}

function readManifestObject(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function readDeclaredIdentity(dir: string): AppIdentity | null {
  const path = join(dir, IDENTITY_MANIFEST);
  if (!existsSync(path)) throw new Error(`no ${IDENTITY_MANIFEST} in ${dir}`);
  const m = readManifestObject(path);
  if (m.displayName === undefined || m.icon === undefined) return null;
  const { name, displayName, description, icon, badge } = m;
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error(`${path}: name must match ${NAME_RE}`);
  // Stricter than deck: Resources/apps/<name> with a dot reads to codesign as
  // a nested bundle, and that would only surface at the outer seal.
  if (name.includes(".")) throw new Error(`${path}: name ${name} contains a dot; it cannot ship an identity dir`);
  if (typeof displayName !== "string" || !displayName) throw new Error(`${path}: displayName must be a non-empty string`);
  if (typeof icon !== "string" || !icon) throw new Error(`${path}: icon must be a non-empty string`);
  if (description !== undefined && typeof description !== "string") throw new Error(`${path}: description must be a string`);
  if (badge !== undefined && (typeof badge !== "string" || !badge.startsWith("/") || badge.startsWith("//"))) {
    throw new Error(`${path}: badge must be a path on the app's own origin, like /api/badge`);
  }
  try {
    iconFile(dir, icon);
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
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
  copyFileSync(iconSource, dest);
}

/**
 * Refuses an out dir holding anything beyond a staged identity (its manifest
 * and the icon that manifest names), so a swapped or mistyped path cannot
 * delete a source tree.
 */
function assertReplaceableStage(outDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(outDir, { recursive: true, encoding: "utf8" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const files = entries.filter((e) => !lstatSync(join(outDir, e)).isDirectory());
  if (files.length === 0) return;
  const allowed = new Set([IDENTITY_MANIFEST]);
  try {
    const m = readManifestObject(join(outDir, IDENTITY_MANIFEST));
    if (Object.keys(m).every((k) => IDENTITY_KEYS.has(k)) && typeof m.icon === "string") {
      allowed.add(iconSegments(m.icon).join("/"));
    }
  } catch {
    allowed.clear();
  }
  if (!files.every((f) => allowed.has(f))) {
    throw new Error(`refusing to replace ${outDir}: it holds more than a staged identity`);
  }
}

/** Writes appDir's identity to outDir in the staged form, or returns null (outDir removed) when it declares none. */
export function stageIdentity(appDir: string, outDir: string, expectedName?: string): AppIdentity | null {
  assertReplaceableStage(outDir);
  const id = readDeclaredIdentity(appDir);
  if (id && expectedName !== undefined && id.name !== expectedName) {
    throw new Error(`${appDir}: manifest name ${id.name} does not match ${expectedName}`);
  }
  rmSync(outDir, { recursive: true, force: true });
  if (!id) return null;
  writeIdentity(id, join(appDir, ...iconSegments(id.icon)), outDir);
  return id;
}

/** Whether deps.lock gives `name` a serve block, whatever its status. */
export function lockServes(lockText: string, name: string): boolean {
  const lock = JSON.parse(lockText) as { tools?: unknown };
  if (!Array.isArray(lock.tools)) throw new Error("deps.lock has no tools array");
  return lock.tools.some(
    (t) => typeof t === "object" && t !== null && (t as Record<string, unknown>).name === name && (t as Record<string, unknown>).serve !== undefined,
  );
}

function readNamedIdentity(dir: string, name: string): AppIdentity {
  const id = readDeclaredIdentity(dir);
  if (!id) throw new Error(`${dir}: ${IDENTITY_MANIFEST} declares no displayName and icon`);
  if (id.name !== name) throw new Error(`${dir}: identity names ${id.name}, not ${name}`);
  return id;
}

/** A dir that holds `name`'s identity in exactly the form stageIdentity writes. */
export function readStagedIdentity(dir: string, name: string): AppIdentity {
  const id = readNamedIdentity(dir, name);
  if (readFileSync(join(dir, IDENTITY_MANIFEST), "utf8") !== serializeIdentity(id)) {
    throw new Error(`${dir}: ${IDENTITY_MANIFEST} is not in the staged identity form`);
  }
  return id;
}

// Same rule as servedAppCatalog in lib/bundle-layout.ts, which this module
// cannot import at runtime.
function servedNames(tools: readonly DepsLockTool[]): string[] {
  return tools
    .filter((t) => t.kind === "helper" && t.status === "bundled" && t.serve !== undefined)
    .map((t) => t.name);
}

export function landIdentities(
  tools: readonly DepsLockTool[],
  depsDir: string,
  resourcesDir: string,
): { landed: string[]; missing: string[] } {
  const appsDir = join(resourcesDir, "apps");
  rmSync(appsDir, { recursive: true, force: true });
  const landed: string[] = [];
  const missing: string[] = [];
  for (const name of servedNames(tools)) {
    const src = join(depsDir, `${name}-identity`);
    if (!existsSync(src)) {
      missing.push(name);
      continue;
    }
    // Validated by meaning, not bytes: land re-serializes, so an archive
    // staged by an older serializer still lands in today's form.
    const id = readNamedIdentity(src, name);
    writeIdentity(id, join(src, ...iconSegments(id.icon)), join(appsDir, name));
    landed.push(name);
  }
  return { landed, missing };
}

export function checkIdentities(
  tools: readonly DepsLockTool[],
  resourcesDir: string,
): { served: string[]; problems: string[] } {
  const served = servedNames(tools);
  const appsDir = join(resourcesDir, "apps");
  const problems: string[] = [];
  for (const entry of existsSync(appsDir) ? readdirSync(appsDir) : []) {
    if (!served.includes(entry)) problems.push(`Resources/apps/${entry} is not a served app in deps.lock`);
  }
  for (const name of served) {
    if (!existsSync(join(appsDir, name))) {
      problems.push(
        `${name}: served but ships no identity (its pinned archive predates identity, or its manifest declares no displayName and icon); declare both, bump ${name}'s version and re-run scripts/build-apps.ts for ${name}`,
      );
      continue;
    }
    try {
      readStagedIdentity(join(appsDir, name), name);
    } catch (err) {
      problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { served, problems };
}

if (import.meta.main) {
  const { parseDepsLock } = await import("../../lib/bundle-layout.ts");
  const args = process.argv.slice(2);
  const usage = "usage: app-identity.ts land --deps <dir> --resources <dir> [--lock <path>] | check --resources <dir> [--lock <path>]";
  const opt = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`${flag} needs a value\n${usage}`);
      process.exit(2);
    }
    return value;
  };
  const mode = args[0];
  const resources = opt("--resources");
  const deps = opt("--deps");
  const lockPath = opt("--lock") ?? join(import.meta.dir, "..", "..", "rt-tray", "deps.lock");
  if ((mode !== "land" && mode !== "check") || !resources || (mode === "land" && !deps)) {
    console.error(usage);
    process.exit(2);
  }
  // land replaces <resources>/apps wholesale, so it only ever targets a bundle.
  if (mode === "land" && !/\.app\/Contents\/Resources$/.test(resolve(resources))) {
    console.error(`--resources ${resources} is not an .app/Contents/Resources dir; land replaces its apps/ dir`);
    process.exit(2);
  }
  const lockTools = parseDepsLock(readFileSync(lockPath, "utf8")).tools;
  if (mode === "land") {
    const { landed, missing } = landIdentities(lockTools, deps!, resources);
    for (const name of landed) console.log(`  ✓ Resources/apps/${name}`);
    for (const name of missing) console.log(`  ⚠ ${name}: served, but its archive carries no identity (check-bundle will fail)`);
  } else {
    const { served, problems } = checkIdentities(lockTools, resources);
    if (problems.length > 0) {
      console.log(problems.join("\n"));
      process.exit(1);
    }
    console.log(served.length > 0 ? `identity for ${served.join(", ")}` : "no served apps");
  }
}
