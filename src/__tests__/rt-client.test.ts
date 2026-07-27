import { describe, expect, test, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import {
  rtCommand, readProjectMRs, readProjectMRsForRefresh, refreshMaxAge,
  LIVE_REFRESH_MAX_AGE_MS, readDiscussions, subscribe,
} from "../rt-client.ts";

const socks: string[] = [];
const servers: Array<{ stop(): void }> = [];
afterEach(() => { for (const s of servers) s.stop(); servers.length = 0; });

/** Fake daemon over a unix socket: records requests, replies from a map. */
function fakeDaemon(replies: Record<string, unknown>) {
  const sock = join(tmpdir(), `rt-client-test-${process.pid}-${socks.length}.sock`);
  socks.push(sock);
  const seen: Array<{ cmd: string; payload: unknown }> = [];
  const server = Bun.serve({
    unix: sock,
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = req.method === "POST" ? await req.json() : undefined;
      seen.push({ cmd, payload });
      const reply = replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` };
      return Response.json(reply);
    },
  });
  servers.push(server);
  return { sock, seen };
}

describe("rtCommand", () => {
  test("POSTs payload to /<cmd> and returns the daemon envelope", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: true, data: { mrs: {}, listSyncedAt: 5, source: "poll", syncedAt: 5 } } });
    const res = await rtCommand("project-mrs:read", { repoName: "x" }, { sockPath: sock });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([{ cmd: "project-mrs:read", payload: { repoName: "x" } }]);
  });

  test("unreachable socket returns ok:false with an instructive error, never throws", async () => {
    const res = await rtCommand("project-mrs:read", { repoName: "x" }, { sockPath: join(tmpdir(), "definitely-missing.sock") });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt daemon unreachable");
  });
});

describe("readProjectMRs", () => {
  test("omits maxAgeMs when not given, passes it when given (incl. 0)", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: true, data: { mrs: {}, listSyncedAt: 0, source: "poll", syncedAt: 0 } } });
    await readProjectMRs("acme-dev", undefined, { sockPath: sock });
    await readProjectMRs("acme-dev", 0, { sockPath: sock });
    expect(seen[0]!.payload).toEqual({ repoName: "acme-dev" });
    expect(seen[1]!.payload).toEqual({ repoName: "acme-dev", maxAgeMs: 0 });
  });
});

describe("readProjectMRsForRefresh (manual refresh freshness policy)", () => {
  const store = (source: string) => ({ mrs: {}, listSyncedAt: 1, source, syncedAt: 1 });

  test("a live repo is already event-fresh — demand 10s, never force a sync", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: true, data: store("events") } });
    const res = await readProjectMRsForRefresh("acme-dev", { sockPath: sock });
    expect(res.ok).toBe(true);
    // The probe carries no maxAgeMs, so it can never trigger a sync itself.
    expect(seen[0]!.payload).toEqual({ repoName: "acme-dev" });
    expect(seen[1]!.payload).toEqual({ repoName: "acme-dev", maxAgeMs: LIVE_REFRESH_MAX_AGE_MS });
  });

  test("a poll repo still forces — nothing else keeps it current", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: true, data: store("poll") } });
    await readProjectMRsForRefresh("some-repo", { sockPath: sock });
    expect(seen[1]!.payload).toEqual({ repoName: "some-repo", maxAgeMs: 0 });
  });

  test("a mutation-sourced store forces — a write is not ongoing freshness", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: true, data: store("mutation") } });
    await readProjectMRsForRefresh("some-repo", { sockPath: sock });
    expect(seen[1]!.payload).toEqual({ repoName: "some-repo", maxAgeMs: 0 });
  });

  test("a failed probe forces — never relax freshness on unknown state", async () => {
    const { sock, seen } = fakeDaemon({ "project-mrs:read": { ok: false, error: "grant missing" } });
    await readProjectMRsForRefresh("some-repo", { sockPath: sock });
    expect(seen[1]!.payload).toEqual({ repoName: "some-repo", maxAgeMs: 0 });
  });

  test("an unreachable daemon surfaces the error instead of throwing", async () => {
    const res = await readProjectMRsForRefresh("x", { sockPath: join(tmpdir(), "definitely-missing.sock") });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rt daemon unreachable");
  });
});

describe("refreshMaxAge", () => {
  test("only an events-sourced store earns the relaxed window", () => {
    expect(refreshMaxAge("events")).toBe(LIVE_REFRESH_MAX_AGE_MS);
    expect(refreshMaxAge("poll")).toBe(0);
    expect(refreshMaxAge("mutation")).toBe(0);
    expect(refreshMaxAge(undefined)).toBe(0);
  });
});

describe("readDiscussions", () => {
  test("sends repoName + iid", async () => {
    const { sock, seen } = fakeDaemon({ "discussions:read": { ok: true, data: { discussions: [], fetchedAt: 1, stale: false } } });
    const res = await readDiscussions("acme-dev", 42, { sockPath: sock });
    expect(res.ok).toBe(true);
    expect(seen[0]!.payload).toEqual({ repoName: "acme-dev", iid: 42 });
  });
});

describe("subscribe", () => {
  test("receives relay frames and stop() closes cleanly", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    let sock: Bun.ServerWebSocket<unknown> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
      websocket: { open(ws) { sock = ws; }, message() {} },
    });
    servers.push(server);
    const stop = subscribe((type, data) => events.push({ type, data }), { wsUrl: `ws://127.0.0.1:${server.port}/ws` });
    // Wait for the connection, then push one frame.
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => sock ? resolve() : Date.now() - t0 > 3000 ? reject(new Error("no ws connect")) : setTimeout(poll, 10);
      poll();
    });
    sock!.send(JSON.stringify({ type: "project-mrs", data: { repoName: "r", iids: [1] }, timestamp: 1 }));
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => events.length ? resolve() : Date.now() - t0 > 3000 ? reject(new Error("no event")) : setTimeout(poll, 10);
      poll();
    });
    expect(events[0]).toEqual({ type: "project-mrs", data: { repoName: "r", iids: [1] } });
    stop();
  });

  test("reconnects with backoff on close, and stop() prevents further reconnects", async () => {
    let opens = 0;
    let sock: Bun.ServerWebSocket<unknown> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
      websocket: { open(ws) { opens++; sock = ws; }, message() {} },
    });
    servers.push(server);

    const waitFor = (predicate: () => boolean, deadlineMs: number, message: string) =>
      new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        const poll = () => predicate() ? resolve() : Date.now() - t0 > deadlineMs ? reject(new Error(message)) : setTimeout(poll, 10);
        poll();
      });

    const stop = subscribe(() => {}, { wsUrl: `ws://127.0.0.1:${server.port}/ws` });

    // Initial connection.
    await waitFor(() => opens === 1, 3000, "no initial connect");

    // Server-side close triggers a reconnect (first backoff step is 1s).
    sock!.close();
    await waitFor(() => opens === 2, 5000, "no reconnect after close");

    // stop() first, then close the live socket -- if stop() were broken, this
    // close would trigger another reconnect attempt.
    stop();
    sock!.close();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(opens).toBe(2);
  });
});
