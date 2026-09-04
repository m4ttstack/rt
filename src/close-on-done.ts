import type { AgentSignal } from "./agent-signal.ts";

/** Resolves the tabId a launched pane is running in for one signal, or
    undefined when no state (or no tabId) is on file for it. */
export type TabIdResolver = (signal: AgentSignal) => string | undefined;

/** Clears the tabId this signal's close just handled, from whichever state
    store its kind owns -- so a later sweep never sees a stale tabId on an
    already-closed pane and re-fires a redundant close. */
export type TabIdClearer = (signal: AgentSignal) => void;

/** Close the herdr tab a launched pane reports done from. `error` never
    closes -- a failing pane is kept open for forensics. Best-effort: a
    throw from `close` never reaches the caller, since a close failure must
    not break the status-report handler this is wired beside. `clearTabId`
    runs even when `close` throws -- a close failure usually means the tab
    is already gone, and either way the stale tabId must not linger to
    re-trigger a sweep's own close action. */
export async function closeOnDone(
  signal: AgentSignal,
  resolveTabId: TabIdResolver,
  close: (tabId: string) => Promise<void>,
  clearTabId: TabIdClearer,
): Promise<void> {
  if (signal.status !== "done") return;
  const tabId = resolveTabId(signal);
  if (!tabId) return;
  try {
    await close(tabId);
  } catch (err) {
    console.error(`tab close failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`);
  }
  clearTabId(signal);
}
