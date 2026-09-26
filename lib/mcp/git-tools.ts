import { execWithTimeout } from "../setup/probes.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { runCapture } from "../subprocess.ts";
import { checkOptional, err, ok, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realGitRunner: GitRunner = async (args, cwd) => {
  const r = await runCapture(["git", ...args], { cwd, stderr: "pipe", timeoutMs: 120_000 });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
};

const PROTECTED = new Set(["main", "master"]);

async function currentBranch(cwd: string, git: GitRunner): Promise<string | null> {
  const r = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
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

function detail(r: { stderr: string; stdout: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-3).join(" ");
}

/** The branch a tool may push from: never detached, never main/master or the
    remote default. An origin whose default cannot be determined refuses
    rather than falling through as "no default", so a repo defaulting to
    develop or trunk is protected exactly like one defaulting to main. */
export async function pushableBranch(cwd: string, git: GitRunner): Promise<{ branch: string; defaultBranch: string } | { error: string }> {
  const branch = await currentBranch(cwd, git);
  if (branch === null) return { error: "refusing to push a detached HEAD" };
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

// `git rebase` does not take `--` before its ref, so a dash-leading onto is
// refused outright: passed through, `--exec=<cmd>` would run that command.
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
  const r = await git(["rebase", opts.onto], cwd);
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

// `rt sync` runs a bare `git push --force-with-lease origin <branch>`
// (commands/git/reset.ts, commands/sync.ts:301): git picks the destination
// ref itself, and remote.origin.push or push.default=upstream/tracking with a
// mismatched branch.<b>.merge can send that push to a different branch than
// the one named here (reproduced: a worktree branch tracking origin/<default>
// under push.default=upstream sends the push straight to <default>).
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
// accepts `$`, `(`, `;`, `|` and `${IFS}` in branch names.
const SHELL_SAFE_BRANCH = /^[A-Za-z0-9._\/-]+$/;

export async function branchSyncPreflight(cwd: string, git: GitRunner): Promise<{ ok: true; diverged: boolean } | { ok: false; error: string }> {
  const b = await pushableBranch(cwd, git);
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
  if (remote.code !== 0) return { ok: true, diverged: false };

  const counts = await git(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], cwd);
  if (counts.code !== 0) return { ok: false, error: `git rev-list --left-right --count failed: ${detail(counts)}` };
  const [behindStr, aheadStr] = counts.stdout.trim().split(/\s+/);
  const behind = Number(behindStr);
  const ahead = Number(aheadStr);
  if (!Number.isInteger(behind) || behind < 0 || !Number.isInteger(ahead) || ahead < 0) {
    return { ok: false, error: `git rev-list --left-right --count returned an unreadable count: ${detail(counts)}` };
  }
  if (behind === 0 || ahead === 0) return { ok: true, diverged: false };

  // `git cherry` marks a commit the default branch already carries (baked in
  // by a rebase onto it) as unpushed, since it has no patch-equivalent on
  // origin/<branch> either; excluding `^origin/<default>` is what `rt sync`
  // itself does (commands/git/reset.ts:236-241) to avoid that false positive.
  const unpushedCmd = await git(["rev-list", "--cherry-pick", "--right-only", "--no-merges", `origin/${branch}...HEAD`, `^origin/${defaultBranch}`], cwd);
  if (unpushedCmd.code !== 0) return { ok: false, error: `git rev-list --cherry-pick failed: ${detail(unpushedCmd)}` };
  const unpushed = unpushedCmd.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (unpushed.length > 0) return { ok: false, error: `refusing to reset ${branch} to origin: local commits with no equivalent on origin would be lost: ${unpushed.join(", ")}` };
  return { ok: true, diverged: true };
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
      description: "Bring the tree's branch current in one call, the rt sync flow: fetch; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease. Refuses when a local commit has no equivalent on origin (unpushed work), naming the commits. A rebase conflict returns status conflict with rt sync's bundle and leaves the rebase paused.",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path) => {
        const pre = await branchSyncPreflight(path, deps.git);
        if (!pre.ok) return err(pre.error);
        const r = await deps.sync(path);
        let body: unknown = null;
        try { body = JSON.parse(r.stdout); } catch { body = null; }
        const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        if (r.code === 0) return ok({ status: "synced", resetToOrigin: pre.diverged, ...obj });
        if (r.code === 3) return ok({ status: "conflict", ...obj });
        if (r.code === 124) return err(`rt sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`);
        const message = typeof obj.error === "string" ? obj.error : detail(r);
        return err(`rt sync refused (exit ${r.code}): ${message}`);
      }),
    },
  ];
}
