/**
 * Build identity for dev app bundles: which tree, commit and uncommitted
 * state a bundle was built from. `stageLocalDevApp` bakes it into Info.plist
 * (via build.sh) and looks it up again to reuse a cached bundle instead of
 * rebuilding. The tray's restart handoff files the outgoing app under
 * `builds/` keyed by the same Info.plist values.
 */
import { createHash } from "crypto";
import type { RunResult } from "../subprocess.ts";

export const CLEAN_DIFF_HASH = "clean";

/**
 * A cached bundle's folder inside its entry. No `.app` extension, so
 * LaunchServices never registers a cached copy under the dev bundle id; it
 * only becomes `mattstack-dev.app` again when copied into staging. Must match
 * `DevBuild.cachedBundleName` in the tray.
 */
export const CACHED_BUNDLE_NAME = "bundle";

export const IDENTITY_KEYS = {
  tree: "MSBuildTree",
  sha: "MSBuildSha",
  diffHash: "MSBuildDiffHash",
  version: "MSBuildVersion",
} as const;
const STAMP_KEY = "MSBuildStamp";

export interface BuildIdentity {
  tree: string;
  sha: string;
  diffHash: string;
  /** The RT_VERSION the build is stamped with, so tagging HEAD invalidates it. */
  version: string;
}

export interface CacheSeams {
  pathExists(path: string): boolean;
  /** Directory entry names, or [] when the directory is missing. */
  listDir(path: string): string[];
  /** File bytes, or null for anything that is not a readable file. */
  readBytes(path: string): Uint8Array | null;
  /** A symlink's target, or null when the path is not a symlink. */
  readLink(path: string): string | null;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export interface TreeSnapshot {
  /** Paths relative to the tree: what the build's scratch copy receives. */
  files: string[];
  identity: BuildIdentity | null;
  /** Why a listed tree still has no identity, when that is the reason. */
  uncacheable: string | null;
}

const listing = (stdout: string) => stdout.split("\0").filter(Boolean);

/**
 * The one listing for both the key and the copy: the key hashes the tracked
 * diff plus exactly the untracked files the copy receives, so a file the copy
 * skips (any git exclude) can never change the key, and vice versa.
 */
export async function snapshotTree(seams: CacheSeams, source: string, version: string): Promise<TreeSnapshot | null> {
  const run = (args: string[]) => seams.exec(["git", ...args], { cwd: source });
  const [tracked, deleted, others] = await Promise.all([
    run(["ls-files", "-z", "--cached"]),
    run(["ls-files", "-z", "--deleted"]),
    run(["ls-files", "-z", "--others", "--exclude-standard"]),
  ]);
  if (tracked.exitCode !== 0 || deleted.exitCode !== 0 || others.exitCode !== 0) return null;
  const gone = new Set(listing(deleted.stdout));
  const untracked = listing(others.stdout).sort();
  const files = [...new Set([...listing(tracked.stdout).filter((p) => !gone.has(p)), ...untracked])].sort();

  // git lists an untracked nested repo as one `dir/` entry and the copy
  // recurses into it; hashing its contents is not worth it for a dev build.
  const nested = untracked.filter((p) => p.endsWith("/"));
  if (nested.length > 0) {
    return { files, identity: null, uncacheable: `untracked nested repo ${nested.join(", ")}` };
  }
  return { files, identity: await identityOf(seams, source, version, untracked), uncacheable: null };
}

export async function treeIdentity(seams: CacheSeams, source: string, version: string): Promise<BuildIdentity | null> {
  return (await snapshotTree(seams, source, version))?.identity ?? null;
}

async function identityOf(
  seams: CacheSeams,
  source: string,
  version: string,
  untracked: string[],
): Promise<BuildIdentity | null> {
  const head = await seams.exec(["git", "rev-parse", "HEAD"], { cwd: source });
  const sha = head.stdout.trim();
  if (head.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) return null;
  const diff = await seams.exec(["git", "diff", "HEAD", "--binary", "--no-color", "--no-ext-diff", "--no-textconv"], {
    cwd: source,
  });
  if (diff.exitCode !== 0) return null;
  if (diff.stdout === "" && untracked.length === 0) return { tree: source, sha, diffHash: CLEAN_DIFF_HASH, version };

  const h = createHash("sha256");
  h.update(diff.stdout);
  h.update("\0");
  for (const path of untracked) {
    const full = `${source}/${path}`;
    // The copy carries a symlink as a link, so its target is its content.
    const link = seams.readLink(full);
    const bytes = link === null ? seams.readBytes(full) : null;
    const content = link !== null ? `link:${link}` : bytes ? sha256(bytes) : "unreadable";
    h.update(`${path}\0${content}\n`);
  }
  return { tree: source, sha, diffHash: h.digest("hex"), version };
}

async function plistString(seams: CacheSeams, plist: string, key: string): Promise<string | null> {
  const r = await seams.exec(["plutil", "-extract", key, "raw", "-o", "-", plist]);
  const value = r.stdout.trim();
  return r.exitCode === 0 && value !== "" ? value : null;
}

export async function readBundleIdentity(
  seams: CacheSeams,
  bundle: string,
): Promise<(BuildIdentity & { stamp: string | null }) | null> {
  const plist = `${bundle}/Contents/Info.plist`;
  if (!seams.pathExists(plist)) return null;
  const tree = await plistString(seams, plist, IDENTITY_KEYS.tree);
  const sha = tree && (await plistString(seams, plist, IDENTITY_KEYS.sha));
  const diffHash = sha && (await plistString(seams, plist, IDENTITY_KEYS.diffHash));
  const version = diffHash && (await plistString(seams, plist, IDENTITY_KEYS.version));
  if (!tree || !sha || !diffHash || !version) return null;
  return { tree, sha, diffHash, version, stamp: await plistString(seams, plist, STAMP_KEY) };
}

export function sameBuild(a: BuildIdentity, b: BuildIdentity): boolean {
  return a.tree === b.tree && a.sha === b.sha && a.diffHash === b.diffHash && a.version === b.version;
}

/** Dot entries are the handoff's in-flight moves, never a finished bundle. */
export async function findCachedBuild(
  seams: CacheSeams,
  buildsDir: string,
  want: BuildIdentity,
): Promise<{ bundle: string; stamp: string | null } | null> {
  for (const name of seams.listDir(buildsDir)) {
    if (name.startsWith(".")) continue;
    const bundle = `${buildsDir}/${name}/${CACHED_BUNDLE_NAME}`;
    const id = await readBundleIdentity(seams, bundle);
    if (id && sameBuild(id, want)) return { bundle, stamp: id.stamp };
  }
  return null;
}
