import { describe, expect, test } from 'bun:test';
import { startWatcherLoop, type LoopTick } from '../src/EventsWatcher.ts';

const cursor = { since: '2026-08-06T00:00:00Z', lastEventId: '1', seenIds: ['1'] };
const batch = { invalidations: [{ kind: 'mr' as const, ref: '1', cause: 'opened' }], syncedAt: 'x', cursor };

function waitTicks(n: number, results: LoopTick[]): Promise<LoopTick[]> {
  // helper used below: run the loop with a 5ms interval until n ticks consumed, then dispose
  return new Promise((resolve) => {
    const consumed: LoopTick[] = [];
    const dispose = startWatcherLoop(
      async () => {
        const r = results.shift() ?? { batch: null, cursor };
        consumed.push(r);
        if (consumed.length >= n) setTimeout(() => { dispose(); resolve(consumed); }, 0);
        return r;
      },
      { intervalMs: 5 },
      () => {},
    );
  });
}

describe('startWatcherLoop', () => {
  test('a null batch is not delivered, a real batch is', async () => {
    const delivered: unknown[] = [];
    await new Promise<void>((resolve) => {
      const dispose = startWatcherLoop(
        (() => {
          let n = 0;
          return async (): Promise<LoopTick> => {
            n++;
            if (n === 3) { setTimeout(() => { dispose(); resolve(); }, 0); }
            return n === 2 ? { batch, cursor } : { batch: null, cursor };
          };
        })(),
        { intervalMs: 5 },
        (b) => delivered.push(b),
      );
    });
    expect(delivered).toEqual([batch]);
  });

  test('nextIntervalMs overrides the configured interval for the following wait', async () => {
    const stamps: number[] = [];
    await new Promise<void>((resolve) => {
      let n = 0;
      const dispose = startWatcherLoop(
        async (): Promise<LoopTick> => {
          stamps.push(Date.now());
          n++;
          if (n === 3) { setTimeout(() => { dispose(); resolve(); }, 0); }
          // first tick asks for a 60ms wait; ticks otherwise run at 5ms
          return { batch: null, cursor, nextIntervalMs: n === 1 ? 60 : undefined };
        },
        { intervalMs: 5 },
        () => {},
      );
    });
    const gap1 = stamps[1]! - stamps[0]!;
    const gap2 = stamps[2]! - stamps[1]!;
    expect(gap1).toBeGreaterThanOrEqual(45); // 60ms requested, jitter is ±10%
    expect(gap2).toBeLessThan(45);           // back to the 5ms configured interval
  });

  test('dispose stops the loop', async () => {
    let ticks = 0;
    const dispose = startWatcherLoop(async () => { ticks++; return { batch: null, cursor }; }, { intervalMs: 5 }, () => {});
    await new Promise((r) => setTimeout(r, 20));
    dispose();
    const at = ticks;
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(at);
  });
});
