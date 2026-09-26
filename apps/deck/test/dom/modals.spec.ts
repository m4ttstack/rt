// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect.
import { expect, test } from 'bun:test';
import type { Page, Route } from 'playwright';

import { consoleErrors, withBoard } from './rig.ts';

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  if (!check()) throw new Error('poll() timed out waiting for condition');
}

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Answers the register route with `status`/`body` and records each POST. */
async function stubRegister(
  page: Page,
  status: number,
  body: unknown
): Promise<unknown[]> {
  const posts: unknown[] = [];
  await page.route('**/api/v1/apps/register', async route => {
    posts.push(route.request().postDataJSON());
    await fulfillJson(route, status, body);
  });
  return posts;
}

/** Console errors minus the network lines a stubbed 4xx answer logs. */
function scriptErrors(page: Page): string[] {
  return consoleErrors(page).filter(
    e => !e.startsWith('Failed to load resource')
  );
}

async function openAddModal(page: Page) {
  await page.locator('button', { hasText: 'add app' }).click();
  const modal = page.locator('[data-part="modal"]');
  await modal.waitFor({ state: 'visible' });
  return modal;
}

const DIR = '/Users/matt/code/newapp';

test('add app opens on a focused directory step that asks for an absolute path and shows no manual fields', async () => {
  await withBoard(async page => {
    const modal = await openAddModal(page);

    await page.waitForFunction(
      () => document.activeElement?.getAttribute('name') === 'app-dir'
    );
    expect(
      await modal.locator('[name="app-dir"]').getAttribute('pattern')
    ).toBe('/.*');
    expect(await modal.locator('[name="app-name"]').count()).toBe(0);
    expect(await modal.getByText('Command', { exact: true }).count()).toBe(0);
    expect(await modal.locator('form > p').first().textContent()).toBe(
      'Registers a local service: a named https domain and a supervised process that starts on login.'
    );

    expect(consoleErrors(page)).toEqual([]);
  });
});

test('a directory with mattstack.deck.json registers through the route deck register --dir uses, then closes', async () => {
  await withBoard(async page => {
    const registerPosts = await stubRegister(page, 200, {
      record: { name: 'newapp', port: 11012 },
    });
    let manualPosts = 0;
    await page.route('**/api/v1/apps', async route => {
      if (route.request().method() === 'POST') manualPosts++;
      await route.continue();
    });

    const modal = await openAddModal(page);
    await modal.locator('[name="app-dir"]').fill(`${DIR}  `);
    await modal.locator('button[type="submit"]').click();

    await poll(() => registerPosts.length === 1);
    expect(registerPosts[0]).toEqual({ dir: DIR, create: true });
    await page.waitForSelector('[data-part="modal"]', { state: 'detached' });
    expect(manualPosts).toBe(0);
  });
});

test('a directory without a manifest reveals the manual form with the directory prefilled, and it submits the addPayload shape', async () => {
  await withBoard(async page => {
    await stubRegister(page, 400, {
      error: `no mattstack.deck.json in ${DIR}`,
    });
    let postBody: unknown = null;
    await page.route('**/api/v1/apps', async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      postBody = route.request().postDataJSON();
      await fulfillJson(route, 400, { message: 'name taken' });
    });

    const modal = await openAddModal(page);
    await modal.locator('[name="app-dir"]').fill(DIR);
    await modal.locator('button[type="submit"]').click();
    await modal.locator('[name="app-name"]').waitFor({ state: 'visible' });

    expect(
      await modal.getByText(`No mattstack.deck.json in ${DIR}`).count()
    ).toBe(1);
    expect(await modal.locator('[name="app-dir"]').count()).toBe(0);
    expect(await modal.locator('[data-part="alert"]').count()).toBe(0);

    const fieldLabels = modal.locator(
      '.modal-form > label [data-part="field-label"]'
    );
    expect(await fieldLabels.allTextContents()).toEqual([
      'Name',
      'Command',
      'Working directory',
    ]);
    expect(await modal.locator('[data-part="switch"]').count()).toBe(0);
    expect(await modal.getByPlaceholder('4200').count()).toBe(0);
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('name') === 'app-name'
    );
    expect(
      await modal.locator('[name="app-name"]').getAttribute('pattern')
    ).toBe('[a-z0-9][a-z0-9.\\-]*');
    expect(
      await modal.getByPlaceholder('/Users/you/code/myapp').inputValue()
    ).toBe(DIR);
    expect(
      await modal.getByText('Will be assigned port 11012 (PORT env).').count()
    ).toBe(1);

    await modal.locator('[name="app-name"]').fill('My App');
    expect(
      await modal
        .locator('[name="app-name"]')
        .evaluate(el => (el as HTMLInputElement).validity.patternMismatch)
    ).toBe(true);
    await modal.locator('[name="app-name"]').fill('newapp');
    await modal.getByPlaceholder('bun src/server.ts').click();
    await page.keyboard.type('bun run start');
    expect(await modal.getByPlaceholder('bun src/server.ts').inputValue()).toBe(
      'bun run start'
    );
    expect(await modal.locator('[name="app-name"]').inputValue()).toBe(
      'newapp'
    );
    await modal.locator('button[type="submit"]').click();

    await poll(() => postBody !== null);
    expect(postBody).toEqual({
      name: 'newapp',
      command: ['bun', 'run', 'start'],
      workingDirectory: DIR,
    });
    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: 'visible' });
    expect(await alert.textContent()).toContain('name taken');
    expect(await page.locator('[data-part="modal"]').count()).toBe(1);
    expect(scriptErrors(page)).toEqual([]);
  });
});

test("any other 400 from the register route shows the route's error and stays on the directory step", async () => {
  await withBoard(async page => {
    await stubRegister(page, 400, {
      error: 'manifest must declare commands.start or a port',
    });

    const modal = await openAddModal(page);
    await modal.locator('[name="app-dir"]').fill(DIR);
    await modal.locator('button[type="submit"]').click();

    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: 'visible' });
    expect(await alert.textContent()).toContain(
      'manifest must declare commands.start or a port'
    );
    expect(await modal.locator('[name="app-dir"]').inputValue()).toBe(DIR);
    expect(await modal.locator('[name="app-name"]').count()).toBe(0);
  });
});

test('an app that is already registered shows its name and changes nothing', async () => {
  await withBoard(async page => {
    await stubRegister(page, 409, {
      error: 'already registered',
      name: 'forecast',
      dir: DIR,
    });

    const modal = await openAddModal(page);
    await modal.locator('[name="app-dir"]').fill(DIR);
    await modal.locator('button[type="submit"]').click();

    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: 'visible' });
    expect(await alert.textContent()).toBe('forecast is already registered');
    expect(await modal.locator('[name="app-dir"]').inputValue()).toBe(DIR);
    expect(await modal.locator('[name="app-name"]').count()).toBe(0);
  });
});

test('a relative directory fails the pattern and never reaches the register route', async () => {
  await withBoard(async page => {
    const registerPosts = await stubRegister(page, 200, {});

    const modal = await openAddModal(page);
    const dir = modal.locator('[name="app-dir"]');
    await dir.fill('rel/path');
    expect(
      await dir.evaluate(
        el => (el as HTMLInputElement).validity.patternMismatch
      )
    ).toBe(true);
    await modal.locator('button[type="submit"]').click();
    await page.waitForTimeout(300);
    expect(registerPosts).toEqual([]);
  });
});

test('a second submit while the first is in flight is ignored and the button reads busy', async () => {
  await withBoard(async page => {
    const posts: unknown[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>(r => (release = r));
    await page.route('**/api/v1/apps/register', async route => {
      posts.push(route.request().postDataJSON());
      await held;
      await fulfillJson(route, 200, {});
    });

    const modal = await openAddModal(page);
    await modal.locator('[name="app-dir"]').fill(DIR);
    const submit = modal.locator('button[type="submit"]');
    await submit.click();
    await poll(() => posts.length === 1);

    expect(await submit.isDisabled()).toBe(true);
    expect(await submit.getAttribute('aria-busy')).toBe('true');
    await modal
      .locator('form')
      .evaluate(f => (f as HTMLFormElement).requestSubmit());
    await page.waitForTimeout(300);
    expect(posts.length).toBe(1);

    release();
    await page.waitForSelector('[data-part="modal"]', { state: 'detached' });
  });
});
