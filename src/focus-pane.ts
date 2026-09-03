import { focusTab } from "./herdr.ts";
import { paneFocus } from "@mattstack/rt-client";

export interface FocusPaneDeps {
  paneFocus: typeof paneFocus;
  focusTab: typeof focusTab;
}

/** Tray-raised focus when a paneId is on file; herdr-internal tab focus otherwise. */
export async function focusPane(
  state: { paneId?: string; tabId?: string },
  deps: FocusPaneDeps = { paneFocus, focusTab },
): Promise<void> {
  if (state.paneId) {
    const res = await deps.paneFocus({ paneId: state.paneId });
    if (res.ok) return;
    console.error(`pane focus failed, falling back to tab focus: ${res.error}`);
  }
  if (state.tabId) await deps.focusTab(state.tabId);
}
