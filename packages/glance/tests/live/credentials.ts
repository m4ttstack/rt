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

const DEFAULT_PATH = new URL('../../../../harness_credentials.json', import.meta.url).pathname;

/** Returns null when the file is absent, so the runner can skip with a message. */
export async function loadCredentials(
  path: string = DEFAULT_PATH
): Promise<HarnessCredentials | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return parseCredentials(await file.json());
}

/** Returns null when `gh` is missing or logged out. */
export async function resolveGitHubToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['gh', 'auth', 'token'], { stdout: 'pipe', stderr: 'ignore' });
    const token = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && token ? token : null;
  } catch {
    return null;
  }
}
