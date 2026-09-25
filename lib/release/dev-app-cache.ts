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

export const IDENTITY_KEYS = { tree: "MSBuildTree", sha: "MSBuildSha", diffHash: "MSBuildDiffHash" } as const;
const STAMP_KEY = "MSBuildStamp";

export interface BuildIdentity {
  tree: string;
  sha: string;
  diffHash: string;
}

export interface CacheSeams {
  pathExists(path: string): boolean;
  /** Directory entry names, or [] when the directory is missing. */
  listDir(path: string): string[];
  /** File bytes, or null for anything that is not a readable file. */
  readBytes(path: string): Uint8Array | null;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * The one key function for both stamping and lookup. Ignored files are left
 * out because the build's scratch copy skips them too.
 */
export async function treeIdentity(seams: CacheSeams, source: string): Promise<BuildIdentity | null> {
  const head = await seams.exec(["git", "rev-parse", "HEAD"], { cwd: source });
  const sha = head.stdout.trim();
  if (head.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) return null;
  const diff = await seams.exec(["git", "diff", "HEAD", "--binary", "--no-color", "--no-ext-diff", "--no-textconv"], {
    cwd: source,
  });
  if (diff.exitCode !== 0) return null;
  const others = await seams.exec(["git", "ls-files", "--others", "--exclude-standard", "-z"], { cwd: source });
  if (others.exitCode !== 0) return null;
  const untracked = others.stdout.split("\0").filter(Boolean).sort();
  if (diff.stdout === "" && untracked.length === 0) return { tree: source, sha, diffHash: CLEAN_DIFF_HASH };

  const h = createHash("sha256");
  h.update(diff.stdout);
  h.update("\0");
  for (const path of untracked) {
    const bytes = seams.readBytes(`${source}/${path}`);
    h.update(`${path}\0${bytes ? sha256(bytes) : "unreadable"}\n`);
  }
  return { tree: source, sha, diffHash: h.digest("hex") };
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
  if (!tree || !sha || !diffHash) return null;
  return { tree, sha, diffHash, stamp: await plistString(seams, plist, STAMP_KEY) };
}

export function sameBuild(a: BuildIdentity, b: BuildIdentity): boolean {
  return a.tree === b.tree && a.sha === b.sha && a.diffHash === b.diffHash;
}

/** Dot entries are the handoff's in-flight moves, never a finished bundle. */
export async function findCachedBuild(
  seams: CacheSeams,
  buildsDir: string,
  want: BuildIdentity,
): Promise<{ bundle: string; stamp: string | null } | null> {
  for (const name of seams.listDir(buildsDir)) {
    if (name.startsWith(".")) continue;
    const bundle = `${buildsDir}/${name}/mattstack-dev.app`;
    const id = await readBundleIdentity(seams, bundle);
    if (id && sameBuild(id, want)) return { bundle, stamp: id.stamp };
  }
  return null;
}
