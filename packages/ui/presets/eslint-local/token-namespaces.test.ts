import css from '@eslint/css';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import tokenNamespacesCss from './token-namespaces-css.js';
import tokenNamespacesTsx from './token-namespaces-tsx.js';
import { classifyTokenUse } from './token-namespaces.js';

describe('classifyTokenUse', () => {
  it('lets text tokens colour text', () => {
    expect(classifyTokenUse('color', '--text-3')).toBeNull();
    expect(classifyTokenUse('color', '--text-ok-small')).toBeNull();
  });

  it('rejects text tokens as backgrounds and fills as text', () => {
    expect(classifyTokenUse('background', '--text-3')).toMatch(
      /--text-\* is for color/
    );
    expect(classifyTokenUse('color', '--fill-warn')).toMatch(
      /--fill-\* is never a text colour/
    );
  });

  it('lets surfaces be backgrounds and fills, nothing else', () => {
    expect(classifyTokenUse('background', '--surface-card')).toBeNull();
    expect(
      classifyTokenUse('background-color', '--surface-wash-fg-8')
    ).toBeNull();
    expect(classifyTokenUse('fill', '--surface-panel')).toBeNull();
    expect(classifyTokenUse('color', '--surface-card')).toMatch(
      /--surface-\* is for background/
    );
    expect(classifyTokenUse('border-color', '--surface-card')).toMatch(
      /--surface-\* is for background/
    );
  });

  it('rejects the numeric ramp steps everywhere', () => {
    expect(classifyTokenUse('background', '--surface-1')).toMatch(
      /only the tokens file/
    );
    expect(classifyTokenUse('border', '--line-2')).toMatch(
      /only the tokens file/
    );
  });

  it('lets border tokens draw borders, outlines and scrollbars', () => {
    expect(classifyTokenUse('border', '--border')).toBeNull();
    expect(classifyTokenUse('border-top-color', '--border-soft')).toBeNull();
    expect(classifyTokenUse('outline-color', '--border-control')).toBeNull();
    expect(classifyTokenUse('scrollbar-color', '--border-on-card')).toBeNull();
    expect(classifyTokenUse('background', '--border-soft')).toMatch(
      /--border-\* is for border/
    );
  });

  it('ignores alias declarations, line-height and unrelated tokens', () => {
    expect(classifyTokenUse('--gate-muted', '--text-muted-on-card')).toBeNull();
    expect(classifyTokenUse('line-height', '--line-height-base')).toBeNull();
    expect(classifyTokenUse('color', '--muted')).toBeNull();
  });

  it('rejects the legacy fill aliases as text, allows them elsewhere', () => {
    expect(classifyTokenUse('color', '--accent')).toMatch(
      /aliases the accent fill/
    );
    expect(classifyTokenUse('color', '--amber')).toMatch(/--text-warn/);
    expect(classifyTokenUse('color', '--red')).toMatch(/--text-bad/);
    expect(classifyTokenUse('background', '--amber')).toBeNull();
    expect(classifyTokenUse('border-color', '--red')).toBeNull();
  });
});

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// RuleTester.run creates its own describe/it blocks from the vitest globals
// (`globals: true` in packages/ui/vitest.config.ts); wrapping it in an it()
// makes vitest throw "Calling the suite function inside test function is
// not allowed", so the run call sits directly in the describe body.
describe('local/token-namespaces (tsx)', () => {
  tester.run('token-namespaces', tokenNamespacesTsx, {
    valid: [
      {
        code: 'const s = { color: "var(--text-3)", background: "var(--card)" };',
      },
      { code: 'const s = { borderColor: `1px solid var(--border-soft)` };' },
      { code: 'const s = { "--gate-muted": "var(--text-muted-on-card)" };' },
      // on-fill label tokens are legal as a text colour; the classifier
      // must not treat --on-fill-* as a --fill-* misuse by prefix overlap.
      { code: 'const s = { color: "var(--on-fill-warn)" };' },
      // a var() named only inside a comment is not code; the ESTree
      // walker never visits comment tokens as Property nodes.
      {
        code: '// color: var(--fill-warn)\nconst s = { color: "var(--text-3)" };',
      },
      {
        code: '/* color: var(--fill-warn) */\nconst s = { color: "var(--text-3)" };',
      },
    ],
    invalid: [
      {
        code: 'const s = { color: "var(--fill-warn)" };',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: 'const s = { color: "var(--amber)" };',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: 'const s = { background: "var(--surface-2)" };',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: 'const s = { backgroundColor: `var(--text-2)` };',
        errors: [{ messageId: 'misuse' }],
      },
    ],
  });
});

const cssTester = new RuleTester({
  plugins: { css },
  language: 'css/css',
});

describe('local/token-namespaces-css', () => {
  cssTester.run('token-namespaces-css', tokenNamespacesCss, {
    valid: [
      { code: '.a { color: var(--text-3); background: var(--card); }' },
      {
        code: '.a { border: 1px solid var(--border-soft); outline: 2px solid var(--border-control); }',
      },
      { code: '.a { --gate-muted: var(--text-muted-on-card); }' },
      {
        code: '.a { background: color-mix(in srgb, var(--fill-warn) 9%, transparent); }',
      },
      // a fill token painting a border is common and legal; only the
      // literal `color` property is banned for --fill-*, not the
      // `border-color` tail a substring match on "color:" would catch.
      { code: '.a { border-color: var(--fill-accent); }' },
      // a var() named only inside a CSS comment is not a declaration.
      {
        code: '.a { /* color: var(--fill-warn); */ background: var(--card); }',
      },
      // on-fill label tokens are legal as text colour.
      { code: '.a { color: var(--on-fill-warn); }' },
      // legacy fill aliases stay legal in washes and edges, like --fill-*.
      {
        code: '.a { background: color-mix(in srgb, var(--accent) 14%, transparent); }',
      },
    ],
    invalid: [
      {
        code: '.a { color: var(--fill-warn); }',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: '.a { color: var(--red); }',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: '.a { color: color-mix(in srgb, var(--fill-warn) 86%, #000); }',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: '.a { background: var(--surface-1); }',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: '.a { border-color: var(--surface-card); }',
        errors: [{ messageId: 'misuse' }],
      },
      {
        code: '.a { background: var(--text-2); }',
        errors: [{ messageId: 'misuse' }],
      },
    ],
  });
});
