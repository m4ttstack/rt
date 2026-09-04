import type { AgentSignal } from "./agent-signal.ts";

/** Resolves the tabId a launched pane is running in for one signal, or
    undefined when no state (or no tabId) is on file for it. */
export type TabIdResolver = (signal: AgentSignal) => string | undefined;

/** Clears the tabId this signal's close just handled, from whichever state
    store its kind owns -- so a later sweep never sees a stale tabId on an
    already-closed pane and re-fires a redundant close. */
export type TabIdClearer = (signal: AgentSignal) => void;

/** Close the herdr tab a launched pane reports done from. `error` never
    closes -- a failing pane is kept open for forensics. The tabId is cleared
    FIRST and the close itself is detached (fired, never awaited): the caller
    is the /agent/status handler, and a hung herdr close must not stall that
    request; a close that then fails just leaves a tab for the human, while
    the cleared tabId already guarantees no sweep re-fires on it. */
export function closeOnDone(
  signal: AgentSignal,
  resolveTabId: TabIdResolver,
  close: (tabId: string) => Promise<void>,
  clearTabId: TabIdClearer,
): void {
  if (signal.status !== "done") return;
  const tabId = resolveTabId(signal);
  if (!tabId) return;
  clearTabId(signal);
  void close(tabId).catch((err) => {
    console.error(`tab close failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`);
  });
}
