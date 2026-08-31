import { expect, test } from "bun:test";
import { edgeState, edgeHealthRow, readReady, tunnelRowHealth } from "./edge-health.ts";

const ready = (status: number, n: number) => (async () => Response.json({ status, readyConnections: n, connectorId: "c" }, { status })) as unknown as typeof fetch;
const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

test("readReady: 200 with connections is up; 503 is up but 0; refused is down", async () => {
  expect(await readReady(ready(200, 4), 7951)).toEqual({ up: true, readyConnections: 4 });
  expect(await readReady(ready(503, 0), 7951)).toEqual({ up: true, readyConnections: 0 });
  expect(await readReady(down, 7951)).toEqual({ up: false, readyConnections: 0 });
});

test("edgeState maps the spec table", () => {
  expect(edgeState({ running: true, readyConnections: 2, tunnelGone: false })).toBe("connected");
  expect(edgeState({ running: true, readyConnections: 0, tunnelGone: false })).toBe("disconnected");
  expect(edgeState({ running: false, readyConnections: 0, tunnelGone: false })).toBe("stopped");
  expect(edgeState({ running: true, readyConnections: 4, tunnelGone: true })).toBe("gone");
});

test("edgeHealthRow tones + hint", () => {
  expect(edgeHealthRow("connected", 4, "e.dev")).toMatchObject({ ok: true, tone: "ok", detail: "4 connections" });
  expect(edgeHealthRow("connected", 1, "e.dev").detail).toBe("1 connection");
  expect(edgeHealthRow("disconnected", 0, "e.dev")).toMatchObject({ ok: false, tone: "warn", detail: "not connected to Cloudflare" });
  expect(edgeHealthRow("stopped", 0, "e.dev")).toMatchObject({ ok: false, tone: "bad", detail: "stopped" });
  expect(edgeHealthRow("gone", 0, "e.dev")).toMatchObject({ ok: false, tone: "bad", detail: "tunnel missing at Cloudflare", hint: "re-run deck domain e.dev" });
});

test("tunnelRowHealth skips the metrics read when the process is not running", async () => {
  let called = false;
  const spy = (async () => { called = true; return Response.json({}); }) as unknown as typeof fetch;
  const h = await tunnelRowHealth({ running: false, tunnelGone: false, domain: "e.dev", fetchImpl: spy });
  expect(called).toBe(false);
  expect(h.tone).toBe("bad");
});
