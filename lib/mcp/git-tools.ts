import { existsSync } from "fs";
import { resolve } from "path";
import { execWithTimeout } from "../setup/probes.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { childEnv, runCapture } from "../subprocess.ts";
import { checkOptional, err, ok, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realGitRunner: GitRunner = async (args, cwd) => {
  const r = await runCapture(["git", ...args], { cwd, stderr: "pipe", timeoutMs: 120_000, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" } });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
};

const PROTECTED = new Set(["main", "master"]);
const DETACHED = "refusing to push a detached HEAD";

const HEADS = "refs/heads/";

// The short form prints `heads/<b>` when a tag or other ref shares the name,
// and that string names a different ref in a refspec, so the name is always
// the full ref with its prefix stripped.
async function currentBranch(cwd: string, git: GitRunner): Promise<string | null> {
  const r = await git(["symbolic-ref", "--quiet", "HEAD"], cwd);
  if (r.code !== 0) return null;
  const full = r.stdout.trim();
  if (!full.startsWith(HEADS) || full.length === HEADS.length) return null;
  return full.slice(HEADS.length);
}

/** The remote's default branch: known (its name) or null, meaning unknown,
    which callers must refuse rather than treat as "no default". The prefix
    is stripped with startsWith/slice, never a RegExp built from `remote`,
    since a remote name can carry characters a regex would treat as
    metacharacters (`+`, `(`) or that make the RegExp constructor throw.
    `refs/remotes/<remote>/HEAD` can be missing or stale (a shallow clone, a
    remote added without a fetch), so a miss there falls back to asking the
    remote itself via `ls-remote --symref`. */
async function remoteDefault(cwd: string, git: GitRunner, remote = "origin"): Promise<{ name: string } | null> {
  const prefix = `${remote}/`;
  const sym = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd);
  if (sym.code === 0) {
    const s = sym.stdout.trim();
    if (s.startsWith(prefix)) return { name: s.slice(prefix.length) };
  }
  const ls = await git(["ls-remote", "--symref", remote, "HEAD"], cwd);
  const match = ls.code === 0 ? ls.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m) : null;
  return match ? { name: match[1]! } : null;
}

// git follows a push rejection with several `hint:` lines, which would push
// the `! [rejected]` line out of a plain last-3-lines tail.
function detail(r: { stderr: string; stdout: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).split("\n").filter((l) => !l.startsWith("hint:")).slice(-3).join(" ");
}

/** The branch a tool may push from: never detached, never main/master or the
    remote default. An origin whose default cannot be determined refuses
    rather than falling through as "no default", so a repo defaulting to
    develop or trunk is protected exactly like one defaulting to main. */
export async function pushableBranch(cwd: string, git: GitRunner): Promise<{ branch: string; defaultBranch: string } | { error: string }> {
  const branch = await currentBranch(cwd, git);
  if (branch === null) return { error: DETACHED };
  return checkPushable(cwd, git, branch);
}

async function checkPushable(cwd: string, git: GitRunner, branch: string): Promise<{ branch: string; defaultBranch: string } | { error: string }> {
  if (PROTECTED.has(branch)) return { error: `refusing to push ${branch}: the default branch and main/master are never pushed by a tool` };
  const def = await remoteDefault(cwd, git);
  if (def === null) return { error: `refusing to push ${branch}: origin's default branch could not be determined` };
  if (branch === def.name) return { error: `refusing to push ${branch}: the default branch and main/master are never pushed by a tool` };
  return { branch, defaultBranch: def.name };
}

// A bare `git push` obeys push.default, which under `matching` pushes every
// matching branch (main included) and under `simple` fails on a renamed
// upstream; an explicit refspec pushes exactly one ref either way.
export async function gitPush(cwd: string, opts: { forceWithLease?: boolean; setUpstream?: boolean }, git: GitRunner): Promise<ToolResult> {
  const b = await pushableBranch(cwd, git);
  if ("error" in b) return err(b.error);
  const branch = b.branch;
  const args = ["push"];
  // A lease alone checks against origin/<branch> as last fetched, and any
  // fetch (git_rebase fetches first) moves that ref, so the lease passes
  // over remote commits HEAD never saw; --force-if-includes refuses those.
  if (opts.forceWithLease) args.push("--force-with-lease", "--force-if-includes");
  const asOrigin = `pass setUpstream: true to push it as origin/${branch}`;
  let remote: string;
  let remoteBranch: string;
  if (opts.setUpstream) {
    remote = "origin";
    remoteBranch = branch;
    args.push("-u");
  } else {
    const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
    if (upstream.code !== 0) return err(`${branch} has no upstream; ${asOrigin}`);
    const full = upstream.stdout.trim();
    const slash = full.indexOf("/");
    if (slash <= 0) return err(`cannot read the upstream of ${branch}: ${full}`);
    remote = full.slice(0, slash);
    remoteBranch = full.slice(slash + 1);
    // `git checkout -b feat/x origin/main` tracks main, so the local name
    // passing says nothing about where the refspec lands.
    if (PROTECTED.has(remoteBranch)) return err(`refusing to push ${branch}: its upstream is ${full}, the default branch or main/master; ${asOrigin}`);
    const remoteDef = await remoteDefault(cwd, git, remote);
    if (remoteDef === null) return err(`refusing to push ${branch}: its upstream is ${full}, whose remote's default branch could not be determined`);
    if (remoteBranch === remoteDef.name) return err(`refusing to push ${branch}: its upstream is ${full}, the default branch or main/master; ${asOrigin}`);
    // A stacked child tracking origin/<parent> would fast-forward the
    // parent's branch with the child's commits.
    if (remoteBranch !== branch) return err(`refusing to push ${branch}: its upstream is ${full}, a different branch name; ${asOrigin}`);
  }
  args.push(remote, `HEAD:refs/heads/${remoteBranch}`);
  const r = await git(args, cwd);
  if (r.code !== 0) return err(`git push failed: ${detail(r)}`);
  return ok({ pushed: true, branch, forceWithLease: opts.forceWithLease === true, upstream: `${remote}/${remoteBranch}` });
}

export async function gitPull(cwd: string, git: GitRunner): Promise<ToolResult> {
  const r = await git(["pull", "--ff-only"], cwd);
  if (r.code !== 0) return err(`git pull --ff-only failed (a diverged branch is never merged or rebased here): ${detail(r)}`);
  return ok({ pulled: true, output: r.stdout.trim() });
}

async function remoteOf(ref: string, cwd: string, git: GitRunner): Promise<string | null> {
  const slash = ref.indexOf("/");
  if (slash <= 0) return null;
  const remotes = await git(["remote"], cwd);
  const names = remotes.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const head = ref.slice(0, slash);
  return names.includes(head) ? head : null;
}

// onto is placed after --end-of-options so git never parses it as an option
// (`--exec=<cmd>` would run that command); a dash-leading value would parse
// as an option anywhere --end-of-options is missing, so it is refused even here.
export async function gitRebase(cwd: string, opts: { onto?: string; abort?: boolean }, git: GitRunner): Promise<ToolResult> {
  if (opts.abort && opts.onto !== undefined) return err("pass onto or abort, not both");
  if (opts.abort) {
    const r = await git(["rebase", "--abort"], cwd);
    return r.code === 0 ? ok({ status: "aborted" }) : err(`git rebase --abort failed: ${detail(r)}`);
  }
  if (typeof opts.onto !== "string" || opts.onto === "") return err('"onto" (a branch or ref) is required unless abort: true');
  if (opts.onto.startsWith("-") || /\s/.test(opts.onto)) return err('"onto" must be a branch or ref name, not an option');
  const fetched = await remoteOf(opts.onto, cwd, git);
  if (fetched !== null) {
    const f = await git(["fetch", fetched], cwd);
    if (f.code !== 0) return err(`git fetch ${fetched} failed: ${detail(f)}`);
  }
  const r = await git(["rebase", "--end-of-options", opts.onto], cwd);
  if (r.code === 0) return ok({ status: "ok", onto: opts.onto, fetched });
  const conflicted = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
  const files = conflicted.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (files.length > 0) return ok({ status: "conflict", onto: opts.onto, files });
  return err(`git rebase ${opts.onto} failed: ${detail(r)}`);
}

type ConfigRead = { status: "set"; value: string } | { status: "unset" } | { status: "error"; detail: string };

// `git config --get*` exits 1 when the key is absent, and anything else nonzero
// means the config could not be read at all (a corrupt file, a lock), which is
// never the same thing as "not configured".
async function readConfig(cwd: string, git: GitRunner, args: string[]): Promise<ConfigRead> {
  const r = await git(["config", ...args], cwd);
  if (r.code === 0) return { status: "set", value: r.stdout.trim() };
  if (r.code === 1) return { status: "unset" };
  return { status: "error", detail: `git config ${args.join(" ")} failed: ${detail(r)}` };
}

// rt sync pushes a src-only refspec (`origin <branch>`), so git takes the
// destination ref from config: remote.origin.push, or push.default
// upstream/tracking with a branch.<b>.merge naming another branch, sends that
// push to a different branch than the one checked here.
async function pushDestinationRedirected(cwd: string, git: GitRunner, branch: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const originPush = await readConfig(cwd, git, ["--get-all", "remote.origin.push"]);
  if (originPush.status === "error") return { ok: false, error: originPush.detail };
  if (originPush.status === "set") return { ok: false, error: `refusing to sync ${branch}: remote.origin.push redirects pushes to another ref` };

  const pushDefault = await readConfig(cwd, git, ["--get", "push.default"]);
  if (pushDefault.status === "error") return { ok: false, error: pushDefault.detail };
  if (pushDefault.status === "unset" || (pushDefault.value !== "upstream" && pushDefault.value !== "tracking")) return { ok: true };

  const merge = await readConfig(cwd, git, ["--get", `branch.${branch}.merge`]);
  if (merge.status === "error") return { ok: false, error: merge.detail };
  const expected = `refs/heads/${branch}`;
  if (merge.status === "unset" || merge.value !== expected) {
    return { ok: false, error: `refusing to sync ${branch}: push.default is ${pushDefault.value} and branch.${branch}.merge is not ${expected}, so the push could land elsewhere` };
  }
  return { ok: true };
}

// rt sync interpolates the branch name into shell command strings, and git
// accepts `$`, `(`, `;`, `|` and `${IFS}` in branch names. A dash-leading
// name (`refs/heads/--mirror` can exist) would parse as a git option there.
const SHELL_SAFE_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._\/-]*$/;

// A paused rebase detaches HEAD, so this runs before the detached-HEAD
// refusal to give the error that says how to get out. `--git-path` answers
// relative to cwd in a main checkout and absolutely in a linked worktree.
async function rebaseInProgress(cwd: string, git: GitRunner, exists: (p: string) => boolean): Promise<{ inProgress: boolean } | { error: string }> {
  const r = await git(["rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply"], cwd);
  if (r.code !== 0) return { error: `git rev-parse --git-path failed: ${detail(r)}` };
  const paths = lines(r.stdout);
  if (paths.length !== 2) return { error: `git rev-parse --git-path returned an unreadable answer: ${detail(r)}` };
  return { inProgress: paths.some((p) => exists(resolve(cwd, p))) };
}

export async function branchSyncPreflight(cwd: string, git: GitRunner, exists: (p: string) => boolean = existsSync): Promise<{ ok: true; diverged: boolean } | { ok: false; error: string }> {
  const rebasing = await rebaseInProgress(cwd, git, exists);
  if ("error" in rebasing) return { ok: false, error: rebasing.error };
  if (rebasing.inProgress) return { ok: false, error: "a rebase is in progress; finish it with git rebase --continue or git_rebase {abort: true}" };
  const current = await currentBranch(cwd, git);
  if (current === null) return { ok: false, error: DETACHED.replace("push", "sync") };
  // rt sync reads the short form and pushes `origin <that>`, so a short name
  // that differs from the branch lands on whatever ref it resolves to.
  const short = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (short.code !== 0) return { ok: false, error: `git symbolic-ref --short HEAD failed: ${detail(short)}` };
  if (short.stdout.trim() !== current) {
    return { ok: false, error: `refusing to sync ${JSON.stringify(current)}: the branch name is ambiguous with a tag or other ref of the same name, which rt sync cannot sync safely` };
  }
  const b = await checkPushable(cwd, git, current);
  if ("error" in b) return { ok: false, error: b.error.replace("push", "sync") };
  const { branch, defaultBranch } = b;
  if (!SHELL_SAFE_BRANCH.test(branch)) {
    return { ok: false, error: `refusing to sync ${JSON.stringify(branch)}: the branch name has characters rt sync cannot pass safely (only letters, digits, ".", "_", "/" and "-")` };
  }

  const redirect = await pushDestinationRedirected(cwd, git, branch);
  if (!redirect.ok) return { ok: false, error: redirect.error };

  const fetched = await git(["fetch", "origin"], cwd);
  if (fetched.code !== 0) return { ok: false, error: `git fetch origin failed: ${detail(fetched)}` };
  const remote = await git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], cwd);
  if (remote.code === 1) return { ok: true, diverged: false };
  if (remote.code !== 0) return { ok: false, error: `git rev-parse --verify origin/${branch} failed: ${detail(remote)}` };

  const counts = await git(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], cwd);
  if (counts.code !== 0) return { ok: false, error: `git rev-list --left-right --count failed: ${detail(counts)}` };
  const [behindStr, aheadStr] = counts.stdout.trim().split(/\s+/);
  const behind = Number(behindStr);
  const ahead = Number(aheadStr);
  if (!Number.isInteger(behind) || behind < 0 || !Number.isInteger(ahead) || ahead < 0) {
    return { ok: false, error: `git rev-list --left-right --count returned an unreadable count: ${detail(counts)}` };
  }
  if (behind === 0) return { ok: true, diverged: false };
  // rt sync force-pushes a branch that is only behind without fast-forwarding it.
  if (ahead === 0) return { ok: false, error: `origin/${branch} has commits this tree lacks; run git_pull first` };

  const remoteRef = `origin/${branch}`;
  const defaultRef = `origin/${defaultBranch}`;
  // Commits reachable from the default branch are never unpushed work, the
  // same exclusion rt sync's reset applies.
  const unpushedCmd = await git(["rev-list", "--cherry-pick", "--right-only", "--no-merges", `${remoteRef}...HEAD`, `^${defaultRef}`], cwd);
  if (unpushedCmd.code !== 0) return { ok: false, error: `git rev-list --cherry-pick failed: ${detail(unpushedCmd)}` };
  const unpushed = lines(unpushedCmd.stdout);
  if (unpushed.length > 0) return { ok: false, error: `refusing to reset ${branch} to origin: local commits with no equivalent on origin would be lost: ${unpushed.join(", ")}` };

  const newer = await localIsNewerRewrite(cwd, git, remoteRef, defaultRef);
  if ("error" in newer) return { ok: false, error: newer.error };
  if (newer.localNewer) {
    const remoteOnlyCmd = await git(["rev-list", "--cherry-pick", "--left-only", "--no-merges", `${remoteRef}...HEAD`, `^${defaultRef}`], cwd);
    if (remoteOnlyCmd.code !== 0) return { ok: false, error: `git rev-list --cherry-pick --left-only failed: ${detail(remoteOnlyCmd)}` };
    const remoteOnly = lines(remoteOnlyCmd.stdout);
    if (remoteOnly.length > 0) return { ok: false, error: `${remoteRef} has commits this tree lacks; rt sync would keep the local rewrite and force-push over them: ${remoteOnly.join(", ")}` };
  }
  return { ok: true, diverged: true };
}

function lines(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

// rt sync's reset keeps the local side, and force-pushes it, when the local
// fork point from the default branch is strictly newer than origin's; any
// commit only origin has is then dropped. Unlike rt sync, a failed probe
// here refuses instead of falling through.
async function localIsNewerRewrite(cwd: string, git: GitRunner, remoteRef: string, defaultRef: string): Promise<{ localNewer: boolean } | { error: string }> {
  const localBase = await git(["merge-base", "HEAD", defaultRef], cwd);
  if (localBase.code !== 0) return { error: `git merge-base HEAD ${defaultRef} failed: ${detail(localBase)}` };
  const remoteBase = await git(["merge-base", remoteRef, defaultRef], cwd);
  if (remoteBase.code !== 0) return { error: `git merge-base ${remoteRef} ${defaultRef} failed: ${detail(remoteBase)}` };
  const local = localBase.stdout.trim();
  const remote = remoteBase.stdout.trim();
  if (local === remote) return { localNewer: false };
  const anc = await git(["merge-base", "--is-ancestor", remote, local], cwd);
  if (anc.code === 0) return { localNewer: true };
  if (anc.code === 1) return { localNewer: false };
  return { error: `git merge-base --is-ancestor failed: ${detail(anc)}` };
}

const SYNC_TIMEOUT_MS = 300_000;

export const realSyncRunner = (cwd: string) => execWithTimeout([...rtSelfArgv(), "sync", "--json", "--no-agent"], { cwd, env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" }, timeoutMs: SYNC_TIMEOUT_MS });

export interface GitToolDeps {
  git: GitRunner;
  guard: TreeGuardDeps;
  sync: (cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export const realGitToolDeps: GitToolDeps = { git: realGitRunner, guard: realTreeGuardDeps, sync: realSyncRunner };

const TREE_PROP = { tree: { type: "string", description: "Absolute path of a checkout or worktree of a repo registered with rt." } };

export function gitToolDefs(deps: GitToolDeps): McpToolDef[] {
  const guarded = (fn: (path: string, input: Record<string, unknown>) => Promise<ToolResult>) => async (input: Record<string, unknown>): Promise<ToolResult> => {
    const tree = checkRegisteredTree(input.tree, deps.guard);
    if (!tree.ok) return err(tree.error);
    return fn(tree.path, input);
  };
  return [
    {
      name: "git_push",
      description: "Push the tree's current branch to its same-named upstream, or as origin/<branch> with setUpstream: true (which replaces any existing upstream). Force is only ever --force-with-lease --force-if-includes. Refuses a detached HEAD, the repo's default branch, main and master, and an upstream that is the default branch or has a different branch name unless setUpstream is passed.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, forceWithLease: { type: "boolean" }, setUpstream: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path, input) => {
        const bad = checkOptional(input, [{ name: "forceWithLease", type: "boolean" }, { name: "setUpstream", type: "boolean" }]);
        if (bad) return err(bad);
        return gitPush(path, { forceWithLease: input.forceWithLease === true, setUpstream: input.setUpstream === true }, deps.git);
      }),
    },
    {
      name: "git_pull",
      description: "Fast-forward the tree's current branch from its upstream (--ff-only). A diverged branch is an error, never a merge or rebase.",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path) => gitPull(path, deps.git)),
    },
    {
      name: "git_rebase",
      description: "Rebase the tree's current branch onto a named branch or ref; a remote-tracking ref (origin/<branch>) is fetched first. On a conflict it returns status conflict with the conflicted files and leaves the tree mid-rebase for you to resolve (then finish with git rebase --continue in Bash), or pass abort: true to abort one in progress.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, onto: { type: "string" }, abort: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path, input) => {
        const bad = checkOptional(input, [{ name: "onto", type: "string" }, { name: "abort", type: "boolean" }]);
        if (bad) return err(bad);
        return gitRebase(path, { onto: input.onto as string | undefined, abort: input.abort === true }, deps.git);
      }),
    },
    {
      name: "branch_sync",
      description: "Bring the tree's branch current in one call, the rt sync flow: fetch; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease. Refuses when a local commit has no equivalent on origin (unpushed work) or when origin has commits the push would drop (a branch only behind origin: run git_pull first), naming the commits. A rebase conflict returns status conflict with rt sync's bundle and leaves the rebase paused.",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path) => {
        const pre = await branchSyncPreflight(path, deps.git);
        if (!pre.ok) return err(pre.error);
        const r = await deps.sync(path);
        let body: unknown = null;
        try { body = JSON.parse(r.stdout); } catch { body = null; }
        const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        if (r.code === 0) return ok({ status: "synced", divergedFromOrigin: pre.diverged, ...obj });
        if (r.code === 3) return ok({ status: "conflict", ...obj });
        if (r.code === 124) return err(`rt sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`);
        const hint = typeof obj.hint === "string" ? (typeof obj.tool === "string" && obj.tool !== "" ? `${obj.hint}. Run: ${obj.tool}` : obj.hint) : null;
        const message = typeof obj.error === "string" ? obj.error : hint ?? detail(r);
        return err(`rt sync refused (exit ${r.code}): ${message}`);
      }),
    },
  ];
}
