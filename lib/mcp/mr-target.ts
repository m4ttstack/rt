/**
 * Turns the target an MR write tool was given ({repoName, iid, mrUrl}) into
 * the serialized identity and iid the daemon verbs take. Resolution is a
 * client-side concern, like --repo on the CLI: the daemon keeps taking the
 * serialized identity only. repoName goes through tryResolveRepoArg (an
 * identity, an absolute checkout path, or a label matching exactly one
 * registered repo); mrUrl maps its host and project path through
 * identityFromRemote, so the machine store's identity overrides apply, and
 * must name a repo rt has registered. An override is keyed by the remote as
 * git observed it (often the ssh form), which the https form built from a
 * URL never matches, so when that form names no registered repo the
 * registered checkouts' own origin remotes are the tie back to the URL.
 */
import { getRemoteUrl } from "../pickers.ts";
import { tryResolveRepoArg } from "../repo-arg.ts";
import { isRepoRegistered, loadRepoIndex } from "../repo-index.ts";
import { identityFromRemote, normalizeRemote, parseIdentity, serializeIdentity } from "../settings/identity.ts";

export type TargetInput = { repoName?: unknown; iid?: unknown; mrUrl?: unknown };

export type RepoTarget =
  | { ok: true; identity: string; iid: number | undefined }
  | { ok: false; error: string };

export type MrTarget =
  | { ok: true; identity: string; iid: number }
  | { ok: false; error: string };

export const MR_URL_SHAPE = "mrUrl must look like https://<host>/<group>/<project>/-/merge_requests/<iid>";

const MR_URL_RE = /^https:\/\/([^/?#]+)\/(.+?)\/-\/merge_requests\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/;

export function parseMrUrl(url: string): { host: string; projectPath: string; iid: number } | null {
  const m = MR_URL_RE.exec(url.trim());
  if (!m) return null;
  const iid = Number(m[3]);
  if (!Number.isInteger(iid) || iid <= 0) return null;
  return { host: m[1]!, projectPath: m[2]!, iid };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Registered identities whose checkout's origin remote normalizes to the URL's host/path; a checkout that is gone or has no origin is skipped. */
async function identitiesByOriginRemote(host: string, projectPath: string): Promise<string[]> {
  const wanted = `${host.toLowerCase()}/${projectPath}`;
  const matches: string[] = [];
  for (const [identity, checkout] of Object.entries(loadRepoIndex())) {
    const remote = await getRemoteUrl(checkout);
    if (remote && normalizeRemote(remote) === wanted) matches.push(identity);
  }
  return matches;
}

export async function resolveRepoTarget(input: TargetInput): Promise<RepoTarget> {
  if (input.repoName !== undefined && typeof input.repoName !== "string") return { ok: false, error: '"repoName" must be a string' };
  if (input.iid !== undefined && !isPositiveInt(input.iid)) return { ok: false, error: '"iid" must be a positive integer' };
  if (input.mrUrl !== undefined && typeof input.mrUrl !== "string") return { ok: false, error: '"mrUrl" must be a string' };
  const repoName = typeof input.repoName === "string" ? input.repoName.trim() : "";
  const mrUrl = typeof input.mrUrl === "string" ? input.mrUrl.trim() : "";
  if (!repoName && !mrUrl) return { ok: false, error: 'pass "repoName" or "mrUrl"' };

  let fromUrl: { identity: string; iid: number } | undefined;
  if (mrUrl) {
    const parsed = parseMrUrl(mrUrl);
    if (!parsed) return { ok: false, error: MR_URL_SHAPE };
    const direct = identityFromRemote(`https://${parsed.host}/${parsed.projectPath}`);
    if (!direct) return { ok: false, error: MR_URL_SHAPE };
    const directWire = serializeIdentity(direct);
    if (isRepoRegistered(directWire)) {
      fromUrl = { identity: directWire, iid: parsed.iid };
    } else {
      const matches = await identitiesByOriginRemote(parsed.host, parsed.projectPath);
      if (matches.length > 1) {
        return { ok: false, error: `mrUrl matches more than one registered repo: ${matches.join(", ")}; pass repoName to pick one` };
      }
      if (matches.length === 0) {
        return { ok: false, error: `mrUrl names ${direct.id} (${directWire}), which is not registered with rt; run rt repos register in its checkout first` };
      }
      fromUrl = { identity: matches[0]!, iid: parsed.iid };
    }
  }

  let fromName: string | undefined;
  if (repoName) {
    const res = await tryResolveRepoArg(repoName);
    if (res.kind === "ambiguous") {
      return { ok: false, error: `repoName "${repoName}" matches more than one repo: ${res.matches.join(", ")}; pass the full identity` };
    }
    if (res.kind === "none") {
      return { ok: false, error: `repoName "${repoName}" did not match a registered repo; pass its serialized identity, an absolute checkout path, or the label of exactly one registered repo` };
    }
    fromName = res.identity;
    if (!parseIdentity(repoName) && !isRepoRegistered(fromName)) {
      return { ok: false, error: `repoName "${repoName}" is a checkout of ${fromName}, which is not registered with rt; run rt repos register in its checkout first` };
    }
  }

  if (fromName && fromUrl && fromName !== fromUrl.identity) {
    return { ok: false, error: `repoName resolves to ${fromName} but mrUrl names ${fromUrl.identity}; pass one of them, or make them agree` };
  }
  if (fromUrl && input.iid !== undefined && input.iid !== fromUrl.iid) {
    return { ok: false, error: `iid ${input.iid} does not match mrUrl's merge request ${fromUrl.iid}` };
  }
  const identity = fromName ?? fromUrl!.identity;
  const iid = isPositiveInt(input.iid) ? input.iid : fromUrl?.iid;
  return { ok: true, identity, iid };
}

export async function resolveMrTarget(input: TargetInput): Promise<MrTarget> {
  const res = await resolveRepoTarget(input);
  if (!res.ok) return res;
  if (res.iid === undefined) return { ok: false, error: 'pass "iid" or "mrUrl"' };
  return { ok: true, identity: res.identity, iid: res.iid };
}
