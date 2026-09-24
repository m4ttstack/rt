import { afterEach, expect, test } from "bun:test";
import { herdrRequest } from "../../herdr/client.ts";
import { fakeHerdr, HerdrFakeError, type FakeHerdrHandler } from "../../herdr/__tests__/fake-herdr.ts";
import { composerDraft, injectAfterTurn, injectIntoPane } from "../inject.ts";
import { bgSocketPath } from "../bg-service.ts";

const stops: Array<() => void> = [];
afterEach(() => { for (const s of stops) s(); stops.length = 0; });

function on(handler: FakeHerdrHandler) {
  const { sock, seen, stop } = fakeHerdr(handler);
  stops.push(stop);
  const herdr: typeof herdrRequest = (m, p, o) => herdrRequest(m, p, { ...o, sockPath: sock });
  return { seen, herdr };
}

// agent.get's reply, as chat:invite reads it: result.agent.agent (kind) and result.agent.agent_status.
const agent = (status: string, kind = "claude") => ({ type: "agent_info", agent: { pane_id: "w1:p1", agent: kind, agent_status: status } });

test("an idle pane accepts: prompt sent with a wait, reached working", async () => {
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "do the thing", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
  expect(seen.find((s) => s.method === "agent.prompt")!.params).toEqual({ target: "w1:p1", text: "do the thing", wait: { until: ["working"], timeout_ms: 5000 } });
});

test("a blocked pane is refused, nothing sent", async () => {
  const { herdr, seen } = on((method) => (method === "agent.get" ? agent("blocked") : new HerdrFakeError("invalid_request", method)));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "hi", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } });
  expect(seen.map((s) => s.method)).toEqual(["agent.get"]);
});

test("a non-claude pane is refused", async () => {
  const { herdr } = on((method) => (method === "agent.get" ? agent("idle", "codex") : new HerdrFakeError("invalid_request", method)));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "hi", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "not a claude pane" } });
});

test("a working pane is queued: prompt sent without a wait", async () => {
  const { herdr, seen } = on((method) => {
    if (method === "agent.get") return agent("working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: agent("working").agent };
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "later", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued" } });
  expect(seen.find((s) => s.method === "agent.prompt")!.params).toEqual({ target: "w1:p1", text: "later" });
});

test("a stalled prompt gets one pane.send_keys Enter nudge, then queued", async () => {
  let prompts = 0;
  const { herdr, seen } = on((method) => {
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") { prompts++; return new HerdrFakeError("timeout", "timed out waiting for agent status"); }
    if (method === "pane.send_keys") return { type: "ok" };
    if (method === "agent.wait") return new HerdrFakeError("timeout", "timed out waiting for agent status");
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued" } });
  expect(prompts).toBe(1);
  expect(seen.filter((s) => s.method === "pane.send_keys")).toHaveLength(1);
});

test("the Enter nudge failing unreachable is herdr unavailable, not queued", async () => {
  const { herdr, seen } = on((method) => {
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return new HerdrFakeError("timeout", "timed out waiting for agent status");
    if (method === "pane.send_keys") return new HerdrFakeError("unreachable", "herdr socket vanished");
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", herdr });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error.startsWith("herdr unavailable")).toBe(true);
  expect(seen.some((s) => s.method === "agent.wait")).toBe(false);
});

test("agent.wait failing unreachable after the nudge is herdr unavailable, not queued", async () => {
  const { herdr, seen } = on((method) => {
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return new HerdrFakeError("timeout", "timed out waiting for agent status");
    if (method === "pane.send_keys") return { type: "ok" };
    if (method === "agent.wait") return new HerdrFakeError("unreachable", "herdr socket vanished");
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", herdr });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error.startsWith("herdr unavailable")).toBe(true);
  expect(seen.filter((s) => s.method === "pane.send_keys")).toHaveLength(1);
});

test("the caller's own pane is refused before any herdr call", async () => {
  const { herdr, seen } = on(() => new HerdrFakeError("invalid_request", "unreachable in this test"));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", callerPane: "w1:p1", herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } });
  expect(seen).toHaveLength(0);
});

// Finding 3: the self-refusal compares in ref space, not bare ids -- paneId
// here is always the bare id the caller's own ref already resolved against
// (same visible/bg servers can coincidentally share a bare id).
test("a visible-pane caller is not refused sending to a bg pane sharing its bare id", async () => {
  const { herdr, seen } = on((method) => (method === "agent.get" ? agent("blocked") : new HerdrFakeError("invalid_request", method)));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", callerPane: "w1:p1", sockPath: bgSocketPath(), herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } });
  expect(seen).toHaveLength(1);
});

test("a bg-pane caller sending to its own bg ref is refused before any herdr call", async () => {
  const { herdr, seen } = on(() => new HerdrFakeError("invalid_request", "unreachable in this test"));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", callerPane: "bg:w1:p1", sockPath: bgSocketPath(), herdr });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } });
  expect(seen).toHaveLength(0);
});

test("multi-line text is delivered verbatim as the prompt", async () => {
  const { herdr, seen } = on((method) =>
    method === "agent.get" ? agent("idle")
    : method === "agent.prompt" ? { type: "agent_prompted", agent: agent("working").agent }
    : new HerdrFakeError("invalid_request", method));
  await injectIntoPane({ paneId: "w1:p1", text: "line one\nline two", herdr });
  expect(seen.find((s) => s.method === "agent.prompt")!.params.text).toBe("line one\nline two");
});

test("a missing socket is herdr unavailable (ok:false)", async () => {
  const herdr: typeof herdrRequest = (m, p, o) => herdrRequest(m, p, { ...o, sockPath: "/tmp/absent-herdr-inject.sock" });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", herdr });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error.startsWith("herdr unavailable")).toBe(true);
});

test("every herdr call carries the caller's sockPath through the full accept flow", async () => {
  const seenSockPaths: Array<string | undefined> = [];
  const fakeHerdrWithSock: typeof herdrRequest = async (method, params, o) => {
    seenSockPaths.push(o?.sockPath);
    if (method === "agent.get") return { ok: true, result: agent("idle") as never };
    if (method === "agent.prompt") return { ok: true, result: agent("working") as never };
    return { ok: false, code: "invalid_request", message: method };
  };
  const res = await injectIntoPane({ paneId: "w1:p2", text: "do the thing", herdr: fakeHerdrWithSock, sockPath: "/tmp/bg/herdr.sock" });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p2", delivered: "accepted" } });
  expect(seenSockPaths).toEqual(["/tmp/bg/herdr.sock", "/tmp/bg/herdr.sock"]);
});

test("the stall nudge and its recovery wait also carry sockPath", async () => {
  const seenSockPaths: Array<string | undefined> = [];
  const fakeHerdrWithSock: typeof herdrRequest = async (method, params, o) => {
    seenSockPaths.push(o?.sockPath);
    if (method === "agent.get") return { ok: true, result: agent("idle") as never };
    if (method === "agent.prompt") return { ok: false, code: "timeout", message: "timed out waiting for agent status" };
    if (method === "pane.send_keys") return { ok: true, result: {} as never };
    if (method === "agent.wait") return { ok: false, code: "timeout", message: "timed out waiting for agent status" };
    return { ok: false, code: "invalid_request", message: method };
  };
  const res = await injectIntoPane({ paneId: "w1:p2", text: "x", herdr: fakeHerdrWithSock, sockPath: "/tmp/bg/herdr.sock" });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p2", delivered: "queued" } });
  expect(seenSockPaths.every((s) => s === "/tmp/bg/herdr.sock")).toBe(true);
  expect(seenSockPaths).toHaveLength(4);
});

// ─── preserveDraft ─────────────────────────────────────────────────────────

// Shaped on a real `pane.read` of Claude Code 2.1.281 with format "ansi" and strip_ansi false.
const RULE = `\x1b[0m\x1b[38;2;136;136;136m${"─".repeat(60)}\x1b[0m`;
const GRAY = (s: string) => `\x1b[0m\x1b[38;2;153;153;153m${s}\x1b[0m`;
const composerScreen = (body: string[], above = "") =>
  ["⏺ ok", "", above, RULE, ...body, RULE, `  ${GRAY("O 5.5 [high] | offline")}`, ""].map((l) => `${l}\r`).join("\n");
const readReply = (text: string) => ({ type: "pane_read", read: { text } });

test("composerDraft reads typed text and ignores the prompt marker", () => {
  expect(composerDraft(composerScreen(["❯\xa0my half typed draft"]))).toEqual({ draft: "my half typed draft", stashHeld: false });
  expect(composerDraft(composerScreen(["❯\xa0"]))).toEqual({ draft: "", stashHeld: false });
});

test("composerDraft keeps every line of a multi-line draft", () => {
  expect(composerDraft(composerScreen(["❯\xa0first", "  second"]))?.draft).toBe("first\n  second");
});

test("composerDraft treats dim ghost text as empty but keeps truecolor-styled text", () => {
  expect(composerDraft(composerScreen([`❯\xa0\x1b[2mTry "fix lint errors"\x1b[22m`]))?.draft).toBe("");
  expect(composerDraft(composerScreen([`❯\xa0${GRAY("[Pasted text #1 +20 lines]")}`]))?.draft).toBe("[Pasted text #1 +20 lines]");
});

test("composerDraft sees a stash Claude is already holding", () => {
  expect(composerDraft(composerScreen(["❯\xa0mine"], `${" ".repeat(40)}${GRAY("› stashed")}`))?.stashHeld).toBe(true);
});

test("composerDraft is null when no prompt box is on screen", () => {
  expect(composerDraft("⏺ ok\r\n\r\nsome output\r\n")).toBeNull();
  expect(composerDraft([RULE, "  Do you trust this folder?", RULE].join("\n"))).toBeNull();
});

function draftPane(screen: string, status = "idle") {
  return on((method) => {
    if (method === "agent.get") return agent(status);
    if (method === "pane.read") return readReply(screen);
    if (method === "pane.send_keys") return { type: "ok" };
    if (method === "agent.prompt") return { type: "agent_prompted", agent: agent("working").agent };
    return new HerdrFakeError("invalid_request", method);
  });
}

test("preserveDraft stashes a typed draft with ctrl+s before the prompt, so Claude restores it after", async () => {
  const { herdr, seen } = draftPane(composerScreen(["❯\xa0my half typed draft"]));
  const res = await injectIntoPane({ paneId: "w1:p1", text: "watchdog: hi", herdr, preserveDraft: true });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "pane.read", "pane.send_keys", "agent.prompt"]);
  expect(seen.find((s) => s.method === "pane.read")!.params).toEqual({ pane_id: "w1:p1", source: "visible", format: "ansi", strip_ansi: false });
  expect(seen.find((s) => s.method === "pane.send_keys")!.params).toEqual({ pane_id: "w1:p1", keys: ["ctrl+s"] });
});

test("preserveDraft stashes before a queued prompt on a working pane too", async () => {
  const { herdr, seen } = draftPane(composerScreen(["❯\xa0draft during turn"]), "working");
  const res = await injectIntoPane({ paneId: "w1:p1", text: "later", herdr, preserveDraft: true });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued" } });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "pane.read", "pane.send_keys", "agent.prompt"]);
});

test("preserveDraft never presses ctrl+s on an empty composer, where it would pop a stash into the prompt", async () => {
  const { herdr, seen } = draftPane(composerScreen([`❯\xa0\x1b[2mTry "fix lint errors"\x1b[22m`]));
  await injectIntoPane({ paneId: "w1:p1", text: "x", herdr, preserveDraft: true });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "pane.read", "agent.prompt"]);
});

test("preserveDraft leaves a draft alone when Claude already holds a stash, rather than overwrite it", async () => {
  const { herdr, seen } = draftPane(composerScreen(["❯\xa0new draft"], GRAY("› stashed")));
  await injectIntoPane({ paneId: "w1:p1", text: "x", herdr, preserveDraft: true });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "pane.read", "agent.prompt"]);
});

test("preserveDraft still sends the prompt when the screen read fails", async () => {
  const { herdr, seen } = on((method) => {
    if (method === "agent.get") return agent("idle");
    if (method === "pane.read") return new HerdrFakeError("pane_not_found", "gone");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: agent("working").agent };
    return new HerdrFakeError("invalid_request", method);
  });
  const res = await injectIntoPane({ paneId: "w1:p1", text: "x", herdr, preserveDraft: true });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "accepted" } });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "pane.read", "agent.prompt"]);
});

test("without preserveDraft the screen is never read", async () => {
  const { herdr, seen } = draftPane(composerScreen(["❯\xa0my half typed draft"]));
  await injectIntoPane({ paneId: "w1:p1", text: "x", herdr });
  expect(seen.map((s) => s.method)).toEqual(["agent.get", "agent.prompt"]);
});

// ─── injectAfterTurn ───────────────────────────────────────────────────────

const noLog = { info: () => {}, warn: () => {} } as unknown as import("pino").Logger;

// agent.explain's reply as the daemon reads it: the winning state plus every rule's matched flag.
const explain = (state: string, matched: string[]) => ({
  type: "agent_explain",
  explain: {
    state,
    matched_rule: { id: matched[0] ?? "live_prompt_box", state },
    evaluated_rules: ["osc_title_working", "live_turn_working", "background_agents_working", "background_mcp_task_working", "btw_overlay_working", "live_prompt_box", "live_blocked_form"].map((id) => ({ id, matched: matched.includes(id) })),
  },
});
const LIVE_TURN = explain("working", ["osc_title_working", "live_turn_working", "live_prompt_box"]);
const BACKGROUND_HOLD = explain("working", ["osc_title_working", "background_agents_working", "live_prompt_box"]);
// The hold after a queued slash command ran: its output is now the last line, so herdr's
// narrow background rule no longer matches, but the title spinner is on with no live turn.
const HOLD_AFTER_SLASH = explain("working", ["osc_title_working", "live_prompt_box"]);
const HOLD_SCREEN = { type: "pane_read", read: { text: "⏺ WAITING\n\n✻ Waiting for 1 background agent to finish\n\n❯ /cd /Users/matt\n  ⎿  Moved to /Users/matt\n\n\n❯\n" } };
const PLAIN_SCREEN = { type: "pane_read", read: { text: "⏺ some answer\n\n\n❯\n" } };

test("injectAfterTurn waits for the turn to end, then injects the continuation", async () => {
  let waits = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return LIVE_TURN;
    if (method === "agent.wait") return ++waits === 1 ? new HerdrFakeError("timeout", "timed out waiting for agent status") : agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  const logged: unknown[] = [];
  const log = { info: (o: unknown) => { logged.push(o); }, warn: () => {} } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50, settleMs: 0 });
  const methods = seen.map((s) => s.method);
  expect(methods).toEqual(["agent.explain", "agent.wait", "agent.explain", "agent.wait", "agent.get", "agent.get", "agent.prompt"]);
  expect(seen[1]!.params).toEqual({ target: "w1:p1", until: ["idle", "done"], timeout_ms: 50 });
  expect(seen[6]!.params).toMatchObject({ target: "w1:p1", text: "Continue" });
  expect(logged[0]).toMatchObject({ paneId: "w1:p1", delivered: "accepted" });
});

test("injectAfterTurn injects at once when the turn is parked on background agents", async () => {
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return BACKGROUND_HOLD;
    if (method === "agent.get") return agent("working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  const logged: unknown[] = [];
  const log = { info: (o: unknown) => { logged.push(o); }, warn: () => {} } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.explain", "agent.get", "agent.prompt"]);
  expect(seen[3]!.params).toMatchObject({ target: "w1:p1", text: "Continue" });
  expect(logged[0]).toMatchObject({ paneId: "w1:p1", delivered: "queued" });
});

test("injectAfterTurn injects during the hold after the slash command ran, reading the background line off the screen", async () => {
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return HOLD_AFTER_SLASH;
    if (method === "pane.read") return HOLD_SCREEN;
    if (method === "agent.get") return agent("working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "pane.read", "agent.explain", "pane.read", "agent.get", "agent.prompt"]);
  expect(seen[1]!.params).toEqual({ pane_id: "w1:p1", source: "visible" });
});

test("injectAfterTurn does not treat a working pane without the background line as a hold", async () => {
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return HOLD_AFTER_SLASH;
    if (method === "pane.read") return PLAIN_SCREEN;
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "pane.read", "agent.wait", "agent.get", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn falls through to the wait when a hold clears during the settle window", async () => {
  let explains = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return ++explains === 1 ? BACKGROUND_HOLD : LIVE_TURN;
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.explain", "agent.wait", "agent.get", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn sees a hold that begins mid-leg on the next leg", async () => {
  let explains = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return ++explains === 1 ? LIVE_TURN : BACKGROUND_HOLD;
    if (method === "agent.wait") return new HerdrFakeError("timeout", "timed out waiting for agent status");
    if (method === "agent.get") return agent("working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 20, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.explain", "agent.explain", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn keeps waiting when the background line shows under a blocking prompt", async () => {
  let explains = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.explain") return ++explains === 1 ? explain("blocked", ["live_blocked_form", "background_agents_working", "live_prompt_box"]) : BACKGROUND_HOLD;
    if (method === "agent.wait") return new HerdrFakeError("timeout", "timed out waiting for agent status");
    if (method === "agent.get") return agent("working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 20, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.explain", "agent.explain", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn treats an explain error as no hold and keeps waiting", async () => {
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.get", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn abandons on a herdr error that is not a leg timeout", async () => {
  const { herdr, seen } = on((method) => (method === "agent.wait" ? new HerdrFakeError("agent_not_found", "gone") : new HerdrFakeError("invalid_request", method)));
  const warned: unknown[] = [];
  const log = { info: () => {}, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait"]);
  expect(warned[0]).toMatchObject({ paneId: "w1:p1" });
});

test("injectAfterTurn abandons at the deadline when the turn never ends", async () => {
  const { herdr, seen } = on((method) => (method === "agent.wait" ? new HerdrFakeError("timeout", "timed out") : new HerdrFakeError("invalid_request", method)));
  const warned: unknown[] = [];
  const log = { info: () => {}, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 20, maxWaitMs: 70, settleMs: 0 });
  expect(seen.every((s) => s.method === "agent.wait" || s.method === "agent.explain")).toBe(true);
  expect(seen.filter((s) => s.method === "agent.wait").length).toBeGreaterThanOrEqual(2);
  expect(warned).toHaveLength(1);
});

test("injectAfterTurn passes sockPath through the hold check, the wait and the injection", async () => {
  const { sock, seen, stop } = fakeHerdr((method, params) => {
    if (method === "agent.explain") return LIVE_TURN;
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  stops.push(stop);
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", sockPath: sock, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.get", "agent.get", "agent.prompt"]);
});

test("injectAfterTurn re-probes after a transient idle, then injects once truly settled", async () => {
  let probes = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") { probes++; return probes === 1 ? agent("working") : agent("idle"); }
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log: noLog, legMs: 50, settleMs: 0 });
  expect(seen.filter((s) => s.method === "agent.wait")).toHaveLength(2);
  expect(seen.filter((s) => s.method === "agent.prompt")).toHaveLength(1);
});

test("injectAfterTurn logs a refused continuation at warn, not info", async () => {
  let probes = 0;
  const { herdr, seen } = on((method) => {
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return ++probes === 1 ? agent("idle") : agent("blocked");
    return new HerdrFakeError("invalid_request", method);
  });
  const logged: unknown[] = [];
  const warned: unknown[] = [];
  const log = { info: (o: unknown) => { logged.push(o); }, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.get", "agent.get"]);
  expect(logged).toHaveLength(0);
  expect(warned).toHaveLength(1);
  expect(warned[0]).toMatchObject({ paneId: "w1:p1", delivered: "refused", reason: "at a prompt" });
});

test("injectAfterTurn abandons when the settle re-probe fails", async () => {
  const { herdr, seen } = on((method) => {
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return new HerdrFakeError("agent_not_found", "gone");
    return new HerdrFakeError("invalid_request", method);
  });
  const warned: unknown[] = [];
  const log = { info: () => { throw new Error("info must not be called"); }, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50, settleMs: 0 });
  expect(seen.map((s) => s.method)).toEqual(["agent.explain", "agent.wait", "agent.get"]);
  expect(warned).toHaveLength(1);
  expect(warned[0]).toMatchObject({ paneId: "w1:p1" });
});
