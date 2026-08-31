import type { RoomSummary } from '@mattstack/rt-client';

/**
 * The rail lists open rooms only, plus the active room when it is closed:
 * a closed room reached by an `rt chat post` link is listed while it is
 * open and gone once the viewer navigates away. This is the one place the
 * client reads `archivedAt` for listing.
 */
export function visibleRooms(
  rooms: RoomSummary[],
  activeRoom: string | undefined
): RoomSummary[] {
  return rooms.filter(r => r.archivedAt === undefined || r.room === activeRoom);
}
