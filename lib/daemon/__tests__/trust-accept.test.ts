import { describe, test, expect } from "bun:test";
import pino from "pino";
import { acceptTrustOnPane, driveRelocationAccept, driveTrustAccept, type TrustDriveOutcome } from "../trust-accept.ts";

const log = pino({ level: "silent" });

const dialog = (cursor: 1 | 2) => [
  "│ Do you trust the files in this folder?  │",
  `│ ${cursor === 1 ? "❯" : " "} 1. Yes, proceed                       │`,
  `│ ${cursor === 2 ? "❯" : " "} 2. No, exit                           │`,
].join("\n");

const CLEARED = "$ claude\n> \n";
const UNDRIVABLE = "Do you trust the files in this folder?\nnothing parseable here\n";

/**
 * A pane whose screen answers reads and moves under keys, the way the real
 * modal does: one arrow moves the cursor one row, Enter on "Yes" dismisses it.
 * `deaf` models the herdr behavior the live probe found, where a key sent in a
 * batch with Enter never registers.
 */
function pane(opts: { screen: string; deaf?: boolean; readFails?: boolean; sendFails?: boolean } = { screen: dialog(1) }) {
  const state = { screen: opts.screen, cursor: opts.screen === dialog(2) ? 2 : 1 };
  const calls: Array<{ method: string; keys?: string[] }> = [];
  const herdr = (async (method: string, params: any) => {
    calls.push({ method, ...(params?.keys ? { keys: params.keys } : {}) });
    if (method === "pane.read") {
      if (opts.readFails) return { ok: false, code: "unreachable", message: "no pane" };
      return { ok: true, result: { read: { text: state.screen } } };
    }
    if (method === "pane.send_keys") {
      if (opts.sendFails) return { ok: false, code: "unreachable", message: "no pane" };
      const keys: string[] = params.keys;
      // The live finding: only a lone key registers.
      if (!opts.deaf || keys.length === 1) {
        for (const k of keys) {
          if (k === "up") state.cursor = state.cursor === 2 ? 1 : 1;
          if (k === "down") state.cursor = state.cursor === 1 ? 2 : 2;
          if (k === "enter" && state.cursor === 1) state.screen = CLEARED;
        }
        if (state.screen !== CLEARED) state.screen = dialog(state.cursor as 1 | 2);
      }
      return { ok: true, result: {} };
    }
    return { ok: false, code: "invalid_request", message: method };
  }) as never;
  return { herdr, calls, state };
}

const drive = (p: ReturnType<typeof pane>): Promise<TrustDriveOutcome> =>
  driveTrustAccept({ herdr: p.herdr, sock: {}, pane: "w1:p1", log, context: {}, settleMs: 1, stepMs: 1 });

describe("acceptTrustOnPane", () => {
  test("an unreachable herdr ends the check at once instead of polling out the register budget", async () => {
    const calls: string[] = [];
    const herdr = (async (method: string) => { calls.push(method); return { ok: false, code: "unreachable", message: "no server" }; }) as never;
    const started = Date.now();
    const outcome = await acceptTrustOnPane({ herdr, sock: {}, pane: "w1:p1", log, context: {}, settleMs: 1, stepMs: 1 });
    expect(outcome).toBe("unchecked");
    expect(calls).toEqual(["agent.get"]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a single agent.get timeout is retried, not treated as unreachable: the register budget already bounds the loop", async () => {
    const screens: Record<string, string> = { "w1:p1": dialog(1) };
    let getCalls = 0;
    const herdr = (async (method: string, params: any) => {
      if (method === "agent.get") {
        getCalls += 1;
        if (getCalls === 1) return { ok: false, code: "timeout", message: "herdr agent.get timed out after 3000ms" };
        return { ok: true, result: { agent: { agent_status: "blocked" } } };
      }
      if (method === "agent.wait") return { ok: true, result: { agent: { agent_status: "blocked" } } };
      if (method === "pane.read") return { ok: true, result: { read: { text: screens[params.pane_id] ?? "" } } };
      if (method === "pane.send_keys") { screens[params.pane_id] = CLEARED; return { ok: true, result: {} }; }
      return { ok: false, code: "invalid_request", message: method };
    }) as never;
    const outcome = await acceptTrustOnPane({ herdr, sock: {}, pane: "w1:p1", log, context: {}, settleMs: 1, stepMs: 1, registerBudgetMs: 2_000 });
    expect(outcome).toBe("accepted");
    expect(getCalls).toBeGreaterThan(1);
  });

  test("a pane herdr has no agent for yet is still read, and its dialog answered", async () => {
    const screens: Record<string, string> = { "w1:p1": dialog(1) };
    const herdr = (async (method: string, params: any) => {
      if (method === "agent.get") return { ok: false, code: "not_found", message: "no agent" };
      if (method === "pane.read") return { ok: true, result: { read: { text: screens[params.pane_id] ?? "" } } };
      if (method === "pane.send_keys") { screens[params.pane_id] = CLEARED; return { ok: true, result: {} }; }
      return { ok: false, code: "invalid_request", message: method };
    }) as never;
    const outcome = await acceptTrustOnPane({ herdr, sock: {}, pane: "w1:p1", log, context: {}, settleMs: 1, stepMs: 1, registerBudgetMs: 5 });
    expect(outcome).toBe("accepted");
  });

  test("no dialog on a pane that never registered reads unchecked, not none", async () => {
    const herdr = (async (method: string) => {
      if (method === "agent.get") return { ok: false, code: "not_found", message: "no agent" };
      if (method === "pane.read") return { ok: true, result: { read: { text: "bash: claude: command not found" } } };
      return { ok: false, code: "invalid_request", message: method };
    }) as never;
    expect(await acceptTrustOnPane({ herdr, sock: {}, pane: "w1:p1", log, context: {}, registerBudgetMs: 5 })).toBe("unchecked");
  });
});

describe("driveTrustAccept", () => {
  test("the plain dialog is accepted with a lone enter", async () => {
    const p = pane({ screen: dialog(1) });
    expect(await drive(p)).toBe("accepted");
    expect(p.calls.filter((c) => c.method === "pane.send_keys")).toEqual([{ method: "pane.send_keys", keys: ["enter"] }]);
    expect(p.state.screen).toBe(CLEARED);
  });

  test("the elevated dialog is walked one key per call, never a batch (RT-156)", async () => {
    const p = pane({ screen: dialog(2) });
    expect(await drive(p)).toBe("accepted");
    const sends = p.calls.filter((c) => c.method === "pane.send_keys");
    expect(sends).toEqual([
      { method: "pane.send_keys", keys: ["up"] },
      { method: "pane.send_keys", keys: ["enter"] },
    ]);
    for (const s of sends) expect(s.keys).toHaveLength(1);
  });

  test("the cursor is verified between presses: a read sits between the step and the enter", async () => {
    const p = pane({ screen: dialog(2) });
    await drive(p);
    const shape = p.calls.map((c) => `${c.method}${c.keys ? `:${c.keys.join("+")}` : ""}`);
    expect(shape[0]).toBe("pane.read");
    expect(shape[1]).toBe("pane.send_keys:up");
    expect(shape[2]).toBe("pane.read");
    expect(shape[3]).toBe("pane.send_keys:enter");
  });

  test("a pane that only registers lone keys still gets accepted (the batch that failed live)", async () => {
    const p = pane({ screen: dialog(2), deaf: true });
    expect(await drive(p)).toBe("accepted");
  });

  test("a cursor that will not move is reported stuck rather than entered on", async () => {
    const p = pane({ screen: dialog(2), deaf: true });
    // Make every key a no-op: the cursor never reaches "Yes".
    const frozen = { ...p, herdr: (async (method: string) => (method === "pane.read" ? { ok: true, result: { read: { text: dialog(2) } } } : { ok: true, result: {} })) as never };
    expect(await drive(frozen)).toBe("stuck");
  });

  test("no dialog on the first look is reported as such, and never sent a key", async () => {
    const p = pane({ screen: "reading the brief: trust the fixture owner\n" });
    expect(await drive(p)).toBe("no-dialog");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("a dialog whose selection cannot be read is stuck, never guessed at", async () => {
    const p = pane({ screen: UNDRIVABLE });
    expect(await drive(p)).toBe("stuck");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("an unreadable screen is unchecked, and a send that errors is stuck", async () => {
    expect(await drive(pane({ screen: dialog(1), readFails: true }))).toBe("unchecked");
    expect(await drive(pane({ screen: dialog(1), sendFails: true }))).toBe("stuck");
  });
});

const TREE = "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/pippin";

const relocation = (cursor: 1 | 2, path: string = TREE) => [
  "│ EnterWorktree                                                        │",
  `│ permission-root relocation to "${path}" — a model-supplied`,
  "│ worktree outside .claude/worktrees/                                  │",
  "│ Do you want to proceed?                                              │",
  `│ ${cursor === 1 ? "❯" : " "} 1. Yes                                   │`,
  `│ ${cursor === 2 ? "❯" : " "} 2. No, and tell Claude what to do differently (esc) │`,
].join("\n");

/** Same living pane as `pane()`, painting the relocation dialog instead. */
function relocationPane(opts: { cursor?: 1 | 2; path?: string } = {}) {
  const state = { cursor: opts.cursor ?? 1, cleared: false };
  const path = opts.path ?? TREE;
  const calls: Array<{ method: string; keys?: string[] }> = [];
  const herdr = (async (method: string, params: any) => {
    calls.push({ method, ...(params?.keys ? { keys: params.keys } : {}) });
    if (method === "pane.read") {
      return { ok: true, result: { read: { text: state.cleared ? CLEARED : relocation(state.cursor as 1 | 2, path) } } };
    }
    if (method === "pane.send_keys") {
      for (const k of params.keys as string[]) {
        if (k === "up") state.cursor = 1;
        if (k === "down") state.cursor = 2;
        if (k === "enter" && state.cursor === 1) state.cleared = true;
      }
      return { ok: true, result: {} };
    }
    return { ok: false, code: "invalid_request", message: method };
  }) as never;
  return { herdr, calls, state };
}

const driveRelocation = (p: { herdr: never }, registered: string[] = [TREE]) =>
  driveRelocationAccept({
    herdr: p.herdr, sock: {}, pane: "w1:p1", log, context: {}, settleMs: 1, stepMs: 1,
    isRegisteredTree: (candidate: string) => registered.includes(candidate),
  });

describe("driveRelocationAccept", () => {
  test("a registry-verified path is accepted with a bare enter", async () => {
    const p = relocationPane();
    expect(await driveRelocation(p)).toBe("accepted");
    expect(p.calls.filter((c) => c.method === "pane.send_keys")).toEqual([{ method: "pane.send_keys", keys: ["enter"] }]);
    expect(p.state.cleared).toBe(true);
  });

  test("the cursor on No is walked one key per call before entering", async () => {
    const p = relocationPane({ cursor: 2 });
    expect(await driveRelocation(p)).toBe("accepted");
    const sends = p.calls.filter((c) => c.method === "pane.send_keys");
    expect(sends).toEqual([
      { method: "pane.send_keys", keys: ["up"] },
      { method: "pane.send_keys", keys: ["enter"] },
    ]);
  });

  test("a path the registry does not know is refused before any key is sent", async () => {
    const p = relocationPane({ path: "/tmp/somewhere-else" });
    expect(await driveRelocation(p)).toBe("unregistered");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("no dialog on screen reports no-dialog without a key", async () => {
    const p = pane({ screen: "reading the brief\n" });
    expect(await driveRelocation(p as never)).toBe("no-dialog");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("the folder-trust dialog is not this driver's to answer", async () => {
    const p = pane({ screen: dialog(1) });
    expect(await driveRelocation(p as never)).toBe("no-dialog");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("a resolves-to path outside the registry refuses even when the display path is registered", async () => {
    const screen = [
      "╭──────────────────────────────────────────────────────────────────────╮",
      "│ EnterWorktree                                                        │",
      `│ permission-root relocation to "${TREE}" (resolves to "/tmp/elsewhere") — a`,
      "│ model-supplied worktree outside .claude/worktrees/                   │",
      "│ Do you want to proceed?                                              │",
      "│ ❯ 1. Yes                                                             │",
      "│   2. No                                                              │",
      "╰──────────────────────────────────────────────────────────────────────╯",
    ].join("\n");
    const p = pane({ screen });
    expect(await driveRelocation(p as never)).toBe("unregistered");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("a resolves-to path the registry also knows is accepted", async () => {
    const other = "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/merry";
    const screen = [
      "╭──────────────────────────────────────────────────────────────────────╮",
      "│ EnterWorktree                                                        │",
      `│ permission-root relocation to "${TREE}" (resolves to "${other}") — a`,
      "│ model-supplied worktree outside .claude/worktrees/                   │",
      "│ Do you want to proceed?                                              │",
      "│ ❯ 1. Yes                                                             │",
      "│   2. No                                                              │",
      "╰──────────────────────────────────────────────────────────────────────╯",
    ].join("\n");
    const state = { cleared: false };
    const herdr = (async (method: string, params: any) => {
      if (method === "pane.read") return { ok: true, result: { read: { text: state.cleared ? CLEARED : screen } } };
      if (method === "pane.send_keys") { if ((params.keys as string[]).includes("enter")) state.cleared = true; return { ok: true, result: {} }; }
      return { ok: false, code: "invalid_request", message: method };
    }) as never;
    expect(await driveRelocation({ herdr }, [TREE, other])).toBe("accepted");
  });

  test("a prompt whose path cannot be read is stuck, never guessed at", async () => {
    const screen = [
      "│ permission-root relocation to somewhere unquoted │",
      "│ Do you want to proceed?                          │",
      "│ ❯ 1. Yes                                         │",
    ].join("\n");
    const p = pane({ screen });
    expect(await driveRelocation(p as never)).toBe("stuck");
    expect(p.calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });
});
