import { expect, test } from 'vitest';

import { ICON_NAMES, Icons } from '@mattstack/app-kit/icons';

test('registry has no undefined entries', () => {
  for (const [name, cmp] of Object.entries(Icons)) {
    expect(cmp, `Icon '${name}' is undefined`).toBeDefined();
  }
});

test('ICON_NAMES enumerates the registry exactly', () => {
  expect(ICON_NAMES).toEqual(Object.keys(Icons));
  expect(ICON_NAMES.length).toBeGreaterThan(0);
});
