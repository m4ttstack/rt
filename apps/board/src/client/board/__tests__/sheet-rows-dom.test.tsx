/** A dock row's path wraps only between segments: a break opportunity after
    each slash, the full text kept in the title. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { SheetRows } from '../SheetParts.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const render = async (text: string, title?: string) => {
  await React.act(async () => {
    root.render(
      <SheetRows
        card="responses"
        rows={[
          {
            key: 'r1',
            text,
            ...(title ? { title } : {}),
            chips: [{ text: 'post', intent: 'ok' }],
          },
        ]}
      />
    );
  });
  return container.querySelector<HTMLElement>('.tui-sheet-card-text')!;
};

test('a path breaks only after each slash', async () => {
  const cell = await render('src/highlights/temperature.ts:42');
  const breaks = [...cell.querySelectorAll('wbr')];
  expect(breaks).toHaveLength(2);
  expect(breaks.map(b => b.previousSibling?.textContent)).toEqual([
    'src/',
    'highlights/',
  ]);
  expect(breaks[1]!.nextSibling?.textContent).toBe('temperature.ts:42');
  expect(cell.textContent).toBe('src/highlights/temperature.ts:42');
  expect(cell.title).toBe('src/highlights/temperature.ts:42');
});

test('text without a slash gains no break opportunity', async () => {
  const cell = await render('legend.tsx:31');
  expect(cell.querySelectorAll('wbr')).toHaveLength(0);
  expect(cell.textContent).toBe('legend.tsx:31');
  expect(cell.title).toBe('legend.tsx:31');
});

test('an explicit title wins over the row text', async () => {
  const cell = await render('a/b.ts:1', 'the whole question');
  expect(cell.querySelectorAll('wbr')).toHaveLength(1);
  expect(cell.title).toBe('the whole question');
});
