import { expect, test } from 'vitest';

import { visibleRooms } from './visible-rooms';

const open = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
const closed = {
  room: 'retro',
  memberCount: 1,
  unread: 0,
  mentions: 0,
  archivedAt: 5,
};

test('a closed room is hidden unless it is the active one', () => {
  expect(visibleRooms([open, closed], undefined)).toEqual([open]);
  expect(visibleRooms([open, closed], 'build')).toEqual([open]);
  expect(visibleRooms([open, closed], 'retro')).toEqual([open, closed]);
});
