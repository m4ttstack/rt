/** DOM-level test for GateRowChips: a row's whole gate face is chips, never
    an inline form -- the questionnaire only mounts inside the decision
    queue modal now. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let GateRowChips: typeof import('../GateRowChips.tsx').GateRowChips;
type GateRow = import('../../../gates/store.ts').GateRow;

beforeAll(async () => {
  // Dynamic, so it resolves only after GlobalRegistrator.register() above --
  // a static top-of-file import would run before that call and see no DOM.
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ GateRowChips } = await import('../GateRowChips.tsx'));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const openGate: GateRow = {
  gateId: 'g-open',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/1',
  kind: 'self-review',
  label: 'self-review',
  status: 'open',
  openedAt: 0,
  questions: [
    {
      id: 'verdict',
      label: 'Ready to merge?',
      multi: false,
      options: ['approve', 'changes'],
    },
  ],
};

const answeredGate: GateRow = {
  gateId: 'g-answered',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/1',
  kind: 'self-review',
  label: 'self-review',
  status: 'answered',
  openedAt: 0,
  questions: [
    {
      id: 'verdict',
      label: 'Ready to merge?',
      multi: false,
      options: ['approve', 'changes'],
    },
  ],
  answers: { verdict: 'approve' },
  answeredBy: 'pane',
  answeredAt: 0,
};

const stuckGate: GateRow = {
  ...answeredGate,
  gateId: 'g-stuck',
  delivery: { outcome: 'stuck', at: 0 },
};

const unassignedGate: GateRow = {
  ...answeredGate,
  gateId: 'g-unassigned',
  execution: 'unassigned',
};

test('rows render chips, not forms', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const opened: string[] = [];
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(
        React.createElement(GateRowChips, {
          gates: [openGate, answeredGate],
          onOpenGate: (gateId: string) => opened.push(gateId),
        })
      );
    });

    expect(container.querySelector('.tui-gate-form')).toBeNull();

    const chip = container.querySelector('[data-gate-id="g-open"]');
    expect(chip).not.toBeNull();
    (chip as HTMLElement).click();
    expect(opened).toEqual(['g-open']);

    expect(container.querySelector('[data-gate="chip"]')).not.toBeNull();
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('a stuck-delivery answered gate renders the stuck message as an openable chip', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const opened: string[] = [];
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(
        React.createElement(GateRowChips, {
          gates: [stuckGate],
          onOpenGate: (gateId: string) => opened.push(gateId),
        })
      );
    });

    const chip = container.querySelector('[data-gate-delivery="stuck"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.toLowerCase()).toContain(
      "pane didn't pick up the answer"
    );
    (chip as HTMLElement).click();
    expect(opened).toEqual(['g-stuck']);
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('an unassigned-execution answered gate renders the unassigned message as an openable chip', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const opened: string[] = [];
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(
        React.createElement(GateRowChips, {
          gates: [unassignedGate],
          onOpenGate: (gateId: string) => opened.push(gateId),
        })
      );
    });

    const chip = container.querySelector('[data-gate-execution="unassigned"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.toLowerCase()).toContain(
      'answered, no pane to execute'
    );
    (chip as HTMLElement).click();
    expect(opened).toEqual(['g-unassigned']);
  } finally {
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
