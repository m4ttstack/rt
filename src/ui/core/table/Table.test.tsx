import { createRef } from 'react';

import { Table } from '@ui/core';
import { renderWithProviders } from '@ui/storybook/test-utils';

// --- ref forwarding ----------------------------------------------------
//
// The Table shadow wraps @mantine/core's Table, which forwards its ref to
// the underlying HTMLTableElement (see TableFactory's `ref: HTMLTableElement`
// in @mantine/core). The shadow must not drop that.

test('Table forwards its ref to the underlying HTMLTableElement', () => {
  const ref = createRef<HTMLTableElement>();
  renderWithProviders(<Table ref={ref} />);

  expect(ref.current).toBeInstanceOf(HTMLTableElement);
});

// --- static surface ------------------------------------------------------
//
// Mantine's Table.Factory staticComponents include DataRenderer alongside
// the other sub-components; the shadow's static surface must mirror it
// completely.

test('Table.DataRenderer is defined', () => {
  expect(Table.DataRenderer).toBeDefined();
});
