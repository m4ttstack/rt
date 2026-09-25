/**
 * Builds a repo-tools working tree (uncommitted changes included) into a
 * dev app bundle and stages it for the running mattstack-dev to pick up: the
 * tray watches the staging dir, compares the staged bundle's MSBuildStamp
 * with its own, and offers "New build · Restart".
 */
import { UserActionableError } from "../setup/errors.ts";
import type { RunResult } from "../subprocess.ts";
import { findCachedBuild, readBundleIdentity, sameBuild, treeIdentity, type CacheSeams } from "./dev-app-cache.ts";

export interface StageSeams extends CacheSeams {
  home: string;
  /** The installed dev app, read only to tell whether it already is this build. */
  runningApp: string;
  now(): Date;
  /** A fresh, empty directory for the working-tree copy. */
  scratchDir(): string;
  writeFile(path: string, content: string): void;
  /** A progress line for the terminal or the tray's build log. */
  log(line: string): void;
}

class CachedBundleRejected extends Error {}

export type StageResult =
  | { outcome: "built" | "cached"; stamp: string; stagedPath: string }
  | { outcome: "running"; stamp: string; stagedPath: null };

export function devAppStagePaths(home: string) {
  const root = `${home}/.mattstack/rt/dev-app`;
  return { root, stagedDir: `${root}/staged`, lastSourceFile: `${root}/last-source`, buildsDir: `${root}/builds` };
}

/** build.sh prints its own ✗ lines on stdout, so both streams are kept. */
function tail(r: RunResult): string {
  return `${r.stdout}\n${r.stderr}`.trim().split("\n").filter(Boolean).slice(-8).join("\n");
}

function stampTime(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export async function stageLocalDevApp(seams: StageSeams, cwd: string): Promise<StageResult> {
  const top = await seams.exec(["git", "rev-parse", "--show-toplevel"], { cwd });
  if (top.exitCode !== 0) throw new UserActionableError("dev-app-not-a-checkout", `${cwd} is not inside a repo-tools checkout`);
  const source = top.stdout.trim();
  if (!seams.pathExists(`${source}/rt-tray/build.sh`)) {
    throw new UserActionableError("dev-app-not-a-checkout", `${source} is not a repo-tools checkout (no rt-tray/build.sh)`);
  }

  const sha = (await seams.exec(["git", "rev-parse", "--short", "HEAD"], { cwd: source })).stdout.trim();
  const dirty = (await seams.exec(["git", "status", "--porcelain"], { cwd: source })).stdout.trim() !== "";
  const version = (await seams.exec(["git", "describe", "--tags", "--abbrev=0"], { cwd: source })).stdout.trim() || "dev";
  const tree = source.split("/").pop() ?? source;
  const stamp = `${stampTime(seams.now())} ${sha}${dirty ? "+dirty" : ""} ${tree}`;
  const paths = devAppStagePaths(seams.home);

  const identity = await treeIdentity(seams, source, version);
  if (identity) {
    const running = await readBundleIdentity(seams, seams.runningApp);
    if (running && sameBuild(running, identity)) {
      seams.writeFile(paths.lastSourceFile, source);
      return { outcome: "running", stamp: running.stamp ?? stamp, stagedPath: null };
    }
    const cached = await findCachedBuild(seams, paths.buildsDir, identity);
    if (cached) {
      try {
        // The cached bundle is signed with its own Info.plist, so it keeps its
        // original stamp rather than being restamped.
        const stagedPath = await installStaged(seams, paths, async (dest) => {
          let copy = await seams.exec(["cp", "-cR", cached.bundle, dest]);
          if (copy.exitCode !== 0) {
            await seams.exec(["rm", "-rf", dest]);
            copy = await seams.exec(["ditto", cached.bundle, dest]);
          }
          if (copy.exitCode !== 0) return copy;
          const verify = await seams.exec(["codesign", "--verify", "--strict", dest]);
          if (verify.exitCode !== 0) throw new CachedBundleRejected(tail(verify));
          return verify;
        });
        seams.writeFile(paths.lastSourceFile, source);
        return { outcome: "cached", stamp: cached.stamp ?? stamp, stagedPath };
      } catch (err) {
        if (!(err instanceof CachedBundleRejected)) throw err;
        seams.log(`cached build ${cached.bundle} failed its signature check, building instead: ${err.message}`);
      }
    }
  }

  const scratch = seams.scratchDir();
  const copy = await seams.exec(["rsync", "-a", "--exclude=.git", "--filter=:- .gitignore", `${source}/`, `${scratch}/`]);
  if (copy.exitCode !== 0) throw new UserActionableError("dev-app-copy-failed", `copying ${source} failed: ${tail(copy)}`);

  // rt-tray/deps is gitignored, so the copy skips it; reuse the tree's own when
  // it has one, and fetch whatever build.sh needs that it lacks.
  const deps = `${source}/rt-tray/deps`;
  if (seams.pathExists(deps)) {
    const cp = await seams.exec(["cp", "-R", deps, `${scratch}/rt-tray/deps`]);
    if (cp.exitCode !== 0) throw new UserActionableError("dev-app-deps-failed", `copying ${deps} failed: ${tail(cp)}`);
  }
  if (!seams.pathExists(`${scratch}/rt-tray/deps/arm64`) || !seams.pathExists(`${scratch}/rt-tray/deps/tools`)) {
    // fetch-deps.sh is bash-only, and fills deps/tools (Sparkle) as well as deps/arm64.
    const fetchStep: [string, ...string[]] = ["bash", "scripts/fetch-deps.sh", "arm64"];
    const fetched = await seams.exec(fetchStep, { cwd: scratch, timeoutMs: 1_800_000 });
    if (fetched.exitCode !== 0) {
      throw new UserActionableError("dev-app-deps-failed", `${fetchStep.join(" ")} failed: ${tail(fetched)}`);
    }
  }

  const identityEnv = identity
    ? [
        `MS_BUILD_TREE=${identity.tree}`,
        `MS_BUILD_SHA=${identity.sha}`,
        `MS_BUILD_DIFF_HASH=${identity.diffHash}`,
        `MS_BUILD_VERSION=${identity.version}`,
      ]
    : [];
  const build = await seams.exec(
    ["env", `MS_BUILD_STAMP=${stamp}`, ...identityEnv, `RT_VERSION=${version}`, "rt-tray/build.sh", "dev"],
    { cwd: scratch, timeoutMs: 1_800_000 },
  );
  if (build.exitCode !== 0) throw new UserActionableError("dev-app-build-failed", `build.sh dev failed: ${tail(build)}`);

  const stagedPath = await installStaged(seams, paths, (dest) =>
    seams.exec(["ditto", `${scratch}/rt-tray/mattstack-dev.app`, dest]),
  );
  seams.writeFile(paths.lastSourceFile, source);
  return { outcome: "built", stamp, stagedPath };
}

async function installStaged(
  seams: StageSeams,
  paths: ReturnType<typeof devAppStagePaths>,
  copyInto: (dest: string) => Promise<RunResult>,
): Promise<string> {
  // The tray watches the staging root, and a restart handoff may be moving
  // the staged bundle at any moment: the staged dir only ever changes by
  // whole-dir renames (the old one retired aside before it is deleted), so a
  // reader sees a complete bundle or none.
  const tag = Date.now();
  const incoming = `${paths.root}/.incoming-${tag}`;
  const retired = `${paths.root}/.retired-${tag}`;
  const dest = `${incoming}/mattstack-dev.app`;
  for (const [label, step] of [
    [`mkdir -p ${incoming}`, () => seams.exec(["mkdir", "-p", incoming])],
    [`copying the bundle into ${incoming}`, () => copyInto(dest)],
  ] as [string, () => Promise<RunResult>][]) {
    let r: RunResult;
    try {
      r = await step();
    } catch (err) {
      await seams.exec(["rm", "-rf", incoming]);
      throw err;
    }
    if (r.exitCode !== 0) {
      await seams.exec(["rm", "-rf", incoming]);
      throw new UserActionableError("dev-app-stage-failed", `${label} failed: ${tail(r)}`);
    }
  }
  // Missing when nothing was staged yet or a restart already took it. If it
  // survives, the next mv would move the new bundle INTO it.
  await seams.exec(["mv", "-f", paths.stagedDir, retired]);
  if (seams.pathExists(paths.stagedDir)) {
    await seams.exec(["rm", "-rf", incoming]);
    throw new UserActionableError("dev-app-stage-failed", `could not retire the previous staged build at ${paths.stagedDir}`);
  }
  const install = await seams.exec(["mv", incoming, paths.stagedDir]);
  if (install.exitCode !== 0) throw new UserActionableError("dev-app-stage-failed", `staging failed: ${tail(install)}`);
  await seams.exec(["rm", "-rf", retired]);
  return `${paths.stagedDir}/mattstack-dev.app`;
}
