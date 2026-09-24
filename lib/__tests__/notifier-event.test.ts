import { beforeEach, expect, test } from "bun:test";
import { drainNotifications, notifyEvent, peekNotifications } from "../notifier.ts";

beforeEach(() => {
  drainNotifications();
});

test("notifyEvent queues an event that keeps its team and handle for the tray's click routing", () => {
  notifyEvent({ title: "ed replied to your acme invite", message: "Add ed to acme?", category: "member_joined", team: "acme", handle: "ed" });

  const queued = peekNotifications();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ title: "ed replied to your acme invite", category: "member_joined", team: "acme", handle: "ed" });
  expect(typeof queued[0]!.id).toBe("string");
  expect(queued[0]!.timestamp).toBeGreaterThan(0);
});

test("notifyEvent keeps a caller-chosen id, so a repeat of the same event dedupes on the tray", () => {
  notifyEvent({ id: "member_joined:acme:inv-1", title: "t", message: "m", category: "member_joined", team: "acme", handle: "ed" });

  expect(peekNotifications().map((e) => e.id)).toEqual(["member_joined:acme:inv-1"]);
});
