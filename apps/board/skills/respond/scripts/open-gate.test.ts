import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

const script = fileURLToPath(new URL('./open-gate.sh', import.meta.url));
const BUDGET = 8192;

type Question = {
  id: string;
  label?: string;
  multi?: boolean;
  context?: string;
  options: unknown[];
};
type Open = { context?: string; questions: Question[] };

const dir = mkdtempSync(join(tmpdir(), 'open-gate-'));
const statusBin = join(dir, 'status-bin');
writeFileSync(
  statusBin,
  `#!/bin/sh
jq -nc '$ARGS.positional' --args -- "$@" >> "$CALLS"
echo '{"gateId":"g-1","presentation":"form"}'
exit "\${STUB_EXIT:-0}"
`
);
chmodSync(statusBin, 0o755);

let n = 0;
const run = (open: Open | string, env: Record<string, string> = {}) => {
  n += 1;
  const file = join(dir, `open-${n}.json`);
  const calls = join(dir, `calls-${n}.jsonl`);
  writeFileSync(file, typeof open === 'string' ? open : JSON.stringify(open));
  writeFileSync(calls, '');
  const proc = Bun.spawnSync(
    ['sh', script, statusBin, '/board/respond/7.json', 'respond-plan', file],
    { env: { ...process.env, CALLS: calls, ...env } }
  );
  const argv = readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as string[]);
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    argv,
  };
};

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const sentQuestions = (argv: string[]) =>
  JSON.parse(flag(argv, '--questions') ?? 'null') as Question[];
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

const thread = (i: number, context: string): Question => ({
  id: `thread-${i}`,
  label: `src/mod${i}.ts:${i * 10}`,
  multi: false,
  context,
  options: [
    { value: `reply:t${i}`, label: 'reply', description: 'reply only' },
    { value: `fix:t${i}`, label: 'fix', description: 'add the guard' },
    { value: `skip:t${i}`, label: 'skip', description: 'no reply' },
  ],
});
const codeChanges: Question = {
  id: 'code-changes',
  label: 'Approve the proposed code changes?',
  multi: false,
  options: ['approve', 'revise', 'skip'],
};

describe('open-gate.sh', () => {
  test('opens an under-budget file exactly as fitted', () => {
    const open: Open = {
      context: '{"gate-ctx":"plan@1","reviewer":"ada","threads":{"total":1}}',
      questions: [
        thread(1, '{"gate-ctx":"thread@1","author":"ada"}'),
        codeChanges,
      ],
    };
    const r = run(open);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('{"gateId":"g-1","presentation":"form"}');
    expect(r.argv).toHaveLength(1);
    const argv = r.argv[0]!;
    expect(argv.slice(0, 5)).toEqual([
      'gate',
      'open',
      '/board/respond/7.json',
      '--kind',
      'respond-plan',
    ]);
    expect(sentQuestions(argv)).toEqual(open.questions);
    expect(flag(argv, '--context')).toBe(open.context);
  });

  test('drops the pane-only next question and nothing else', () => {
    const reply = (n: number): Question => ({
      id: `thread-${n}`,
      label: `src/mod${n}.ts:10`,
      multi: true,
      context: `{"gate-ctx":"reply@1","thread":"t${n}","file":"src/mod${n}.ts:10","verb":"reply","text":"done"}`,
      options: [
        { value: `post:t${n}`, label: 'post' },
        { value: `resolve:t${n}`, label: 'resolve' },
      ],
    });
    const next: Question = {
      id: 'next',
      label: 'Next',
      multi: false,
      options: ['proceed', 'iterate', 'hold'],
    };
    const r = run({
      context: '{"gate-ctx":"post@1"}',
      questions: [reply(1), reply(2), next],
    });
    expect(r.exitCode).toBe(0);
    expect(sentQuestions(r.argv[0]!)).toEqual([reply(1), reply(2)]);
  });

  test('over budget: drops whole contexts largest-first, ties to the earliest, until under', () => {
    const prose = (i: number, size: number) =>
      `thread ${i}: ${'x'.repeat(size)}`.slice(0, size);
    const sizes = [900, 700, 900, 800, 850, 850, 850, 850, 850, 800];
    const questions = sizes.map((s, i) => thread(i + 1, prose(i + 1, s)));
    const context = 'Responding to ada · 10 threads';
    const total = bytes(context) + sizes.reduce((sum, s) => sum + s, 0);
    expect(total).toBeGreaterThanOrEqual(BUDGET);

    const r = run({ context, questions: [...questions, codeChanges] });
    expect(r.exitCode).toBe(0);
    const sent = sentQuestions(r.argv[0]!);
    const dropped = sent
      .filter(q => q.id.startsWith('thread-') && !('context' in q))
      .map(q => q.id);
    expect(dropped).toEqual(['thread-1']);
    expect(sent[2]!.context).toBe(questions[2]!.context);
    expect(
      bytes(flag(r.argv[0]!, '--context')!) +
        sent.reduce((sum, q) => sum + bytes(q.context ?? ''), 0)
    ).toBeLessThan(BUDGET);
    expect(sent.map(q => q.id)).toEqual([
      ...questions.map(q => q.id),
      'code-changes',
    ]);
    expect(sent.map(q => q.options)).toEqual([
      ...questions.map(q => q.options),
      codeChanges.options,
    ]);
  });

  test('keeps dropping until the total is under budget', () => {
    const questions = [1, 2, 3].map(i => thread(i, 'y'.repeat(5000 + i)));
    const r = run({ context: 'ctx', questions });
    const sent = sentQuestions(r.argv[0]!);
    expect(sent.map(q => 'context' in q)).toEqual([true, false, false]);
  });

  test('a file with no gate context opens without --context', () => {
    const r = run({ questions: [codeChanges] });
    expect(r.exitCode).toBe(0);
    expect(r.argv[0]).not.toContain('--context');
  });

  test("passes the status-bin's failure through so degraded mode can see it", () => {
    const r = run(
      { context: 'c', questions: [codeChanges] },
      { STUB_EXIT: '3' }
    );
    expect(r.exitCode).toBe(3);
  });

  test('refuses a file that is not a gate open, without calling the status-bin', () => {
    const r = run('not json');
    expect(r.exitCode).toBe(1);
    expect(r.argv).toHaveLength(0);
    expect(run({ context: 'c' } as Open).exitCode).toBe(1);
  });

  test('usage error on the wrong argument count', () => {
    const proc = Bun.spawnSync(['sh', script, statusBin]);
    expect(proc.exitCode).toBe(2);
  });
});
