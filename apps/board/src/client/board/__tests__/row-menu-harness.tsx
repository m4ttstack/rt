/** Render harness for the row menu's DOM tests. Every call the menu makes is
    recorded as an effect string ("mr:merge", "launch:review:focus"), so the
    pins describe what a click does without naming the props that carry it.
    When RowMenu's props change, only renderRowMenu changes; the pins must
    not. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import type { ActionRequest, RunOpts } from '../row-actions.ts';
import { actionEnvOf, type MenuEnv } from './menu-fixtures.ts';

export interface Effect {
  effect: string;
  iid: number;
  note?: string;
}

export const harness: { effects: Effect[]; closed: boolean } = {
  effects: [],
  closed: false,
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RowMenu: typeof import('../RowMenu.tsx').RowMenu;
let root: ReturnType<typeof import('react-dom/client').createRoot> | null =
  null;
let container: HTMLDivElement | null = null;

export function useMenuHarness(): void {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  beforeAll(async () => {
    React = await import('react');
    ({ createRoot } = await import('react-dom/client'));
    ({ RowMenu } = await import('../RowMenu.tsx'));
  });
  afterEach(async () => {
    await closeMenu();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

function record(effect: string, mr: { iid: number }, note?: string): void {
  harness.effects.push(
    note === undefined ? { effect, iid: mr.iid } : { effect, iid: mr.iid, note }
  );
}

function effectOf(req: ActionRequest, opts: RunOpts): string {
  switch (req.kind) {
    case 'launch':
      return `launch:${req.flow}${req.intent === 'focus' ? ':focus' : ''}`;
    case 'mr':
      return `mr:${req.action}`;
    case 'draft':
      return `draft:${req.draft}`;
    case 'react':
      return `react:${req.emoji}:${req.remove}`;
    case 'ask':
      return `ask:${req.ask}:${opts.pick ?? req.reviewer}`;
    case 'open':
      return `open:${req.url}`;
    case 'view-report':
      return `view-report:${req.lane}`;
    case 'dismiss':
      return `dismiss:${req.lane}`;
    case 'stand-down':
      return `stand-down:${req.on}`;
    default:
      return req.kind;
  }
}

function renderRowMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  reactionsReply: string[] | null
) {
  return (
    <RowMenu
      menu={{ x: 10, y: 10, mr }}
      env={actionEnvOf(env, mr)}
      onClose={() => {
        harness.closed = true;
      }}
      onRun={(action, m, opts) => {
        record(effectOf(action.request, opts), m, opts.note);
        return action.request.kind === 'react'
          ? Promise.resolve({
              ok: true,
              status: 200,
              body: reactionsReply ? { reactions: reactionsReply } : null,
              text: '',
            })
          : undefined;
      }}
    />
  );
}

export async function openMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  opts: { reactionsReply?: string[] | null } = {}
): Promise<void> {
  await closeMenu();
  harness.effects = [];
  harness.closed = false;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await React.act(async () => {
    r.render(renderRowMenu(mr, env, opts.reactionsReply ?? null));
  });
}

export async function closeMenu(): Promise<void> {
  const r = root;
  if (r) await React.act(async () => r.unmount());
  container?.remove();
  root = null;
  container = null;
}

/** The open menu, top to bottom: `# label`, item text, `---` separator. */
export function menuLines(): string[] {
  const menu = document.querySelector('[data-part="contextmenu"]');
  if (!menu) return [];
  return [...menu.children].map(el => {
    const part = el.getAttribute('data-part');
    if (part === 'contextmenu-label') return `# ${el.textContent}`;
    if (part === 'contextmenu-separator') return '---';
    if (el.tagName === 'TEXTAREA') return '[note box]';
    return el.textContent ?? '';
  });
}

export function itemTexts(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    el => el.textContent ?? ''
  );
}

export async function clickItem(
  text: string,
  init: MouseEventInit = {}
): Promise<void> {
  const items = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ];
  const hit =
    items.find(el => el.textContent === text) ??
    items.find(el => el.textContent?.includes(text));
  if (!hit) {
    throw new Error(
      `no menu item "${text}" in: ${items.map(el => el.textContent).join(' | ')}`
    );
  }
  await React.act(async () => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });
}

export async function typeNote(text: string): Promise<void> {
  const ta = document.querySelector<HTMLTextAreaElement>(
    'textarea.tui-menu-note'
  );
  if (!ta) throw new Error('no note box');
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    setValue.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  });
}

export async function flush(): Promise<void> {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

/** Opens the menu fresh for every item, clicks it (and its confirm or first
    pick, when it has one), and reports `label → effects`. */
export async function clickEach(
  mr: BoardMRWithReview,
  env: MenuEnv
): Promise<string[]> {
  await openMenu(mr, env);
  const labels = itemTexts();
  const out: string[] = [];
  for (const label of labels) {
    await openMenu(mr, env);
    await clickItem(label);
    const armed = harness.closed
      ? undefined
      : itemTexts().find(t => t.startsWith('really'));
    if (armed) await clickItem(armed);
    if (!harness.closed && menuLines()[0] === '# request review from')
      await clickItem(itemTexts()[0]!);
    const fx = harness.effects.map(e => e.effect).join(', ') || '(nothing)';
    out.push(`${label} → ${fx}${harness.closed ? '' : ' (stays open)'}`);
  }
  await closeMenu();
  return out;
}
