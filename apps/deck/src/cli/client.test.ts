import { expect, test } from 'bun:test';

import { deckNotRunning } from './client.ts';

const SMAPP_DEV = `gui/501/com.mattstack.deck.dev = {
\tpath = (submitted by smd.340)
\tmanaged_by = com.apple.xpc.ServiceManagement
}`;

test('a helper-owned machine is pointed at the mattstack app, never deck setup', async () => {
  const probe = async (argv: string[]) =>
    argv[2]!.endsWith('/com.mattstack.deck.dev')
      ? { code: 0, stdout: SMAPP_DEV }
      : { code: 113, stdout: '' };

  const msg = await deckNotRunning(probe, null);

  expect(msg).toStartWith("Deck isn't running. ");
  expect(msg).toContain('mattstack app');
  expect(msg).not.toContain('deck setup');
});

test('a machine with no helper keeps the deck serve / deck setup hint', async () => {
  const probe = async () => ({ code: 113, stdout: '' });

  expect(await deckNotRunning(probe, null)).toBe(
    "Deck isn't running. Start it with `deck serve` or install it with `deck setup`."
  );
});
