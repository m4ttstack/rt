/**
 * reconciler:* : read-only status and manual clear over the executor
 * reconciler (lib/daemon/reconciler.ts). The reconciler itself emits
 * `reconciler.transition`, `reconciler.delivery`, and `reconciler.execution`
 * from its sweep and expectation-checking loop (and handlers/gate.ts's
 * answer-time guarantee reuses the same topics); this module adds no new
 * emit paths, it only reads `status()` and drives `clear()`.
 */
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult } from "./types.ts";
import type { Reconciler } from "../reconciler.ts";

/** Callers that omit `reconciler` (e.g. handler-only tests, or a router
    built before the reconciler exists) get the sweep-less default snapshot
    and a no-op clear -- mirrors gate.ts's noopPush idiom. */
const EMPTY_STATUS: Commands["reconciler:status"]["data"] = { sweptAt: 0, herdrReachable: false, executors: [] };
const noopReconciler: Pick<Reconciler, "status" | "clear"> = {
  status: () => EMPTY_STATUS,
  clear: () => {},
};

export function createReconcilerHandlers(
  deps: { reconciler?: Pick<Reconciler, "status" | "clear"> } = {},
): { "reconciler:status": (payload: unknown) => Promise<CommandResult<"reconciler:status">> }
  & { "reconciler:clear": (payload: unknown) => Promise<CommandResult<"reconciler:clear">> } {
  const reconciler = deps.reconciler ?? noopReconciler;

  return {
    "reconciler:status": async (_rawPayload: unknown) => {
      return { ok: true as const, data: reconciler.status() };
    },

    "reconciler:clear": async (rawPayload: unknown) => {
      const payload = rawPayload as Commands["reconciler:clear"]["payload"] | undefined;
      const agentId = typeof payload?.agentId === "string" ? payload.agentId.trim() : "";
      if (!agentId) return { ok: false as const, error: "missing agentId" };
      reconciler.clear(agentId);
      return { ok: true as const, data: { cleared: true as const } };
    },
  };
}
