import { describe, expect, it } from 'vitest';

import { mapLimit } from '../src/server/util/concurrency.js';

describe('mapLimit', () => {
  it('preserves result order regardless of completion order', async () => {
    const out = await mapLimit([1, 2, 3], 2, async n => {
      await new Promise(r => setTimeout(r, n === 1 ? 5 : 0));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30]);
  });

  it('reports a running completed count against a stable total', async () => {
    const seen: Array<[number, number]> = [];
    await mapLimit(
      ['a', 'b', 'c'],
      2,
      async s => s,
      (done, total) => seen.push([done, total])
    );
    expect(seen).toHaveLength(3);
    expect(seen.map(x => x[0]).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(seen.every(([, total]) => total === 3)).toBe(true);
  });
});
