import { describe, expect, it } from 'vitest';

import { mrRef } from './mrRef';

const enrichmentMr = {
  iid: 43166,
  webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
  state: 'merged',
  pipeline: { status: 'success' },
};

describe('mrRef', () => {
  it('prefers enrichment over the field, carrying state and CI', () => {
    expect(mrRef(enrichmentMr, 'https://elsewhere.example.com/x')).toEqual({
      iid: '43166',
      state: 'merged',
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: 'success',
      text: null,
    });
  });

  it('keeps enrichment without webUrl linkless but labeled', () => {
    expect(
      mrRef({ ...enrichmentMr, webUrl: null, pipeline: null }, null)
    ).toEqual({
      iid: '43166',
      state: 'merged',
      webUrl: null,
      ciStatus: null,
      text: null,
    });
  });

  it('parses a GitLab merge_requests URL from the field alone', () => {
    expect(
      mrRef(undefined, 'https://gitlab.example.com/g/p/-/merge_requests/43166')
    ).toEqual({
      iid: '43166',
      state: null,
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: null,
      text: null,
    });
  });

  it('parses a GitHub pull URL from the field alone', () => {
    expect(mrRef(undefined, 'https://github.com/o/r/pull/123')).toMatchObject({
      iid: '123',
      webUrl: 'https://github.com/o/r/pull/123',
    });
  });

  it('keeps an unrecognized URL clickable with no iid', () => {
    expect(
      mrRef(undefined, 'https://gitlab.example.com/g/p/-/pipelines/9')
    ).toMatchObject({
      iid: null,
      webUrl: 'https://gitlab.example.com/g/p/-/pipelines/9',
    });
  });

  it('renders a non-URL field value as text only', () => {
    expect(mrRef(undefined, 'draft, not opened yet')).toEqual({
      iid: null,
      state: null,
      webUrl: null,
      ciStatus: null,
      text: 'draft, not opened yet',
    });
  });

  it('returns null when neither source has anything', () => {
    expect(mrRef(undefined, null)).toBeNull();
    expect(mrRef(null, null)).toBeNull();
  });

  it('treats a whitespace-only field as nothing recorded', () => {
    expect(mrRef(undefined, '   ')).toBeNull();
  });

  it('normalizes a URL with surrounding whitespace and parses iid', () => {
    expect(
      mrRef(
        undefined,
        '  https://gitlab.example.com/g/p/-/merge_requests/43166\n'
      )
    ).toEqual({
      iid: '43166',
      state: null,
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: null,
      text: null,
    });
  });

  it('handles uppercase scheme URLs', () => {
    expect(mrRef(undefined, 'HTTPS://github.com/o/r/pull/456')).toMatchObject({
      iid: '456',
      webUrl: 'HTTPS://github.com/o/r/pull/456',
    });
  });
});
