#!/usr/bin/env bun
/**
 * fetchCodeownerSections: one blobs query for every documented CODEOWNERS
 * location, first-in-precedence wins, null when none exists. No ref is sent:
 * GitLab resolves the default branch.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function stubRunQuery(provider: GitLabProvider, response: unknown) {
  const calls: Array<{ op: string; vars: any }> = [];
  (provider as any).runQuery = async (op: string, _query: string, vars: any) => {
    calls.push({ op, vars });
    return response;
  };
  return calls;
}

const blobs = (nodes: Array<{ path: string; rawTextBlob: string | null }>) => ({
  project: { repository: { blobs: { nodes } } },
});

describe('fetchCodeownerSections', () => {
  test('parses the file and asks for every documented location in one query', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubRunQuery(p, blobs([{ path: '.gitlab/CODEOWNERS', rawTextBlob: '[Docs] @a\n[Api - #pod-x] @b\n' }]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual(['Api - #pod-x', 'Docs']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('fetchCodeownerSections');
    expect(calls[0]!.vars).toEqual({ projectPath: 'g/p', paths: ['CODEOWNERS', '.gitlab/CODEOWNERS', 'docs/CODEOWNERS'] });
  });

  test('the root file wins when several locations exist', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, blobs([
      { path: 'docs/CODEOWNERS', rawTextBlob: '[FromDocs]' },
      { path: 'CODEOWNERS', rawTextBlob: '[FromRoot]' },
    ]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual(['FromRoot']);
  });

  test('null when no location exists; [] when the file has no sections', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, blobs([]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
    stubRunQuery(p, blobs([{ path: 'CODEOWNERS', rawTextBlob: '* @everyone\n' }]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual([]);
  });

  test('a missing project or repository reads as no file', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, { project: null });
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
    stubRunQuery(p, { project: { repository: null } });
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
  });
});
