#!/usr/bin/env bun
/**
 * fetchApprovalRules: the light batched rules query. Wide discovery must
 * never carry the heavy dashboard fragment (the a6601b1 wedge class), so
 * this method has its own minimal query: iid + rules{type,approved,section}.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function stubRunQuery(provider: GitLabProvider, pages: any[]) {
  const calls: Array<{ op: string; query: string; vars: any }> = [];
  let i = 0;
  (provider as any).runQuery = async (op: string, query: string, vars: any) => {
    calls.push({ op, query, vars });
    return pages[Math.min(i++, pages.length - 1)];
  };
  return calls;
}

const node = (iid: number, rules: any[]) => ({ iid: String(iid), approvalState: { rules } });
const page = (nodes: any[], hasNext: boolean, cursor: string | null) => ({
  project: { mergeRequests: { pageInfo: { hasNextPage: hasNext, endCursor: cursor }, nodes } },
});

describe('fetchApprovalRules', () => {
  test('windowed mode paginates and maps iids to numbers', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubRunQuery(p, [
      page([node(1, [{ type: 'CODE_OWNER', approved: false, section: 'Acme' }])], true, 'c1'),
      page([node(2, [{ type: 'REGULAR', approved: true, section: null }])], false, null),
    ]);
    const out = await p.fetchApprovalRules({ projectPath: 'g/p', updatedAfter: '2026-07-26T00:00:00Z' });
    expect(out).toEqual([
      { iid: 1, rules: [{ type: 'CODE_OWNER', approved: false, section: 'Acme' }] },
      { iid: 2, rules: [{ type: 'REGULAR', approved: true, section: null }] },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.op).toBe('fetchApprovalRules.project');
    expect(calls[0]!.vars).toMatchObject({ projectPath: 'g/p', ua: '2026-07-26T00:00:00Z', first: 100, after: null });
    expect(calls[1]!.vars.after).toBe('c1');
    // The wide query must stay light: no dashboard-fragment fields.
    expect(calls[0]!.query).not.toContain('diffStatsSummary');
    expect(calls[0]!.query).toContain('draft: false');
  });

  test('targeted mode queries by iids and omits the window', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubRunQuery(p, [
      page([node(7, [{ type: 'CODE_OWNER', approved: true, section: 'Acme' }])], false, null),
    ]);
    const out = await p.fetchApprovalRules({ projectPath: 'g/p', iids: [7] });
    expect(out).toEqual([{ iid: 7, rules: [{ type: 'CODE_OWNER', approved: true, section: 'Acme' }] }]);
    expect(calls[0]!.op).toBe('fetchApprovalRules.iids');
    expect(calls[0]!.vars).toMatchObject({ projectPath: 'g/p', iids: ['7'] });
  });

  test('non-advancing cursor throws instead of looping', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, [page([node(1, [])], true, null)]);
    await expect(p.fetchApprovalRules({ projectPath: 'g/p', updatedAfter: '2026-07-26T00:00:00Z' }))
      .rejects.toThrow(/non-advancing cursor/);
  });
});
