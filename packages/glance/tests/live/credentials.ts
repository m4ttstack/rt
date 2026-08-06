/**
 * Credentials for the live conformance harness.
 *
 * GitLab needs three identities on one project rather than one. GitLab
 * refuses to let an author approve their own MR, so a single-token harness
 * cannot tell "approval worked" apart from "approval was rejected".
 *
 * GitHub deliberately has no token here. It comes from `gh auth token`, so
 * there is nothing GitHub-credential-shaped on disk to leak.
 */

export interface HarnessUser {
  username: string;
  name: string;
  role: 'owner' | 'approver';
  token: string;
}

export interface HarnessRepo {
  provider: 'gitlab' | 'github';
  name: string;
  web_url: string;
  owner: string;
  project_id?: number;
  path_with_namespace?: string;
}

export interface HarnessCredentials {
  users: HarnessUser[];
  repos: HarnessRepo[];
}

const ROLES = new Set(['owner', 'approver']);

function fail(message: string): never {
  throw new Error(`harness_credentials.json: ${message}`);
}

export function parseCredentials(raw: unknown): HarnessCredentials {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('must be a JSON object');
  }
  const doc = raw as Record<string, unknown>;

  if (!Array.isArray(doc.users)) fail('`users` must be an array');
  if (!Array.isArray(doc.repos)) fail('`repos` must be an array');

  const users = doc.users.map((entry, i): HarnessUser => {
    const u = entry as Record<string, unknown>;
    for (const field of ['username', 'name', 'role', 'token']) {
      if (typeof u[field] !== 'string' || !u[field]) {
        fail(`users[${i}].${field} must be a non-empty string`);
      }
    }
    if (!ROLES.has(u.role as string)) {
      fail(`users[${i}].role must be "owner" or "approver", got "${String(u.role)}"`);
    }
    return u as unknown as HarnessUser;
  });

  const repos = doc.repos.map((entry, i): HarnessRepo => {
    const r = entry as Record<string, unknown>;
    if (r.provider !== 'gitlab' && r.provider !== 'github') {
      fail(`repos[${i}].provider must be "gitlab" or "github"`);
    }
    for (const field of ['name', 'web_url', 'owner']) {
      if (typeof r[field] !== 'string' || !r[field]) {
        fail(`repos[${i}].${field} must be a non-empty string`);
      }
    }
    if (r.project_id !== undefined) {
      if (typeof r.project_id !== 'number' || !Number.isInteger(r.project_id)) {
        fail(`repos[${i}].project_id must be an integer, got ${String(r.project_id)}`);
      }
    }
    if (r.path_with_namespace !== undefined) {
      if (typeof r.path_with_namespace !== 'string' || !r.path_with_namespace) {
        fail(`repos[${i}].path_with_namespace must be a non-empty string`);
      }
    }
    return r as unknown as HarnessRepo;
  });

  return { users, repos };
}

export function ownerUser(creds: HarnessCredentials): HarnessUser {
  const owner = creds.users.find(u => u.role === 'owner');
  if (!owner) fail('no user with role "owner"');
  return owner;
}

export function approverUsers(creds: HarnessCredentials): HarnessUser[] {
  return creds.users.filter(u => u.role === 'approver');
}

function repoFor(creds: HarnessCredentials, provider: 'gitlab' | 'github'): HarnessRepo {
  const repo = creds.repos.find(r => r.provider === provider);
  if (!repo) fail(`no repo with provider "${provider}"`);
  return repo;
}

export function gitlabRepo(creds: HarnessCredentials): HarnessRepo {
  return repoFor(creds, 'gitlab');
}

export function githubRepo(creds: HarnessCredentials): HarnessRepo {
  return repoFor(creds, 'github');
}

/**
 * Shared by `setup-github-fixture.ts` and `fixture.ts`, both of which need
 * to turn a `github.com` web URL into the `{ owner, repo }` GitHub actually
 * wants. One parser, so any future fix lands for both callers instead of
 * drifting between two copies. As written today it does not special-case
 * either a trailing slash (harmless: the extra empty path segment falls
 * after `repo`, not between `owner` and `repo`) or a `.git` suffix (not
 * harmless: `.../owner/repo.git` yields `repo: "repo.git"` verbatim).
 */
export function parseGitHubSlug(webUrl: string): { owner: string; repo: string } {
  const { pathname } = new URL(webUrl);
  const [, owner, repo] = pathname.split('/');
  if (!owner || !repo) {
    throw new Error(`not a github.com repo URL: ${webUrl}`);
  }
  return { owner, repo };
}

const DEFAULT_PATH = new URL('../../../../harness_credentials.json', import.meta.url).pathname;

/** Returns null when the file is absent, so the runner can skip with a message. */
export async function loadCredentials(
  path: string = DEFAULT_PATH
): Promise<HarnessCredentials | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return parseCredentials(await file.json());
}

/**
 * The GitHub account acting as the harness's second identity, or null.
 *
 * A username rather than a token, and read from the environment rather than
 * from `harness_credentials.json`, so that file keeps the property its own
 * README claims: nothing GitHub-credential-shaped on disk in a public repo.
 * The token for this account still comes from `gh`, exactly like the primary
 * one, via `resolveGitHubToken`'s injectable command.
 *
 * GitHub rejects a review request and an approval from the pull request's
 * author, so without a second account `approvePullRequest`'s accept path,
 * `unapprovePullRequest`, and `requestReReview` cannot be exercised at all.
 */
export function githubApproverUsername(): string | null {
  const name = process.env.GLANCE_HARNESS_GITHUB_APPROVER?.trim();
  return name ? name : null;
}

/** Returns null when `gh` is missing or logged out. */
export async function resolveGitHubToken(
  opts: { command?: string[]; timeoutMs?: number } = {}
): Promise<string | null> {
  try {
    const command = opts.command ?? ['gh', 'auth', 'token'];
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' });
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      proc.kill();
    }, timeoutMs);
    try {
      const token = (await new Response(proc.stdout).text()).trim();
      if (didTimeout) return null;
      return (await proc.exited) === 0 && token ? token : null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch {
    return null;
  }
}
