import { describe, expect, test } from "bun:test";
import { computeView, gateAgentId } from "../reconciler-view.ts";
import type { GateRow } from "../gates-store.ts";
import type { AgentRecord } from "../../state/agents-store.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1", repo: "gitlab.com/g/p", cwd: "/wt/a", provider: "claude",
  surface: "herdr", sessionId: "s-1", createdAt: 1, ...over,
});
const pane = (over: Partial<LivePane> = {}): LivePane => ({
  paneRef: "w1:p1", sockPath: "/s", workspaceId: "w1", agentStatus: "idle",
  sessionId: "s-1", cwd: "/wt/a", ...over,
});
/** Every field GateRow requires, so a call site only spells the ones it cares about. */
const gateRow = (over: Partial<GateRow> = {}): GateRow => ({
  id: "g1", subject: "run:x", kind: "question",
  questions: [{ id: "q", label: "Pick", multi: false, options: ["a", "b"] }],
  meta: null, status: "open", answer: null,
  openedAt: 1, parkedAt: null, closedAt: null, closedReason: null,
  supersededBy: null, agent: null, pane: null, nudge: null, delivery: null,
  released: false, owner: null, escalatedAt: null,
  ...over,
});
const base = { openGates: [] as GateRow[], clearedAgentIds: new Set<string>(), visibleWorkspaceIds: null };

test("resolved idle pane is live", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()] }, 10);
  expect(v).toMatchObject({ agentId: "a1", state: "live", paneRef: "w1:p1" });
});

test("agent_status blocked maps to blocked", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane({ agentStatus: "blocked" })] }, 10);
  expect(v!.state).toBe("blocked");
});

test("no resolvable pane is gone", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [] }, 10);
  expect(v!.state).toBe("gone");
  expect(v!.paneRef).toBeNull();
});

test("herdr unreachable is unknown, never gone", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: null }, 10);
  expect(v!.state).toBe("unknown");
});

test("cleared tombstone wins", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [], clearedAgentIds: new Set(["a1"]) }, 10);
  expect(v!.state).toBe("cleared");
});

test("cleared tombstone wins even when herdr is unreachable", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: null, clearedAgentIds: new Set(["a1"]) }, 10);
  expect(v!.state).toBe("cleared");
});

test("pane in a non-visible workspace is hidden", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()], visibleWorkspaceIds: new Set(["w9"]) }, 10);
  expect(v!.state).toBe("hidden");
  expect(v!.paneRef).toBe("w1:p1");
});

test("pane in a visible workspace is live, not hidden", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()], visibleWorkspaceIds: new Set(["w1"]) }, 10);
  expect(v!.state).toBe("live");
});

test("blocked wins over hidden when both apply", () => {
  const [v] = computeView(
    { ...base, agents: [agent()], panes: [pane({ agentStatus: "blocked" })], visibleWorkspaceIds: new Set(["w9"]) },
    10,
  );
  expect(v!.state).toBe("blocked");
});

test("no joined gates: subject falls back to agent:<id>", () => {
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()] }, 10);
  expect(v!.subject).toBe("agent:a1");
  expect(v!.openGateIds).toEqual([]);
});

test("open gates join by subject-worktree-session", () => {
  const g = gateRow({ id: "g1", subject: "run:x", origin: { worktree: "/wt/a" } });
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()], openGates: [g] }, 10);
  expect(v!.openGateIds).toEqual(["g1"]);
  expect(v!.subject).toBe("run:x");
});

test("gate joins by origin.paneId directly, even without a resolvable pane", () => {
  const g = gateRow({ id: "g1", subject: "run:x", origin: { paneId: "w1:p1" } });
  const rec = agent({ paneId: "w1:p1" });
  const id = gateAgentId(g, [rec], []);
  expect(id).toBe("a1");
});

test("gate joins by nudge.session directly", () => {
  const g = gateRow({ id: "g1", subject: "run:x", nudge: { session: "s-1" } });
  const id = gateAgentId(g, [agent()], []);
  expect(id).toBe("a1");
});

test("gate with no matching hints joins nothing", () => {
  const g = gateRow({ id: "g1", subject: "run:x", origin: { worktree: "/wt/other" } });
  const [v] = computeView({ ...base, agents: [agent()], panes: [pane()], openGates: [g] }, 10);
  expect(v!.openGateIds).toEqual([]);
  expect(v!.subject).toBe("agent:a1");
});

test("gate joined to one agent does not leak onto another agent's view", () => {
  const g = gateRow({ id: "g1", subject: "run:x", nudge: { session: "s-1" } });
  const other = agent({ id: "a2", sessionId: "s-2", cwd: "/wt/b" });
  const otherPane = pane({ paneRef: "w1:p2", sessionId: "s-2", cwd: "/wt/b" });
  const views = computeView({ ...base, agents: [agent(), other], panes: [pane(), otherPane], openGates: [g] }, 10);
  expect(views.find((v) => v.agentId === "a1")!.openGateIds).toEqual(["g1"]);
  expect(views.find((v) => v.agentId === "a2")!.openGateIds).toEqual([]);
});
