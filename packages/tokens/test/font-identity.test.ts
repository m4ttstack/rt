import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const FONT_FILENAME = 'jetbrains-mono.woff2';

const TOKENS_FONT = join(
  REPO_ROOT,
  'packages',
  'tokens',
  'assets',
  FONT_FILENAME
);
const TOKYO_FONT = join(
  REPO_ROOT,
  'packages',
  'tokyo',
  'src',
  'fonts',
  FONT_FILENAME
);
const TUI_KIT_FONT = join(
  REPO_ROOT,
  'packages',
  'tui-kit',
  'assets',
  'fonts',
  FONT_FILENAME
);

describe('font single-source: jetbrains-mono.woff2', () => {
  it('packages/tokens/assets is byte-identical to packages/tokyo/src/fonts', () => {
    expect(readFileSync(TOKYO_FONT).equals(readFileSync(TOKENS_FONT))).toBe(
      true
    );
  });

  it('packages/tokens/assets is byte-identical to packages/tui-kit/assets/fonts', () => {
    expect(readFileSync(TUI_KIT_FONT).equals(readFileSync(TOKENS_FONT))).toBe(
      true
    );
  });
});
