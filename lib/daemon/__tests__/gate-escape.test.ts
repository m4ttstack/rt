import { describe, expect, test } from "bun:test";
import { createEscapeInjector } from "../gate-escape.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const pane = (over: Partial<LivePane>): LivePane => ({
  paneRef: "wE2:p8", sockPath: "/tmp/h.sock", workspaceId: "wE2",
  agentStatus: "blocked", ...over,
});

describe("createEscapeInjector", () => {
  test("stale paneId resolves via session id before sending", async () => {
    const sent: Array<{ verb: string; payload: unknown }> = [];
    const injector = createEscapeInjector({
      herdr: (async (verb: string, payload: unknown) => { sent.push({ verb, payload }); return { ok: true, data: {} }; }) as never,
      snapshot: async () => [pane({ paneRef: "wE2:p8", sessionId: "s-1" })],
    });
    const res = await injector({ paneId: "wE2:p6", sessionId: "s-1" });
    expect(res).toEqual({ ok: true, paneRef: "wE2:p8" });
    expect(sent[0]).toEqual({ verb: "pane.send_keys", payload: { pane_id: "wE2:p8", keys: ["escape"] } });
  });

  test("no resolvable pane returns ok:false without sending", async () => {
    const injector = createEscapeInjector({
      herdr: (async () => { throw new Error("must not send"); }) as never,
      snapshot: async () => [],
    });
    const res = await injector({ paneId: "wE2:p6" });
    expect(res.ok).toBe(false);
  });

  test("bg-prefixed paneRef sends the bare pane id on the resolved pane's own socket", async () => {
    const sent: Array<{ payload: unknown; sockPath: string | undefined }> = [];
    const injector = createEscapeInjector({
      herdr: (async (_verb: string, payload: unknown, o?: { sockPath?: string }) => {
        sent.push({ payload, sockPath: o?.sockPath });
        return { ok: true, result: {} };
      }) as never,
      snapshot: async () => [pane({ paneRef: "bg:w1:p2", sockPath: "/tmp/bg.sock", sessionId: "s-2" })],
    });
    const res = await injector({ sessionId: "s-2" });
    expect(res).toEqual({ ok: true, paneRef: "bg:w1:p2" });
    expect(sent[0]).toEqual({ payload: { pane_id: "w1:p2", keys: ["escape"] }, sockPath: "/tmp/bg.sock" });
  });

  test("a herdr error surfaces as ok:false with code and message", async () => {
    const injector = createEscapeInjector({
      herdr: (async () => ({ ok: false, code: "pane_not_found", message: "no such pane" })) as never,
      snapshot: async () => [pane({ paneRef: "w1:p2", sessionId: "s-3" })],
    });
    const res = await injector({ sessionId: "s-3" });
    expect(res).toEqual({ ok: false, error: "pane_not_found: no such pane" });
  });

  test("no herdr server reachable returns ok:false without sending", async () => {
    const injector = createEscapeInjector({
      herdr: (async () => { throw new Error("must not send"); }) as never,
      snapshot: async () => null,
    });
    const res = await injector({ paneId: "w1:p2" });
    expect(res.ok).toBe(false);
  });
});
