import { simpleGit, type SimpleGit } from "simple-git";
import { getSnapshot } from "./snapshot.ts";
import { getFileDiff } from "./diff.ts";
import { getBranches, getRemotes, getTags, createTag, deleteTag, pushTag, fetchRemote } from "./refs.ts";
import { getLog } from "./log.ts";
import { getStashes, stashPush, stashApply, stashPop, stashDrop } from "./stash.ts";
import { getFetchState } from "./fetch-state.ts";
import { getStagingDiff, stageSelection, discardSelection, stageFileFully } from "./staging.ts";
import { undoLastCommit, resetToCommit } from "./commits.ts";
import { checkoutBranch, createBranch } from "./branch-ops.ts";
import { scrubGitEnv } from "./exec.ts";
import { getCommits, getLocalCommits, getChangedFiles, getCommitRangeChangedFiles, getCommitDiff, getCommitRangeDiff } from "./history.ts";
import type { GitClient } from "./types.ts";

export interface ClientContext {
  dir: string;
  git: SimpleGit;
}

// simple-git's block-unsafe-operations plugin scans any env object passed to
// .env() for names like EDITOR/PAGER/GIT_SSH_COMMAND and throws unless the
// matching `unsafe.allow*` flag is set -- so `.env({ ...process.env })`
// verbatim throws "not permitted without enabling allowUnsafeEditor" the
// moment a developer's shell has an EDITOR or PAGER set, which is most
// shells. Push-like commands DO read the SSH/askpass vars, so they are
// dropped here rather than worked around with the `unsafe` bypass flags;
// pushTag routes through rawGit instead, which keeps the full env.
const UNSAFE_ENV_KEYS = new Set([
  "editor", "pager", "prefix",
  "git_askpass", "git_config", "git_config_count", "git_config_global", "git_config_system",
  "git_editor", "git_exec_path", "git_external_diff", "git_pager", "git_proxy_command",
  "git_sequence_editor", "git_ssh", "git_ssh_command", "git_template_dir", "ssh_askpass",
]);

function pinnedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!UNSAFE_ENV_KEYS.has(key.toLowerCase())) env[key] = value;
  }
  return scrubGitEnv(env);
}

export function createGitClient(dir: string): GitClient {
  // Pins the child process locale so git's own error/status text is always
  // English, independent of the invoking user's shell environment.
  const git = simpleGit({ baseDir: dir }).env(pinnedEnv());
  const ctx: ClientContext = { dir, git };
  return {
    dir,
    snapshot: () => getSnapshot(ctx),
    diffFile: (path, opts) => getFileDiff(ctx, path, opts),
    branches: () => getBranches(ctx),
    remotes: () => getRemotes(ctx),
    tags: () => getTags(ctx),
    log: (opts) => getLog(ctx, opts),
    stashes: () => getStashes(ctx),
    stashPush: (opts) => stashPush(ctx, opts),
    stashApply: (index) => stashApply(ctx, index),
    stashPop: (index) => stashPop(ctx, index),
    stashDrop: (index) => stashDrop(ctx, index),
    fetchState: () => getFetchState(ctx),
    fetch: (remote, signal) => fetchRemote(ctx, remote, signal),
    stagingDiff: (path) => getStagingDiff(ctx, path),
    stageSelection: (diff, selection, opts) => stageSelection(ctx, diff, selection, opts),
    discardSelection: (diff, selection) => discardSelection(ctx, diff, selection),
    stageFileFully: (path, originalPath) => stageFileFully(ctx, path, originalPath),
    undoLastCommit: () => undoLastCommit(ctx),
    resetToCommit: (sha, mode) => resetToCommit(ctx, sha, mode),
    checkoutBranch: (name) => checkoutBranch(ctx, name),
    createBranch: (name, opts) => createBranch(ctx, name, opts),
    createTag: (name, opts) => createTag(ctx, name, opts),
    deleteTag: (name) => deleteTag(ctx, name),
    pushTag: (name, remote) => pushTag(ctx, name, remote),
    commits: (range, limit, skip, additionalArgs) => getCommits(ctx, range, limit, skip, additionalArgs),
    localCommits: (branch, skip) => getLocalCommits(ctx, branch, skip),
    changedFiles: (sha) => getChangedFiles(ctx, sha),
    commitRangeChangedFiles: (shas) => getCommitRangeChangedFiles(ctx, shas),
    commitDiff: (file, sha) => getCommitDiff(ctx, file, sha),
    commitRangeDiff: (file, shas) => getCommitRangeDiff(ctx, file, shas),
  };
}
