import { describe, expect, it, vi } from 'vitest';

import { loadOnce } from './import-cache';

// `loadOnce` is the plain module-level Map that replaces a data-fetching
// library's cache hook as an import cache: it dedupes concurrent/duplicate
// loads for the same key, and evicts a rejected load so a later retry
// re-invokes the loader instead of replaying the same rejection forever.

describe('loadOnce', () => {
  it('calls the loader once across two concurrent awaited calls with the same key', async () => {
    const loader = vi.fn(() => Promise.resolve({ value: 'loaded' }));

    const [first, second] = await Promise.all([
      loadOnce('same-key', loader),
      loadOnce('same-key', loader),
    ]);

    expect(first).toEqual({ value: 'loaded' });
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('caches a settled load for later calls too, not just concurrent ones', async () => {
    const loader = vi.fn(() => Promise.resolve('settled'));

    const first = await loadOnce('settled-key', loader);
    const second = await loadOnce('settled-key', loader);

    expect(first).toBe('settled');
    expect(second).toBe('settled');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected load so a retry re-invokes the loader', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce('recovered');

    await expect(loadOnce('retry-key', loader)).rejects.toThrow('network blip');
    await expect(loadOnce('retry-key', loader)).resolves.toBe('recovered');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct keys independent', async () => {
    const loaderA = vi.fn(() => Promise.resolve('a'));
    const loaderB = vi.fn(() => Promise.resolve('b'));

    const [a, b] = await Promise.all([
      loadOnce('key-a', loaderA),
      loadOnce('key-b', loaderB),
    ]);

    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });
});
