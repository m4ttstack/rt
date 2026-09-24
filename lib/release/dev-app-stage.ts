/**
 * Builds a repo-tools working tree (uncommitted changes included) into a
 * dev app bundle and stages it for the running mattstack-dev to pick up: the
 * tray watches the staging dir, compares the staged bundle's MSBuildStamp
 * with its own, and offers "New build · Restart".
 */
import { UserActionableError } from "../setup/errors.ts";
import type { RunResult } from "../subprocess.ts";

export interface StageSeams {
  home: string;
  now(): Date;
  /** A fresh, empty directory for the working-tree copy. */
  scratchDir(): string;
  pathExists(path: string): boolean;
  writeFile(path: string, content: string): void;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
}

export function devAppStagePaths(home: string) {
  const root = `${home}/.mattstack/rt/dev-app`;
  return { root, stagedDir: `${root}/staged`, lastSourceFile: `${root}/last-source` };
}

/** build.sh prints its own ✗ lines on stdout, so both streams are kept. */
function tail(r: RunResult): string {
  return `${r.stdout}\n${r.stderr}`.trim().split("\n").filter(Boolean).slice(-8).join("\n");
}

function stampTime(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export async function stageLocalDevApp(seams: StageSeams, cwd: string): Promise<{ stamp: string; stagedPath: string }> {
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

  const scratch = seams.scratchDir();
  const copy = await seams.exec(["rsync", "-a", "--exclude=.git", "--filter=:- .gitignore", `${source}/`, `${scratch}/`]);
  if (copy.exitCode !== 0) throw new UserActionableError("dev-app-copy-failed", `copying ${source} failed: ${tail(copy)}`);

  // rt-tray/deps is gitignored, so the copy skips it; reuse the tree's own when it has one.
  const deps = `${source}/rt-tray/deps`;
  const depsStep: [string, ...string[]] = seams.pathExists(deps)
    ? ["cp", "-R", deps, `${scratch}/rt-tray/deps`]
    : ["scripts/fetch-deps.sh", "arm64"];
  const depsRun = await seams.exec(depsStep, { cwd: scratch });
  if (depsRun.exitCode !== 0) throw new UserActionableError("dev-app-deps-failed", `${depsStep.join(" ")} failed: ${tail(depsRun)}`);

  const build = await seams.exec(["env", `MS_BUILD_STAMP=${stamp}`, `RT_VERSION=${version}`, "rt-tray/build.sh", "dev"], {
    cwd: scratch,
    timeoutMs: 1_800_000,
  });
  if (build.exitCode !== 0) throw new UserActionableError("dev-app-build-failed", `build.sh dev failed: ${tail(build)}`);

  // The tray watches the staging root, and a restart handoff may be moving
  // the staged bundle at any moment: the staged dir only ever changes by
  // whole-dir renames (the old one retired aside before it is deleted), so a
  // reader sees a complete bundle or none.
  const paths = devAppStagePaths(seams.home);
  const tag = Date.now();
  const incoming = `${paths.root}/.incoming-${tag}`;
  const retired = `${paths.root}/.retired-${tag}`;
  for (const step of [
    ["mkdir", "-p", incoming],
    ["ditto", `${scratch}/rt-tray/mattstack-dev.app`, `${incoming}/mattstack-dev.app`],
  ] as [string, ...string[]][]) {
    const r = await seams.exec(step);
    if (r.exitCode !== 0) {
      await seams.exec(["rm", "-rf", incoming]);
      throw new UserActionableError("dev-app-stage-failed", `${step.join(" ")} failed: ${tail(r)}`);
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
  seams.writeFile(paths.lastSourceFile, source);
  return { stamp, stagedPath: `${paths.stagedDir}/mattstack-dev.app` };
}
