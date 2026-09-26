/** Keyboard focus in the full-screen GateSheet: Tab never leaves the
    sheet, and paging (which remounts the face, keyed by gate) keeps focus
    on the chevron that was pressed. Rendered in StrictMode, as the board
    is, since its doubled effects are what a focus handoff must survive. */

import React, { StrictMode, useState } from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { GateSheet } = await import('../GateSheet.tsx');

function Paged({ total }: { total: number }) {
  const [index, setIndex] = useState(0);
  return (
    <GateSheet
      key={index}
      variant="triage"
      ariaLabel="decision queue"
      queue={{
        index,
        total,
        states: Array.from({ length: total }, (_, i) =>
          i === index ? 'active' : 'todo'
        ),
        canPrev: index > 0,
        canNext: index < total - 1,
        onPrev: () => setIndex(i => i - 1),
        onNext: () => setIndex(i => i + 1),
      }}
      onClose={() => {}}
    >
      <input aria-label={`gate ${index + 1} field`} />
    </GateSheet>
  );
}

let root: Root;
let container: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  opener = document.createElement('button');
  opener.textContent = 'open queue';
  document.body.appendChild(opener);
  opener.focus();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  opener.remove();
});

async function show(total: number) {
  await React.act(async () =>
    root.render(
      <StrictMode>
        <Paged total={total} />
      </StrictMode>
    )
  );
}

async function clickSettled(el: HTMLElement) {
  await React.act(async () => el.click());
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const $ = (selector: string) =>
  document.body.querySelector(selector) as HTMLElement;

async function press(el: HTMLElement, key: string, shiftKey = false) {
  await React.act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
    );
  });
}

test('Shift+Tab from the sheet itself wraps to its last control, never the page behind', async () => {
  await show(3);
  const sheet = $('.tui-gate-sheet');
  expect(document.activeElement).toBe(sheet);
  await press(sheet, 'Tab', true);
  expect(document.activeElement).toBe($('[aria-label="gate 1 field"]'));
});

test('paging keeps focus on the chevron that was pressed', async () => {
  await show(4);
  await clickSettled($('[aria-label="next gate"]'));
  await clickSettled($('[aria-label="next gate"]'));
  expect($('[aria-label="gate 3 field"]')).not.toBeNull();
  expect(document.activeElement).toBe($('[aria-label="next gate"]'));
  await clickSettled($('[aria-label="previous gate"]'));
  expect($('[aria-label="gate 2 field"]')).not.toBeNull();
  expect(document.activeElement).toBe($('[aria-label="previous gate"]'));
});

test('a chevron disabled by the page it lands on hands focus to the sheet', async () => {
  await show(2);
  await clickSettled($('[aria-label="next gate"]'));
  expect(document.activeElement).toBe($('.tui-gate-sheet'));
});

test('closing after paging returns focus to what opened the queue', async () => {
  await show(3);
  await clickSettled($('[aria-label="next gate"]'));
  await React.act(async () => root.render(<></>));
  expect(document.activeElement).toBe(opener);
});
