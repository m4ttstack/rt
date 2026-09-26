import { expect, test } from 'bun:test';

import { createRebuilder } from '../client-assets.ts';

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

test('a burst of pokes inside the delay is one build', async () => {
  let builds = 0;
  const built: number[] = [];
  const r = createRebuilder({
    build: async () => ++builds,
    onBuilt: n => built.push(n),
    onFailed: () => {},
    delayMs: 10,
  });
  r.poke();
  r.poke();
  r.poke();
  await tick(40);
  expect(builds).toBe(1);
  expect(built).toEqual([1]);
});

test('a poke that lands mid-build queues exactly one more build', async () => {
  let builds = 0;
  let release: () => void = () => {};
  const r = createRebuilder({
    build: () =>
      new Promise<number>(resolve => {
        builds++;
        release = () => resolve(builds);
      }),
    onBuilt: () => {},
    onFailed: () => {},
    delayMs: 1,
  });
  r.poke();
  await tick(10);
  expect(builds).toBe(1);
  r.poke();
  r.poke();
  release();
  await tick(10);
  expect(builds).toBe(2);
  release();
  await tick(10);
  expect(builds).toBe(2);
});

test('a failed build is reported and the next poke builds again', async () => {
  let attempt = 0;
  const failures: unknown[] = [];
  const built: string[] = [];
  const r = createRebuilder({
    build: async () => {
      attempt++;
      if (attempt === 1) throw new Error('syntax');
      return 'ok';
    },
    onBuilt: v => built.push(v),
    onFailed: e => failures.push(e),
    delayMs: 1,
  });
  r.poke();
  await tick(10);
  expect(failures).toHaveLength(1);
  expect(built).toEqual([]);
  r.poke();
  await tick(10);
  expect(built).toEqual(['ok']);
});
