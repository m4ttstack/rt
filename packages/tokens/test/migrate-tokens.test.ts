import { describe, expect, it } from 'vitest';

import {
  planRenames,
  renameInTsx,
  rewriteCss,
} from '../scripts/migrate-tokens.ts';

describe('planRenames', () => {
  it('renames by property class and infers the band from the rule', () => {
    const css = `.a { font-size: 13.26px; color: var(--muted-text); background: var(--accent); }`;
    const r = planRenames(css, 17);
    expect(r.map(x => [x.property, x.from, x.to, x.band])).toEqual([
      ['color', '--muted-text', '--text-3', 'meta'],
      ['background', '--accent', '--fill-accent', null],
    ]);
    expect(rewriteCss(css, 17).renames).toEqual(r);
  });

  it('inherits font-size from a prefix selector in the same file and maps type steps by name', () => {
    const css = `.row { font-size: var(--type-small); } .row-meta { color: var(--fg); } .x { color: var(--accent); font-size: var(--type-body); }`;
    const r = planRenames(css, 17);
    expect(r.find(x => x.from === '--fg')).toMatchObject({
      to: '--text-1',
      band: 'small',
    });
    expect(r.find(x => x.from === '--accent')).toMatchObject({
      to: '--text-accent',
      band: 'body',
    });
  });

  it('marks a colour rename with no size as unresolved and defaults it to the meta or small token', () => {
    const css = `.a { color: var(--muted); } .b { color: var(--green); }`;
    const r = planRenames(css, 17);
    expect(r[0]).toMatchObject({
      to: '--text-3',
      band: null,
      unresolved: true,
    });
    expect(r[1]).toMatchObject({
      to: '--text-ok-small',
      band: null,
      unresolved: true,
    });
  });

  it('leaves --muted alone outside color and turns dots into fills', () => {
    const css = `.a { border: 1px solid var(--muted); background: var(--dot-ok); }`;
    const r = planRenames(css, 17);
    expect(r).toEqual([
      expect.objectContaining({
        property: 'background',
        from: '--dot-ok',
        to: '--fill-ok',
      }),
    ]);
  });

  it('uses the hover fill inside :hover rules', () => {
    const css = `.a:hover { background: var(--accent); }`;
    expect(planRenames(css, 17)[0]).toMatchObject({
      to: '--fill-accent-hover',
    });
  });

  it('renames tokyo mirrors and style-object strings in tsx', () => {
    const src = `const s = { color: 'var(--tk-muted-text)', background: 'var(--tk-accent)', fontSize: 'var(--tk-fs-3xs)' };`;
    const { out, renames, unresolved } = renameInTsx(src);
    expect(out).toContain(`color: 'var(--tk-text-4)'`);
    expect(out).toContain(`background: 'var(--tk-fill-accent)'`);
    expect(renames).toEqual([
      expect.objectContaining({
        property: 'color',
        from: '--tk-muted-text',
        to: '--tk-text-4',
      }),
      expect.objectContaining({
        property: 'background',
        from: '--tk-accent',
        to: '--tk-fill-accent',
      }),
    ]);
    expect(unresolved).toEqual([]);
  });

  it('does not inherit font-size from a selector that is merely a string prefix', () => {
    const css = `.row { font-size: var(--type-small); } .rowdy { color: var(--muted-text); }`;
    const r = planRenames(css, 17);
    expect(r.find(x => x.from === '--muted-text')).toMatchObject({
      to: '--text-3',
      band: null,
      unresolved: true,
    });
  });

  it('rewrites the fallback and exact var() forms by source position, not by which form matches first', () => {
    const css = `.a { font-size: 12px; color: var(--accent, red); background: var(--accent); }`;
    const { out } = rewriteCss(css, 17);
    expect(out).toContain(`color: var(--text-accent-small, red)`);
    expect(out).toContain(`background: var(--fill-accent)`);
  });

  it('does not double-count a nested &:hover rule and keeps the hover fill', () => {
    const css = `.btn { font-size: 14px; background: var(--tk-accent); &:hover { background: var(--tk-accent); } }`;
    const r = planRenames(css, 16);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ to: '--tk-fill-accent' });
    expect(r[1]).toMatchObject({ to: '--tk-fill-accent-hover' });
    const { out } = rewriteCss(css, 16);
    expect(out).toContain('background: var(--tk-fill-accent);');
    expect(out).toContain('background: var(--tk-fill-accent-hover);');
  });

  it('recovers every sibling non-& nested rule from one Raw block, not just the first', () => {
    const css = [
      '.card {',
      '  font-size: 12px;',
      '  color: var(--tk-fg);',
      '  .label {',
      '    color: var(--tk-muted-text);',
      '  }',
      '  .other {',
      '    color: var(--tk-accent);',
      '  }',
      '}',
    ].join('\n');
    const r = planRenames(css, 16);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({
      from: '--tk-fg',
      to: '--tk-text-1',
      line: 3,
    });
    expect(r[1]).toMatchObject({
      from: '--tk-muted-text',
      to: '--tk-text-4',
      unresolved: false,
      line: 5,
    });
    expect(r[2]).toMatchObject({
      from: '--tk-accent',
      to: '--tk-text-accent-small',
      unresolved: false,
      line: 8,
    });
    const { out } = rewriteCss(css, 16);
    const lines = out.split('\n');
    expect(lines[2]).toBe('  color: var(--tk-text-1);');
    expect(lines[4]).toBe('    color: var(--tk-text-4);');
    expect(lines[7]).toBe('    color: var(--tk-text-accent-small);');
  });

  it('recovers a declaration after a nested rule without recursing forever', () => {
    const css = [
      '.card {',
      '  font-size: 12px;',
      '  .label { color: var(--tk-muted-text); }',
      '  color: var(--tk-fg);',
      '}',
    ].join('\n');
    const start = performance.now();
    const r = planRenames(css, 16);
    expect(performance.now() - start).toBeLessThan(200);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      from: '--tk-muted-text',
      to: '--tk-text-4',
      band: 'small',
      line: 3,
    });
    expect(r[1]).toMatchObject({
      from: '--tk-fg',
      to: '--tk-text-1',
      line: 4,
    });
    const { out, leftover } = rewriteCss(css, 16);
    const lines = out.split('\n');
    expect(lines[2]).toBe('  .label { color: var(--tk-text-4); }');
    expect(lines[3]).toBe('  color: var(--tk-text-1);');
    expect(leftover).toEqual([]);
  });

  it('routes dot tokens to hue text in color and keeps them as fill elsewhere', () => {
    const css = `.a { color: var(--dot-bad); font-size: 15px; } .b { background: var(--dot-bad); }`;
    const r = planRenames(css, 17);
    expect(r.find(x => x.property === 'color')).toMatchObject({
      to: '--text-bad',
      band: 'body',
      unresolved: false,
    });
    expect(r.find(x => x.property === 'background')).toMatchObject({
      to: '--fill-bad',
    });
  });

  it('renames --ui-text-dimmed and leaves --ui-text-muted untouched', () => {
    const css = `.a { color: var(--ui-text-dimmed); } .b { color: var(--ui-text-muted); }`;
    const r = planRenames(css, 17);
    expect(r).toEqual([
      expect.objectContaining({
        from: '--ui-text-dimmed',
        to: '--ui-text-4',
        unresolved: false,
      }),
    ]);
    const { out } = rewriteCss(css, 17);
    expect(out).toContain(`color: var(--ui-text-4)`);
    expect(out).toContain(`color: var(--ui-text-muted)`);
  });

  it('leaves --surface-inset and --surface-overlay alone (nothing emits them) and still renames --bg', () => {
    const css = `.a { background: var(--surface-inset); } .b { background: var(--surface-overlay); } .c { background: var(--bg); }`;
    const r = planRenames(css, 17);
    expect(r).toEqual([
      expect.objectContaining({ from: '--bg', to: '--page' }),
    ]);
    const { out } = rewriteCss(css, 17);
    expect(out).toContain(`background: var(--surface-inset)`);
    expect(out).toContain(`background: var(--surface-overlay)`);
    expect(out).toContain(`background: var(--page)`);
  });
});

describe('leftover reporting', () => {
  it('reports a const assignment and a ternary that the tsx regex cannot reach, with zero renames', () => {
    const src = [
      `const MUTED = 'var(--tk-muted-text)';`,
      `const label = active ? 'var(--tk-fg)' : 'plain';`,
    ].join('\n');
    const { renames, leftover } = renameInTsx(src);
    expect(renames).toEqual([]);
    expect(leftover).toEqual([
      { line: 1, text: `const MUTED = 'var(--tk-muted-text)';` },
      {
        line: 2,
        text: `const label = active ? 'var(--tk-fg)' : 'plain';`,
      },
    ]);
  });

  it('reports a declaration directly inside a nested at-rule that collectRules never visits', () => {
    const css = `.a { @media (min-width: 1px) { color: var(--fg); } }`;
    const { leftover } = rewriteCss(css, 17);
    expect(leftover).toEqual([{ line: 1, text: css }]);
  });

  it('reports nothing once every var has already been rewritten', () => {
    const css = `.a { color: var(--text-1); background: var(--fill-accent); }`;
    const { leftover } = rewriteCss(css, 17);
    expect(leftover).toEqual([]);
  });

  it('never flags --muted outside color, the neutral fill that legitimately stays', () => {
    const css = `.a { border: 1px solid var(--muted); }`;
    const { renames, leftover } = rewriteCss(css, 17);
    expect(renames).toEqual([]);
    expect(leftover).toEqual([]);
  });
});
