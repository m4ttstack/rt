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

export async function buildFixtures(): Promise<ProviderFixture[]> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error('No harness_credentials.json. Copy harness_credentials.example.json and fill it in.');
    return [];
  }

  const fixtures: ProviderFixture[] = [];

  const ghToken = await resolveGitHubToken();
  if (ghToken) {
    const { owner, repo } = parseGitHubSlug(githubRepo(creds).web_url);
    fixtures.push({
      name: 'github',
      provider: new GitHubProvider('https://github.com', ghToken),
      projectPath: `${owner}/${repo}`,
      defaultBranch: 'main',
      approver: null
    });
  } else {
    console.error('Skipping GitHub: `gh auth token` produced nothing. Run `gh auth login`.');
  }

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

  return fixtures;
}
