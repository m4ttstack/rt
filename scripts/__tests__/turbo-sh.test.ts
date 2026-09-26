import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, userInfo } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { realIds, ROOT, type DryRun } from './helpers.ts';

const SCRIPT = join(ROOT, 'scripts', 'turbo.sh');

function run(
  args: string[],
  opts: { uname?: string; env?: Record<string, string> } = {}
) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...opts.env,
    TURBO_TELEMETRY_DISABLED: '1',
  };
  let bin: string | undefined;
  try {
    if (opts.uname) {
      bin = mkdtempSync(join(tmpdir(), 'fake-uname-'));
      writeFileSync(join(bin, 'uname'), `#!/bin/sh\necho ${opts.uname}\n`);
      chmodSync(join(bin, 'uname'), 0o755);
      env.PATH = `${bin}:${process.env.PATH}`;
    }
    const proc = Bun.spawnSync(['bash', SCRIPT, ...args], { cwd: ROOT, env });
    return {
      code: proc.exitCode,
      out: proc.stdout.toString(),
      err: proc.stderr.toString(),
    };
  } finally {
    if (bin) rmSync(bin, { recursive: true, force: true });
  }
}

// `check --dry=json` prints one JSON document per turbo invocation; each
// ends with a closing brace followed by a blank line.
function documents(out: string): DryRun[] {
  return out
    .split(/\n}\s*\n(?=\{)/)
    .map((chunk, i, all) => (i < all.length - 1 ? `${chunk}\n}` : chunk))
    .map(chunk => JSON.parse(chunk.slice(chunk.indexOf('{'))) as DryRun);
}

const commonDir = Bun.spawnSync(
  ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  {
    cwd: ROOT,
  }
)
  .stdout.toString()
  .trim();

describe('scripts/turbo.sh', () => {
  test('caches under the repo common git dir', () => {
    const dry = run(['typecheck', '--filter=@mattstack/tokens', '--dry=json']);
    expect(dry.code, dry.err).toBe(0);
    const { hash } = documents(dry.out)[0].tasks.find(
      t => t.taskId === '@mattstack/tokens#typecheck'
    )!;
    // tsc is a node script; a version-manager node shim on PATH cannot start
    // under the HOME the root preload repoints, so this call needs the real one.
    const r = run(
      ['typecheck', '--filter=@mattstack/tokens', '--output-logs=none'],
      { env: { HOME: userInfo().homedir } }
    );
    expect(r.code, r.err).toBe(0);
    expect(
      existsSync(join(commonDir, 'turbo-cache', `${hash}-meta.json`))
    ).toBe(true);
  }, 30_000);

  test('check runs codegen gates, then package gates, then root gates and the tokens suite', () => {
    const r = run(['check', '--dry=json']);
    expect(r.code, r.err).toBe(0);
    const docs = documents(r.out);
    expect(docs).toHaveLength(3);
    const [codegen, pkgs, roots] = docs;
    expect(realIds(codegen)).toEqual([
      '//#tokens:fresh',
      '@mattstack/tui-kit#gates',
    ]);
    const pkgIds = realIds(pkgs);
    expect(pkgIds).toContain('board#test');
    expect(pkgIds).toContain('chat#serve-check');
    expect(pkgIds).not.toContain('@mattstack/tui-kit#gates');
    expect(realIds(roots)).toEqual([
      '//#build-storybook',
      '//#format:check',
      '//#lint:root',
      '//#purity',
      '//#scripts:test',
      '//#treeshake',
      '@mattstack/tokens#test',
      '@mattstack/tui-kit#build',
    ]);
  });

  test('check keeps deck on macOS and drops it elsewhere', () => {
    const mac = documents(
      run(['check', '--dry=json'], { uname: 'Darwin' }).out
    )[1];
    const linux = documents(
      run(['check', '--dry=json'], { uname: 'Linux' }).out
    )[1];
    expect(realIds(mac)).toContain('deck#test');
    expect(realIds(linux)).not.toContain('deck#test');
  });

  test('check --affected still runs the codegen and root gates', () => {
    const r = run(['check', '--affected', '--dry=json'], {
      env: { TURBO_SCM_BASE: 'HEAD' },
    });
    expect(r.code, r.err).toBe(0);
    const [codegen, , roots] = documents(r.out);
    expect(realIds(codegen)).toEqual([
      '//#tokens:fresh',
      '@mattstack/tui-kit#gates',
    ]);
    expect(realIds(roots)).toContain('//#purity');
    expect(realIds(roots)).toContain('@mattstack/tokens#test');
  });
});
