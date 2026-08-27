import { describe, expect, it } from 'vitest';

import { createDynamicTable } from './createDynamicTable';

interface RawUser {
  userId: number;
  fullName: string;
  orderTotal: number;
}

interface AdaptedUser {
  id: number;
  fullName: string;
  orderTotal: number;
}

const rawUsers: RawUser[] = [
  { userId: 1, fullName: 'Ada Lovelace', orderTotal: 42 },
  { userId: 2, fullName: 'Grace Hopper', orderTotal: 7 },
];

function adapter(user: RawUser): AdaptedUser {
  return {
    id: user.userId,
    fullName: user.fullName,
    orderTotal: user.orderTotal,
  };
}

describe('createDynamicTable', () => {
  it('adapts every row with the given adapter', () => {
    const { data } = createDynamicTable({ data: rawUsers, adapter });

    expect(data).toEqual([
      { id: 1, fullName: 'Ada Lovelace', orderTotal: 42 },
      { id: 2, fullName: 'Grace Hopper', orderTotal: 7 },
    ]);
  });

  it('derives one column per adapted field, skipping `id`, with a humanized header', () => {
    const { columns } = createDynamicTable({ data: rawUsers, adapter });

    expect(columns.map(column => column.key)).toEqual([
      'fullName',
      'orderTotal',
    ]);
    expect(columns.map(column => column.header)).toEqual([
      'Full Name',
      'Order Total',
    ]);
  });

  it('defaults each column’s cell to String(value)', () => {
    const { columns, data } = createDynamicTable({ data: rawUsers, adapter });

    const orderTotalColumn = columns.find(
      column => column.key === 'orderTotal'
    )!;
    expect(orderTotalColumn.cell(data[0])).toBe('42');
  });

  it('lets customCells override a specific column’s cell renderer', () => {
    const { columns, data } = createDynamicTable({
      data: rawUsers,
      adapter,
      customCells: { orderTotal: row => `$${row.orderTotal.toFixed(2)}` },
    });

    const orderTotalColumn = columns.find(
      column => column.key === 'orderTotal'
    )!;
    expect(orderTotalColumn.cell(data[0])).toBe('$42.00');
  });

  it('returns no columns for an empty data set (no row to derive shape from)', () => {
    const { data, columns } = createDynamicTable({
      data: [] as RawUser[],
      adapter,
    });

    expect(data).toEqual([]);
    expect(columns).toEqual([]);
  });
});
