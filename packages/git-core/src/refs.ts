import type { ClientContext } from "./client.ts";
import type { BranchInfo, TagInfo } from "./types.ts";
import { rawGit } from "./exec.ts";

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

const TAG_FORMAT = ["%(refname:short)", "%(objectname)", "%(objecttype)"].join(FS_TOKEN);

export async function getTags(ctx: ClientContext): Promise<TagInfo[]> {
  const out = await rawGit(ctx.dir, ["for-each-ref", `--format=${TAG_FORMAT}`, "refs/tags"]);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, sha, objectType] = line.split(FS);
      return { name: name ?? "", sha: sha ?? "", annotated: objectType === "tag" };
    });
}
