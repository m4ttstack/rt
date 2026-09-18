import { createGitClient, type UndoResult } from "../../packages/git-core/src/index.ts";
import { amendStaged } from "../../lib/commit-ops.ts";
import { checkBranchGuard } from "../../lib/branch-guard.ts";
import { createStackGuardRunners } from "../../lib/stack-guard.ts";
import { getRemoteDefaultBranch } from "../../lib/git-ops.ts";
import { execFileSync } from "node:child_process";

export function failPlain(json: boolean, verb: string, message: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`rt ${verb}: ${message}`);
  process.exit(1);
}

// Zero-commit repos have no HEAD for rev-parse to resolve; that's the
// mutation's own error to raise (git's real message), not the guard's.
function currentBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function guardHistoryRewrite(cwd: string, json: boolean, verb: string): Promise<void> {
  const branch = currentBranch(cwd);
  if (branch === null) {
    console.error(`rt ${verb}: warning, could not determine the current branch; skipping the ownership guard`);
    return;
  }
  const remoteDefault = getRemoteDefaultBranch(cwd);
  const defaultBranch = remoteDefault ? remoteDefault.replace("origin/", "") : null;
  const runners = createStackGuardRunners(
    (await import("../../lib/setup/probes.ts")).createRealProbes(),
  );
  const verdict = await checkBranchGuard({ cwd, branch, defaultBranch, runners });
  if (verdict.verdict === "refuse") failPlain(json, verb, `refused: ${verdict.detail}`);
  if (verdict.verdict === "unverified") {
    console.error(`rt ${verb}: warning, could not verify branch ownership (${verdict.detail})`);
  }
}

export async function amendCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const noVerify = args.includes("--no-verify");
  const message = args.filter((a) => !a.startsWith("-")).join(" ") || undefined;
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json, "git amend");
  let summary: string;
  try {
    summary = amendStaged(cwd, { ...(message ? { message } : {}), noVerify });
  } catch (err) {
    failPlain(json, "git amend", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, summary }));
  else console.log(summary);
}

export async function undoCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const cwd = process.cwd();
  await guardHistoryRewrite(cwd, json, "git undo");
  let result: UndoResult;
  try {
    result = await createGitClient(cwd).undoLastCommit();
  } catch (err) {
    failPlain(json, "git undo", err instanceof Error ? err.message : String(err));
  }
  if (!result.ok) failPlain(json, "git undo", `refused: ${result.reason}`);
  if (json) console.log(JSON.stringify({ ok: true, undoneSha: result.undoneSha }));
  else console.log(`undid ${result.undoneSha.slice(0, 8)}; its changes are back in the working tree`);
}
