/** A sheet's pinned panel keeps its measured height on the scroller as
    --sheet-dock-h, the scroll padding the stacked layout reserves for it. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { reserveDock } from '../SheetParts.tsx';
import {
  installFakeResizeObserver,
  observerOf,
  setHeight,
} from './fake-resize-observer.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let restore: () => void;

beforeEach(() => {
  restore = installFakeResizeObserver();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  restore();
});

function Sheet({ panel }: { panel: 'dock' | 'lost' | null }) {
  return (
    <div className="tui-sheet-body">
      {panel === 'dock' && <div className="tui-sheet-dock" ref={reserveDock} />}
      {panel === 'lost' && <div className="tui-sheet-lost" ref={reserveDock} />}
    </div>
  );
}

const render = (panel: 'dock' | 'lost' | null) =>
  React.act(async () => root.render(<Sheet panel={panel} />));

const $ = (selector: string) => container.querySelector(selector);
const reserve = () =>
  ($('.tui-sheet-body') as HTMLElement).style.getPropertyValue(
    '--sheet-dock-h'
  );

async function resize(el: Element | null, height: number) {
  if (!el) throw new Error('no panel');
  setHeight(el, height);
  await React.act(async () => observerOf(el)!.fire());
}

test('the scroller carries the dock height, rounded up, and follows it as it grows', async () => {
  await render('dock');
  await resize($('.tui-sheet-dock'), 184.4);
  expect(reserve()).toBe('185px');
  await resize($('.tui-sheet-dock'), 402);
  expect(reserve()).toBe('402px');
});

test('the lost panel takes over the reserve when it replaces the dock', async () => {
  await render('dock');
  const dock = $('.tui-sheet-dock');
  await resize(dock, 185);
  await render('lost');
  expect(observerOf(dock)).toBeUndefined();
  await resize($('.tui-sheet-lost'), 332);
  expect(reserve()).toBe('332px');
});

test('with no pinned panel the scroller reserves nothing', async () => {
  await render('dock');
  await resize($('.tui-sheet-dock'), 185);
  await render(null);
  expect(reserve()).toBe('');
});
