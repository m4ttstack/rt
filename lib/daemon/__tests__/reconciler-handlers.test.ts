/**
 * reconciler:* handler tests. `status` returns the reconciler's sweep
 * snapshot verbatim (or the empty default when no reconciler is wired,
 * mirroring gate.ts's noopPush fallback); `clear` validates `agentId` and
 * delegates to `reconciler.clear`.
 */
import { describe, test, expect } from "bun:test";
import { createReconcilerHandlers } from "../handlers/reconciler.ts";
import type { ReconcilerStatus } from "../../../packages/rt-client/src/commands.ts";

function fakeReconciler(status: ReconcilerStatus): {
  reconciler: { status(): ReconcilerStatus; clear(agentId: string): void };
  clearedIds: string[];
} {
  const clearedIds: string[] = [];
  return {
    reconciler: {
      status: () => status,
      clear: (agentId: string) => { clearedIds.push(agentId); },
    },
    clearedIds,
  };
}

const SAMPLE_STATUS: ReconcilerStatus = {
  sweptAt: 12345,
  herdrReachable: true,
  executors: [{
    agentId: "ag-1", repo: "repo-tools", subject: "agent:ag-1", surface: "herdr",
    sessionId: "sess-1", paneRef: "w1:p1", state: "live", since: 100, openGateIds: [],
  }],
};

describe("reconciler handlers", () => {
  test("reconciler:status returns the reconciler's status verbatim", async () => {
    const { reconciler } = fakeReconciler(SAMPLE_STATUS);
    const handlers = createReconcilerHandlers({ reconciler });

    const res = await handlers["reconciler:status"]({});
    expect(res).toEqual({ ok: true, data: SAMPLE_STATUS });
  });

  test("reconciler:status defaults to the empty snapshot when no reconciler is wired", async () => {
    const handlers = createReconcilerHandlers({});
    const res = await handlers["reconciler:status"]({});
    expect(res).toEqual({ ok: true, data: { sweptAt: 0, herdrReachable: false, executors: [] } });
  });

  test("reconciler:clear rejects a missing agentId", async () => {
    const { reconciler, clearedIds } = fakeReconciler({ sweptAt: 0, herdrReachable: false, executors: [] });
    const handlers = createReconcilerHandlers({ reconciler });

    const res = await handlers["reconciler:clear"]({});
    expect(res).toEqual({ ok: false, error: "missing agentId" });
    expect(clearedIds).toEqual([]);
  });

  test("reconciler:clear rejects a blank agentId", async () => {
    const { reconciler, clearedIds } = fakeReconciler({ sweptAt: 0, herdrReachable: false, executors: [] });
    const handlers = createReconcilerHandlers({ reconciler });

    const res = await handlers["reconciler:clear"]({ agentId: "   " });
    expect(res).toEqual({ ok: false, error: "missing agentId" });
    expect(clearedIds).toEqual([]);
  });

  test("reconciler:clear calls reconciler.clear(agentId) and returns cleared:true", async () => {
    const { reconciler, clearedIds } = fakeReconciler({ sweptAt: 0, herdrReachable: false, executors: [] });
    const handlers = createReconcilerHandlers({ reconciler });

    const res = await handlers["reconciler:clear"]({ agentId: "ag-1" });
    expect(res).toEqual({ ok: true, data: { cleared: true } });
    expect(clearedIds).toEqual(["ag-1"]);
  });
});
