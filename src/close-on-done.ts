import type { AgentSignal } from "./agent-signal.ts";

/** Resolves the tabId a launched pane is running in for one signal, or
    undefined when no state (or no tabId) is on file for it. */
export type TabIdResolver = (signal: AgentSignal) => string | undefined;

/** Close the herdr tab a launched pane reports done from. `error` never
    closes -- a failing pane is kept open for forensics. Best-effort: a
    throw from `close` never reaches the caller, since a close failure must
    not break the status-report handler this is wired beside. */
export async function closeOnDone(
  signal: AgentSignal,
  resolveTabId: TabIdResolver,
  close: (tabId: string) => Promise<void>,
): Promise<void> {
  if (signal.status !== "done") return;
  const tabId = resolveTabId(signal);
  if (!tabId) return;
  try {
    await close(tabId);
  } catch (err) {
    console.error(`tab close failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`);
  }
}
