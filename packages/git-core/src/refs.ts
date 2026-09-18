import type { ClientContext } from "./client.ts";
import type { BranchInfo, TagInfo } from "./types.ts";
import { rawGit } from "./exec.ts";
import { assertSafeCommitish, assertSafeRemote, assertValidTagName } from "./ref-guard.ts";

// "%00" in a for-each-ref format string is a directive git expands to a real
// NUL byte in its output, not literal text -- so the field separator used to
// build the --format argument (FS_TOKEN) and the one used to split the
// resulting output (FS) are different strings.
const FS_TOKEN = "%00";
const FS = "\x00";

const BRANCH_FORMAT = [
  "%(HEAD)",
  "%(refname:short)",
  "%(objectname)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(committerdate:iso8601-strict)",
].join(FS_TOKEN);

function parseTrack(track: string): { ahead: number | null; behind: number | null; gone: boolean } {
  if (track === "[gone]") return { ahead: null, behind: null, gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: false,
  };
}

export async function getBranches(ctx: ClientContext): Promise<BranchInfo[]> {
  const out = await rawGit(ctx.dir, [
    "for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads",
  ]);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [head, name, sha, upstream, track, committedAt] = line.split(FS);
      const hasUpstream = (upstream ?? "") !== "";
      const t = hasUpstream ? parseTrack(track ?? "") : { ahead: null, behind: null, gone: false };
      return {
        name: name ?? "",
        current: head === "*",
        sha: sha ?? "",
        upstream: hasUpstream ? upstream! : null,
        upstreamGone: t.gone,
        ahead: t.gone ? null : t.ahead,
        behind: t.gone ? null : t.behind,
        committedAt: committedAt ?? "",
      };
    });
}

const TAG_FORMAT = [
  "%(refname:short)", "%(objectname)", "%(objecttype)", "%(*objectname)",
].join(FS_TOKEN);

export async function getTags(ctx: ClientContext): Promise<TagInfo[]> {
  const out = await rawGit(ctx.dir, ["for-each-ref", `--format=${TAG_FORMAT}`, "refs/tags"]);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha, objectType, deref] = line.split(FS);
      // A lightweight tag's ref points straight at the commit, so the
      // dereferenced field git prints for it is empty -- sha is the target.
      const targetSha = deref && deref !== "" ? deref : (sha ?? "");
      return { name: name ?? "", sha: sha ?? "", annotated: objectType === "tag", targetSha };
    });
}

export async function createTag(
  ctx: ClientContext,
  name: string,
  opts?: { message?: string; sha?: string },
): Promise<void> {
  // An explicit empty sha is a caller bug, not "unset" -- letting it fall
  // into the `opts?.sha ? [opts.sha] : []` spread below would silently tag
  // HEAD instead of the (missing) commit the caller asked for.
  if (opts?.sha !== undefined && opts.sha.trim() === "") {
    throw new Error("createTag: sha must not be empty");
  }
  await assertValidTagName(ctx.dir, name);
  if (opts?.sha !== undefined) assertSafeCommitish(opts.sha, "sha");
  const point = opts?.sha ? [opts.sha] : [];
  const args = opts?.message ? ["-a", name, "-m", opts.message, ...point] : [name, ...point];
  await ctx.git.tag(args);
}

export async function deleteTag(ctx: ClientContext, name: string): Promise<void> {
  await assertValidTagName(ctx.dir, name);
  await ctx.git.tag(["-d", name]);
}

export async function pushTag(ctx: ClientContext, name: string, remote = "origin"): Promise<void> {
  await assertValidTagName(ctx.dir, name);
  assertSafeRemote(remote);
  // rawGit, not ctx.git.push: push reads GIT_SSH_COMMAND/GIT_ASKPASS, which the
  // simple-git client's pinned env strips, and the full refspec disambiguates
  // a tag from a branch of the same name ("matches more than one").
  await rawGit(ctx.dir, ["push", remote, `refs/tags/${name}`]);
}

export async function fetchRemote(ctx: ClientContext, remote = "origin"): Promise<void> {
  assertSafeRemote(remote);
  // rawGit, not ctx.git.fetch: fetch reads GIT_SSH_COMMAND/GIT_ASKPASS same as push.
  await rawGit(ctx.dir, ["fetch", "--quiet", remote]);
}
