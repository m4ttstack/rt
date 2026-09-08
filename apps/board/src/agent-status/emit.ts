import { resolve } from 'path';

import { eventsEmit } from '@mattstack/rt-client';
import {
  agentStatusTopic,
  type AgentSignal,
  type AgentStatusPayload,
} from '../agent-signal.ts';

export interface EmitIo {
  emit(
    topic: string,
    payload: unknown
  ): Promise<{ ok: boolean; error?: string }>;
  log(line: string): void;
}

const defaultIo: EmitIo = {
  emit: (topic, payload) => eventsEmit(topic, payload),
  log: line => console.error(line),
};

/** The board's root, recovered from a state path it handed a pane. Every such
    path is `<APP_ROOT>/state/<lane>/<slug>.json`, so the root is the third
    ancestor, in the checkout form and the compiled form alike. */
export function boardRootFromStatePath(statePath: string): string {
  return resolve(statePath, '..', '..', '..');
}

/** Publish one lifecycle transition on the rt bus. Best-effort by design: the
    state file the CLI already wrote is the source of truth, so a daemon that
    is down costs one stderr line and never the CLI's exit status.

    The scoping root is passed in rather than read from the environment:
    `rt agent start` hands a pane none of the server's, so a pane that resolved
    its own APP_ROOT would stamp the wrong board whenever the server runs under
    a BOARD_APP_ROOT override. */
export async function emitAgentStatus(
  signal: AgentSignal,
  appRoot: string,
  io: EmitIo = defaultIo
): Promise<void> {
  if (!signal.mrUrl) return;
  const payload: AgentStatusPayload = { ...signal, appRoot };
  try {
    const res = await io.emit(agentStatusTopic(signal.kind), payload);
    if (!res.ok)
      io.log(`agent-status emit refused: ${res.error ?? 'unknown error'}`);
  } catch (err) {
    io.log(
      `agent-status emit failed: ${err instanceof Error ? err.message : err}`
    );
  }
}
