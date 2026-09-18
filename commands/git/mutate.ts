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
  const includeUntracked = args.includes("--include-untracked");
  let created: boolean;
  try {
    const message = flagValue(args, "--message") ?? undefined;
    ({ created } = await createGitClient(process.cwd()).stashPush({
      ...(message ? { message } : {}),
      ...(includeUntracked ? { includeUntracked: true } : {}),
    }));
  } catch (err) {
    failPlain(json, "git stash push", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, created }));
  else console.log(created ? "stashed" : "nothing to stash");
}

export async function stashListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let stashes: any[];
  try {
    stashes = await createGitClient(process.cwd()).stashes();
  } catch (err) {
    failPlain(json, "git stash list", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, stashes }));
  else if (stashes.length === 0) console.log("no stashes");
  else for (const s of stashes) console.log(`stash@{${s.index}}  ${s.branch ?? "(detached)"}  ${s.message}`);
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
  } catch (err) {
    failPlain(json, "git stash pop", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, index }));
  else console.log(`popped stash@{${index}}`);
}

export async function stashApplyCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const index = stashIndexArg(args, json, "usage: rt git stash apply [<index>] [--json]");
  try {
    await createGitClient(process.cwd()).stashApply(index);
  } catch (err) {
    failPlain(json, "git stash apply", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, index }));
  else console.log(`applied stash@{${index}}`);
}

const STASH_DROP_USAGE = "usage: rt git stash drop <index> [--json]";

export async function stashDropCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const client = createGitClient(process.cwd());
  let raw = args.find((a) => !a.startsWith("-"));
  if (raw === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    let stashes: any[];
    try {
      stashes = await client.stashes();
    } catch (err) {
      failPlain(json, "git stash drop", err instanceof Error ? err.message : String(err));
    }
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
  try {
    await client.stashDrop(index);
  } catch (err) {
    failPlain(json, "git stash drop", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, index }));
  else console.log(`dropped stash@{${index}}`);
}

function firstPositional(args: string[], valueFlags: Set<string>): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    return a;
  }
  return undefined;
}

export async function tagListCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let tags: any[];
  try {
    tags = await createGitClient(process.cwd()).tags();
  } catch (err) {
    failPlain(json, "git tag list", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, tags }));
  else if (tags.length === 0) console.log("no tags");
  else for (const t of tags) console.log(`${t.name}  ${t.targetSha.slice(0, 8)}${t.annotated ? "  (annotated)" : ""}`);
}

const TAG_CREATE_USAGE = "usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]";

export async function tagCreateCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const push = args.includes("--push");
  const name = firstPositional(args, new Set(["--message", "--at"]));
  if (!name) failPlain(json, "git tag create", TAG_CREATE_USAGE);
  let pushed: boolean;
  try {
    const message = flagValue(args, "--message") ?? undefined;
    const at = flagValue(args, "--at") ?? undefined;
    const client = createGitClient(process.cwd());
    await client.createTag(name, { ...(message ? { message } : {}), ...(at ? { sha: at } : {}) });
    if (push) await client.pushTag(name);
    pushed = push;
  } catch (err) {
    failPlain(json, "git tag create", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, name, pushed }));
  else console.log(`created tag ${name}${pushed ? " and pushed to origin" : ""}`);
}

async function pickTagName(json: boolean, usage: string, verb: string): Promise<string> {
  const client = createGitClient(process.cwd());
  let tags: any[];
  try {
    tags = await client.tags();
  } catch (err) {
    failPlain(json, verb, err instanceof Error ? err.message : String(err));
  }
  if (tags.length === 0) failPlain(json, verb, usage);
  const { filterableSelect } = await import("../../lib/pick-wrappers.ts");
  const picked = await filterableSelect({
    message: `${verb.replace("git tag ", "").replace(/^./, (c) => c.toUpperCase())} which tag?`,
    options: tags.map((t) => ({ label: t.name, value: t.name, hint: t.targetSha.slice(0, 8) })),
  });
  if (picked === null) process.exit(0);
  return picked;
}

const TAG_DELETE_USAGE = "usage: rt git tag delete <name> [--json]";

export async function tagDeleteCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set<string>());
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_DELETE_USAGE, "git tag delete");
  }
  if (!name) failPlain(json, "git tag delete", TAG_DELETE_USAGE);
  try {
    await createGitClient(process.cwd()).deleteTag(name);
  } catch (err) {
    failPlain(json, "git tag delete", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, name }));
  else console.log(`deleted tag ${name} (local only)`);
}

const TAG_PUSH_USAGE = "usage: rt git tag push <name> [--remote <remote>] [--json]";

export async function tagPushCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  let name = firstPositional(args, new Set(["--remote"]));
  if (name === undefined && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    name = await pickTagName(json, TAG_PUSH_USAGE, "git tag push");
  }
  if (!name) failPlain(json, "git tag push", TAG_PUSH_USAGE);
  let remote: string;
  try {
    remote = flagValue(args, "--remote") ?? "origin";
    await createGitClient(process.cwd()).pushTag(name, remote);
  } catch (err) {
    failPlain(json, "git tag push", err instanceof Error ? err.message : String(err));
  }
  if (json) console.log(JSON.stringify({ ok: true, name, remote }));
  else console.log(`pushed tag ${name} to ${remote}`);
}
