/** The minimal shape any domain's lifecycle state needs for this migration --
    ReviewState and RespondState both satisfy it once mrUrl/status/sessionId/
    agentId are on them. DoctorState carries no sessionId field and is
    excluded from this migration entirely (not passed in). */
export interface LegacySessionState {
  mrUrl: string;
  status: string;
  sessionId?: string;
  agentId?: string;
}

/**
 * Clears a stale `sessionId` on every state that still carries one but has
 * no `agentId` on file -- a state that predates rt agent adoption, when the
 * board resumed a parked session via a bare `claude --resume <sessionId>`
 * rather than the facility's agent-pane resume. Writes the explicit
 * `sessionId: ""` clear: `writeState`'s merge is `patch.sessionId ??
 * prev.sessionId`, so leaving the field out would be a silent no-op (the
 * same convention `tabId` uses elsewhere). A state with an `agentId`, or
 * with no `sessionId` to begin with, is left untouched.
 */
export function migrateLegacySessions<S extends LegacySessionState>(
  domain: string,
  states: Map<string, S>,
  filePath: (mrUrl: string) => string,
  writeState: (path: string, patch: { status: S["status"]; sessionId: string }) => void,
  log: (message: string) => void,
): void {
  for (const state of states.values()) {
    if (!state.sessionId || state.agentId) continue;
    writeState(filePath(state.mrUrl), { status: state.status, sessionId: "" });
    log(`legacy session migration: cleared stale sessionId for ${domain} ${state.mrUrl}`);
  }
}
