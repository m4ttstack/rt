import { createGitClient, type UndoResult } from "../../packages/git-core/src/index.ts";
import { amendStaged } from "../../lib/commit-ops.ts";
import { checkBranchGuard } from "../../lib/branch-guard.ts";
import { createStackGuardRunners } from "../../lib/stack-guard.ts";
import { getRemoteDefaultBranch } from "../../lib/git-ops.ts";
import { flagValue } from "../../lib/cli-args.ts";
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

export async function stashPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const message = flagValue(args, "--message") ?? undefined;
  const includeUntracked = args.includes("--include-untracked");
  try {
    const { created } = await createGitClient(process.cwd()).stashPush({
      ...(message ? { message } : {}),
      ...(includeUntracked ? { includeUntracked: true } : {}),
    });
    if (json) console.log(JSON.stringify({ ok: true, created }));
    else console.log(created ? "stashed" : "nothing to stash");
  } catch (err) {
    failPlain(json, "git stash push", err instanceof Error ? err.message : String(err));
  }
}

export async function stashListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  try {
    const stashes = await createGitClient(process.cwd()).stashes();
    if (json) console.log(JSON.stringify({ ok: true, stashes }));
    else if (stashes.length === 0) console.log("no stashes");
    else for (const s of stashes) console.log(`stash@{${s.index}}  ${s.branch ?? "(detached)"}  ${s.message}`);
  } catch (err) {
    failPlain(json, "git stash list", err instanceof Error ? err.message : String(err));
  }
}

function stashIndexArg(args: string[], json: boolean, usage: string): number {
  const raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) failPlain(json, "git stash", usage);
  return n;
}

export async function stashPopCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash pop [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashPop(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`popped stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash pop", err instanceof Error ? err.message : String(err));
  }
}

export async function stashApplyCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash apply [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashApply(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`applied stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash apply", err instanceof Error ? err.message : String(err));
  }
}

const STASH_DROP_USAGE = "usage: rt git stash drop <index> [--json]";

export async function stashDropCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const client = createGitClient(process.cwd());
  let raw = args.find((a) => !a.startsWith("-"));
  try {
    if (raw === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
      const stashes = await client.stashes();
      if (stashes.length === 0) failPlain(json, "git stash drop", STASH_DROP_USAGE);
      const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Drop which stash?",
        options: stashes.map((s) => ({ label: `stash@{${s.index}}: ${s.message}`, value: String(s.index) })),
      });
      if (picked === null) process.exit(0);
      raw = picked;
    }
    if (raw === undefined) failPlain(json, "git stash drop", STASH_DROP_USAGE);
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) failPlain(json, "git stash drop", STASH_DROP_USAGE);
    await client.stashDrop(index);
    if (json) console.log(JSON.stringify({ ok: true, index }));
    else console.log(`dropped stash@{${index}}`);
  } catch (err) {
    failPlain(json, "git stash drop", err instanceof Error ? err.message : String(err));
  }
}
