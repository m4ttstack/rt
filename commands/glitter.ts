/**
 * rt glitter: repos, changes, diff, and commit in one board. The command is
 * the gate and the wiring; the loop and state machine live in
 * lib/mission/driver.ts and the view paints in the bundled Go rt-ui helper.
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { MissionDriver, type MissionDeps } from "../lib/mission/driver.ts";
import { runAction } from "../lib/mission/git-actions.ts";
import { interactive } from "../lib/ui/gate.ts";
import { exit, openSession } from "../lib/ui/spawn.ts";
import { SessionDied } from "../lib/runner/runner.ts";
import { createGitClient } from "../packages/git-core/src/index.ts";
import { daemonQuery, subscribeToDaemon } from "../lib/daemon-client.ts";
import { checkBranchGuard } from "../lib/branch-guard.ts";
import { commitStaged, amendStaged, stagePath, unstagePath } from "../lib/commit-ops.ts";
import { getRemoteDefaultBranch } from "../lib/git-ops.ts";

export async function glitterCommand(_args: string[], ctx: CommandContext): Promise<void> {
  if (!interactive()) {
    process.stderr.write("rt glitter needs an interactive terminal (it drives a live board from the one you are in)\n");
    return exit(1);
  }

  if (!ctx.identity) {
    process.stderr.write("not in a registered repo\n");
    return exit(1);
  }
  const currentRepo = ctx.identity;
  const currentWorktree = currentRepo.repoRoot;

  const deps: MissionDeps = {
    openSession,
    client: (dir: string) => createGitClient(dir),
    daemonQuery,
    subscribe: subscribeToDaemon,
    runAction,
    commit: commitStaged,
    amend: amendStaged,
    guard: checkBranchGuard,
    now: () => new Date(),
    stageFile: stagePath,
    unstageFile: unstagePath,
    resolveDefaultBranch: getRemoteDefaultBranch,
  };

  const driver = new MissionDriver(deps, {
    repo: currentRepo.identity,
    worktree: currentWorktree,
  });

  const onSignal = () => {
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("SIGHUP", onSignal);

  try {
    await driver.run();
  } catch (err) {
    if (err instanceof SessionDied) {
      process.stderr.write(`\n  ${err.message}; the workspace was closed\n\n`);
      return exit(1);
    }
    throw err;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
  }
}
