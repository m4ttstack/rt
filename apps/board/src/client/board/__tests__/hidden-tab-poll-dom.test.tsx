/** DOM-level test for useBoardData's 60s poll while the tab is hidden: a
    background tab must still refresh occasionally (so a re-focus can catch
    up the stale-tab mark), just far less often than a visible one. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
  ],
  mrs: [],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: { single: '{title}', multiHeader: '', multiItem: '' },
  dataSyncedAt: Date.now(),
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let dataFetchCount = 0;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json')) {
      dataFetchCount += 1;
      return new Response(JSON.stringify(BOARD_DATA), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  dataFetchCount = 0;
  localStorage.clear();
  history.replaceState(null, '', '/');
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

/** True/false via a getter so `document.hidden` reflects `hidden` on every
    read, the way the real Page Visibility API does. */
function stubHidden(): { set: (v: boolean) => void; restore: () => void } {
  let hidden = false;
  const original = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'hidden'
  );
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  return {
    set: (v: boolean) => {
      hidden = v;
    },
    restore: () => {
      if (original)
        Object.defineProperty(Document.prototype, 'hidden', original);
      else delete (document as unknown as { hidden?: boolean }).hidden;
    },
  };
}

interface IntervalCapture {
  captured: (() => void) | null;
  restore: () => void;
}

/** Stubs setInterval/clearInterval for the render so the 60s poll's
    callback can be captured and invoked by hand instead of waiting on a
    real timer. Real intervals are never scheduled; clearInterval is a
    no-op, matching the fake ids this hands out. */
function stubSetInterval(): IntervalCapture {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const result: IntervalCapture = {
    captured: null,
    restore: () => {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
  let nextId = 1;
  (globalThis as unknown as { setInterval: typeof setInterval }).setInterval =
    ((fn: () => void, ms?: number) => {
      if (ms === 60_000 && result.captured === null) result.captured = fn;
      return nextId++ as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
  (
    globalThis as unknown as { clearInterval: typeof clearInterval }
  ).clearInterval = (() => {}) as typeof clearInterval;
  return result;
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('hidden tab: the 60s poll fetches only on the 5th tick', async () => {
  const hiddenCtl = stubHidden();
  const intervalCtl = stubSetInterval();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(flush);
    const initialFetches = dataFetchCount;
    const tick = intervalCtl.captured;
    if (!tick) throw new Error('60s interval callback was never captured');

    hiddenCtl.set(true);

    for (let i = 1; i <= 4; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
      expect(dataFetchCount).toBe(initialFetches);
    }

    await React.act(async () => {
      tick();
      await flush();
    });
    expect(dataFetchCount).toBe(initialFetches + 1);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    intervalCtl.restore();
    hiddenCtl.restore();
  }
});

test('visible tab: the 60s poll fetches on every tick', async () => {
  const hiddenCtl = stubHidden();
  const intervalCtl = stubSetInterval();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(flush);
    const initialFetches = dataFetchCount;
    const tick = intervalCtl.captured;
    if (!tick) throw new Error('60s interval callback was never captured');

    hiddenCtl.set(false);

    for (let i = 1; i <= 3; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
      expect(dataFetchCount).toBe(initialFetches + i);
    }
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    intervalCtl.restore();
    hiddenCtl.restore();
  }
});

test('hidden tick count resets once a visible tick loads', async () => {
  const hiddenCtl = stubHidden();
  const intervalCtl = stubSetInterval();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(flush);
    const initialFetches = dataFetchCount;
    const tick = intervalCtl.captured;
    if (!tick) throw new Error('60s interval callback was never captured');

    hiddenCtl.set(true);
    // Three hidden ticks build up a partial count...
    for (let i = 0; i < 3; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
    }
    expect(dataFetchCount).toBe(initialFetches);

    // ...a visible tick fetches and resets the count...
    hiddenCtl.set(false);
    await React.act(async () => {
      tick();
      await flush();
    });
    expect(dataFetchCount).toBe(initialFetches + 1);

    // ...so the next four hidden ticks stay quiet again, not just one.
    hiddenCtl.set(true);
    for (let i = 0; i < 4; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
    }
    expect(dataFetchCount).toBe(initialFetches + 1);
    await React.act(async () => {
      tick();
      await flush();
    });
    expect(dataFetchCount).toBe(initialFetches + 2);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    intervalCtl.restore();
    hiddenCtl.restore();
  }
});

test('a visibilitychange load also resets the hidden tick count', async () => {
  const hiddenCtl = stubHidden();
  const intervalCtl = stubSetInterval();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Board));
    });
    await React.act(flush);
    const initialFetches = dataFetchCount;
    const tick = intervalCtl.captured;
    if (!tick) throw new Error('60s interval callback was never captured');

    hiddenCtl.set(true);
    // Four hidden ticks build up a partial count...
    for (let i = 0; i < 4; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
    }
    expect(dataFetchCount).toBe(initialFetches);

    // ...a visibilitychange fetch resets the count, not just the interval's
    // own tick path...
    hiddenCtl.set(false);
    await React.act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
    });
    expect(dataFetchCount).toBe(initialFetches + 1);

    // ...so the next four hidden ticks stay quiet again, not just one.
    hiddenCtl.set(true);
    for (let i = 1; i <= 4; i++) {
      await React.act(async () => {
        tick();
        await flush();
      });
      expect(dataFetchCount).toBe(initialFetches + 1);
    }
    await React.act(async () => {
      tick();
      await flush();
    });
    expect(dataFetchCount).toBe(initialFetches + 2);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    intervalCtl.restore();
    hiddenCtl.restore();
  }
});
