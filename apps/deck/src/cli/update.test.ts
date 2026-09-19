import { expect, test } from 'bun:test';

import { pickAsset, pickDeckAssetUrl, RELEASES_API } from './update.ts';

test('pickAsset matches the monorepo tarball naming deps.lock installs from', () => {
  expect(pickAsset('darwin', 'arm64')).toBe('deck-darwin-arm64.tgz');
  expect(pickAsset('darwin', 'x64')).toBe('deck-darwin-x64.tgz');
  expect(() => pickAsset('win32', 'x64')).toThrow();
});

test('RELEASES_API reads the SAME repo the installer (deps.lock) pins from', () => {
  expect(RELEASES_API).toBe(
    'https://api.github.com/repos/m4ttstack/apps/releases?per_page=30'
  );
});

test('pickDeckAssetUrl finds the newest deck-v release and its asset, skipping other apps', () => {
  const releases = [
    {
      tag_name: 'board-v0.1.4',
      assets: [
        {
          name: 'board-darwin-arm64.tgz',
          browser_download_url: 'https://x/board',
        },
      ],
    },
    {
      tag_name: 'deck-v1.0.5',
      assets: [
        {
          name: 'deck-darwin-x64.tgz',
          browser_download_url: 'https://x/deck-x64',
        },
        {
          name: 'deck-darwin-arm64.tgz',
          browser_download_url: 'https://x/deck-arm64',
        },
      ],
    },
    {
      tag_name: 'deck-v1.0.4',
      assets: [
        {
          name: 'deck-darwin-arm64.tgz',
          browser_download_url: 'https://x/deck-old',
        },
      ],
    },
  ];
  expect(pickDeckAssetUrl(releases, 'deck-darwin-arm64.tgz')).toEqual({
    tag: 'deck-v1.0.5',
    url: 'https://x/deck-arm64',
  });
});

test('pickDeckAssetUrl returns null when no deck release or no matching asset exists', () => {
  expect(pickDeckAssetUrl([], 'deck-darwin-arm64.tgz')).toBeNull();
  expect(
    pickDeckAssetUrl(
      [{ tag_name: 'board-v0.1.4', assets: [] }],
      'deck-darwin-arm64.tgz'
    )
  ).toBeNull();
  expect(
    pickDeckAssetUrl(
      [
        {
          tag_name: 'deck-v1.0.5',
          assets: [
            {
              name: 'deck-darwin-x64.tgz',
              browser_download_url: 'https://x/x64',
            },
          ],
        },
      ],
      'deck-darwin-arm64.tgz'
    )
  ).toBeNull();
});
