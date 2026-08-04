import { GitHubProvider } from '../../src/GitHubProvider.ts';
import { GitLabProvider } from '../../src/GitLabProvider.ts';
import type { GitProvider } from '../../src/GitProvider.ts';
import {
  approverUsers,
  githubRepo,
  gitlabRepo,
  loadCredentials,
  ownerUser,
  parseGitHubSlug,
  resolveGitHubToken
} from './credentials.ts';

export interface ProviderFixture {
  name: 'github' | 'gitlab';
  provider: GitProvider;
  projectPath: string;
  defaultBranch: string;
  /** A second identity for approval assertions, or null when only one exists. */
  approver: GitProvider | null;
}

export interface MissingFixture {
  name: 'github' | 'gitlab';
  /** Why this provider, named in harness_credentials.json, could not be built. */
  reason: string;
}

export interface BuildFixturesResult {
  fixtures: ProviderFixture[];
  /**
   * Providers harness_credentials.json names in `repos` but that could not
   * be turned into a working fixture, and why. Deliberately not a count:
   * the runner needs to name each one and explain it, not just know that
   * something went wrong. A provider absent from `repos` entirely was
   * never expected to run and does not appear here; "expected" is always
   * derivable as `fixtures.map(f => f.name)` plus `missing.map(m => m.name)`,
   * so it isn't carried as a third field that could drift from the other two.
   */
  missing: MissingFixture[];
}

export async function buildFixtures(): Promise<BuildFixturesResult> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error('No harness_credentials.json. Copy harness_credentials.example.json and fill it in.');
    return { fixtures: [], missing: [] };
  }

  const fixtures: ProviderFixture[] = [];
  const missing: MissingFixture[] = [];

  // Gating each provider on its own presence in `repos`, and wrapping its
  // construction in try/catch, makes GitHub and GitLab fail the same way
  // for the same reasons. Before this fix the two were asymmetric: a
  // missing GitHub token logged an error and was silently dropped from the
  // result (the caller had no way to tell "skipped" from "nothing to
  // skip"), while a missing GitLab repo entry threw uncaught out of
  // gitlabRepo() here, crashing before GitHub even got a chance to run.
  if (creds.repos.some(r => r.provider === 'github')) {
    try {
      const ghToken = await resolveGitHubToken();
      if (!ghToken) {
        throw new Error('`gh auth token` produced nothing. Run `gh auth login`.');
      }
      const { owner, repo } = parseGitHubSlug(githubRepo(creds).web_url);
      fixtures.push({
        name: 'github',
        provider: new GitHubProvider('https://github.com', ghToken),
        projectPath: `${owner}/${repo}`,
        defaultBranch: 'main',
        approver: null
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`Skipping GitHub: ${reason}`);
      missing.push({ name: 'github', reason });
    }
  }

  if (creds.repos.some(r => r.provider === 'gitlab')) {
    try {
      const glRepo = gitlabRepo(creds);
      const glPath = glRepo.path_with_namespace;
      if (!glPath) throw new Error('gitlab repo entry needs path_with_namespace');
      const approvers = approverUsers(creds);
      fixtures.push({
        name: 'gitlab',
        provider: new GitLabProvider('https://gitlab.com', ownerUser(creds).token),
        projectPath: glPath,
        defaultBranch: 'main',
        approver: approvers[0]
          ? new GitLabProvider('https://gitlab.com', approvers[0].token)
          : null
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`Skipping GitLab: ${reason}`);
      missing.push({ name: 'gitlab', reason });
    }
  }

  return { fixtures, missing };
}
