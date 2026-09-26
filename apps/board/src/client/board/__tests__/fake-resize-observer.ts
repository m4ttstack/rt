/** A ResizeObserver the test fires by hand, since happy-dom does no layout. */

import React from 'react';

class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];
  observed: Element[] = [];
  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.live.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.live = FakeResizeObserver.live.filter(o => o !== this);
  }
  fire() {
    this.callback();
  }
}

/** Installs the fake for one test; the returned function puts the real one
    (or its absence) back. */
function installFakeResizeObserver(): () => void {
  const g = globalThis as { ResizeObserver?: unknown };
  const had = 'ResizeObserver' in g;
  const real = g.ResizeObserver;
  FakeResizeObserver.live = [];
  g.ResizeObserver = FakeResizeObserver;
  return () => {
    if (had) g.ResizeObserver = real;
    else delete g.ResizeObserver;
  };
}

/** The live observer watching `el`, if any. */
const observerOf = (el: Element | null) =>
  FakeResizeObserver.live.find(o => el !== null && o.observed.includes(el));

/** Gives `el` a laid-out height, as the browser would report it. */
function setHeight(el: Element, height: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      height,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
    }) as DOMRect;
}

/** Resizes the pinned panel matching `selector` and reads back what its
    scroller reserves; throws when nothing observes the panel. */
async function reserveOf(selector: string, height: number): Promise<string> {
  const panel = document.body.querySelector(selector);
  if (!panel) throw new Error(`no ${selector}`);
  const observer = observerOf(panel);
  if (!observer) throw new Error(`nothing observes ${selector}`);
  setHeight(panel, height);
  await React.act(async () => observer.fire());
  return (
    panel.closest('.tui-sheet-body') as HTMLElement
  ).style.getPropertyValue('--sheet-dock-h');
}

export { installFakeResizeObserver, observerOf, reserveOf, setHeight };
