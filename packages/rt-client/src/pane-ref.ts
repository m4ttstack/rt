export const BG_PREFIX = "bg:";

export type PaneServer = "visible" | "bg";

export interface PaneRef {
  server: PaneServer;
  paneId: string;
}

export function parsePaneRef(ref: string): PaneRef {
  if (ref.startsWith(BG_PREFIX)) {
    return {
      server: "bg",
      paneId: ref.slice(BG_PREFIX.length),
    };
  }
  return {
    server: "visible",
    paneId: ref,
  };
}

export function formatPaneRef(paneId: string, server: PaneServer): string {
  if (server === "visible") {
    return paneId;
  }
  // Idempotent: herdr pane ids (w<N>:p<N>) can never start with "bg:", so an
  // already-formatted ref passes through unchanged instead of nesting.
  if (paneId.startsWith(BG_PREFIX)) {
    return paneId;
  }
  return BG_PREFIX + paneId;
}
