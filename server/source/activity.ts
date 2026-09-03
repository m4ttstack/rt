import type { PipelineSummary, UserEvent } from "@mattstack/glance";
import type { TimeWindow } from "../../shared/types.js";
import type { StoredPipeline, StoredPushEvent } from "../store/index.js";
import type { SourceIO, SourceProvider } from "./provider.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateOnly = (iso: string): string => iso.slice(0, 10);

export function toStoredPipeline(summary: PipelineSummary, projectPath: string): StoredPipeline {
  return {
    id: summary.id,
    projectPath,
    username: summary.username,
    status: summary.status,
    // Glance types createdAt nullable; the store column is NOT NULL and every
    // pipeline seen in practice carries one, so the fallback never fires.
    createdAt: summary.createdAt ?? "",
  };
}

export async function fetchPipelinesFor(
  provider: SourceProvider,
  projectPath: string,
  username: string,
  window: TimeWindow,
  io: SourceIO = {},
): Promise<StoredPipeline[]> {
  const summaries = await provider.fetchProjectPipelines(projectPath, {
    username,
    updatedAfter: window.start,
    updatedBefore: window.end,
    signal: io.signal,
  });
  return summaries.map((summary) => toStoredPipeline(summary, projectPath));
}

export function toStoredPushEvent(event: UserEvent, username: string): StoredPushEvent {
  return {
    username,
    createdAt: event.createdAt,
    repositoryId: event.repositoryId,
  };
}

/**
 * `userId` is glance's scoped form ("gitlab:user:42"); `username` is carried
 * separately and stamped onto every row because UserEvent (glance's shape)
 * has no username of its own, while the store keys push events by username.
 */
export async function fetchPushesFor(
  provider: SourceProvider,
  userId: string,
  username: string,
  window: TimeWindow,
  io: SourceIO = {},
): Promise<StoredPushEvent[]> {
  // Widened a day on each side, matching slice.ts:31-34's push-event bound.
  const after = dateOnly(new Date(new Date(window.start).getTime() - DAY_MS).toISOString());
  const before = dateOnly(new Date(new Date(window.end).getTime() + DAY_MS).toISOString());
  const events = await provider.fetchUserEvents(userId, {
    action: "pushed",
    after,
    before,
    signal: io.signal,
  });
  return events.map((event) => toStoredPushEvent(event, username));
}
