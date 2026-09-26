#!/usr/bin/env bun
/**
 * excludeTargetBranches: MRs into these exact branches are dropped by GitLab
 * itself (`not: { targetBranches }`), so their fields are never resolved.
 * Callers that do not pass it must keep sending the exact query they always
 * sent.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface Call { op: string; query: string; vars: Record<string, unknown> }

function stub(provider: GitLabProvider): Call[] {
  const calls: Call[] = [];
  (provider as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
    calls.push({ op, query, vars });
    const conn = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
    return { project: { mergeRequests: conn }, group: { mergeRequests: conn } };
  };
  return calls;
}

const UA = '2026-08-01T00:00:00Z';
const EXCLUDED = ['deployments/qa', 'deployments/prod'];

type Run = (p: GitLabProvider, extra: { excludeTargetBranches?: string[] }) => Promise<unknown>;
const CALLERS: Array<[string, Run]> = [
  ['fetchPullRequests, project mode', (p, x) => p.fetchPullRequests({ projectPath: 'g/p', state: 'opened', listWeight: true, ...x })],
  ['fetchPullRequests, project mode, several states', (p, x) => p.fetchPullRequests({ projectPath: 'g/p', state: ['opened', 'merged'], ...x })],
  ['fetchPullRequests, author mode', (p, x) => p.fetchPullRequests({ projectPath: 'g/p', authorUsernames: ['ada'], ...x })],
  ['fetchMergeRequestIndex, project', (p, x) => p.fetchMergeRequestIndex({ projectPaths: ['g/p'], updatedAfter: UA, ...x })],
  ['fetchMergeRequestIndex, group', (p, x) => p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, states: ['merged'], ...x })],
  ['fetchApprovalRules, window', (p, x) => p.fetchApprovalRules({ projectPath: 'g/p', updatedAfter: UA, ...x })],
];

async function capture(run: Run, extra: { excludeTargetBranches?: string[] }): Promise<Call[]> {
  const p = new GitLabProvider('https://gitlab.example', 't');
  const calls = stub(p);
  await run(p, extra);
  return calls;
}

describe('excludeTargetBranches (GitLab)', () => {
  for (const [name, run] of CALLERS) {
    test(`${name}: GitLab excludes the listed target branches`, async () => {
      const calls = await capture(run, { excludeTargetBranches: EXCLUDED });
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.query).toContain('$notTarget: [String!]');
        expect(c.query).toContain('not: { targetBranches: $notTarget }');
        expect(c.vars.notTarget).toEqual(EXCLUDED);
      }
    });

    test(`${name}: absent or empty sends the unchanged query`, async () => {
      const absent = await capture(run, {});
      const empty = await capture(run, { excludeTargetBranches: [] });
      expect(empty).toEqual(absent);
      for (const c of absent) {
        expect(c.query).not.toContain('targetBranches');
        expect('notTarget' in c.vars).toBe(false);
      }
    });
  }
});
