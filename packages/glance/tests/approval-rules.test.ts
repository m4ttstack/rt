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

  test('chunks iids into batches of 100', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const iids = Array.from({ length: 150 }, (_, i) => i + 1);
    const calls = stubRunQuery(p, [
      page(iids.slice(0, 100).map((id) => node(id, [])), false, null),
      page(iids.slice(100, 150).map((id) => node(id, [])), false, null),
    ]);
    const out = await p.fetchApprovalRules({ projectPath: 'g/p', iids });
    expect(out).toHaveLength(150);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.vars.iids).toHaveLength(100);
    expect(calls[1]!.vars.iids).toHaveLength(50);
    expect(calls[0]!.vars.iids[0]).toBe('1');
    expect(calls[0]!.vars.iids[99]).toBe('100');
    expect(calls[1]!.vars.iids[0]).toBe('101');
    expect(calls[1]!.vars.iids[49]).toBe('150');
  });

  test('rejects when both updatedAfter and iids are provided', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, [page([], false, null)]);
    await expect(
      p.fetchApprovalRules({
        projectPath: 'g/p',
        updatedAfter: '2026-07-26T00:00:00Z',
        iids: [1, 2, 3],
      }),
    ).rejects.toThrow(/updatedAfter and iids are mutually exclusive/);
  });

  test('validates pageSize: rejects non-positive, fractional, and non-finite values', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, [page([], false, null)]);
    const invalidValues = [0, -1, -100, 1.5, 3.14, Infinity, -Infinity, NaN];
    for (const value of invalidValues) {
      await expect(
        p.fetchApprovalRules({
          projectPath: 'g/p',
          updatedAfter: '2026-07-26T00:00:00Z',
          pageSize: value,
        }),
      ).rejects.toThrow(/pageSize must be a positive integer/);
    }
  });

  test('accepts valid pageSize like 200 and passes it through as first', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubRunQuery(p, [
      page([node(1, [])], false, null),
    ]);
    await p.fetchApprovalRules({
      projectPath: 'g/p',
      updatedAfter: '2026-07-26T00:00:00Z',
      pageSize: 200,
    });
    expect(calls[0]!.vars.first).toBe(200);
  });
});
