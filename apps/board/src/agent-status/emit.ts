import { eventsEmit } from '@mattstack/rt-client';
import {
  agentStatusTopic,
  type AgentSignal,
  type AgentStatusPayload,
} from '../agent-signal.ts';
import { APP_ROOT } from '../app-root.ts';

export interface EmitIo {
  emit(
    topic: string,
    payload: unknown
  ): Promise<{ ok: boolean; error?: string }>;
  appRoot: string;
  log(line: string): void;
}

const defaultIo: EmitIo = {
  emit: (topic, payload) => eventsEmit(topic, payload),
  appRoot: APP_ROOT,
  log: line => console.error(line),
};

/** Publish one lifecycle transition on the rt bus. Best-effort by design: the
    state file the CLI already wrote is the source of truth, so a daemon that
    is down costs one stderr line and never the CLI's exit status. */
export async function emitAgentStatus(
  signal: AgentSignal,
  io: EmitIo = defaultIo
): Promise<void> {
  if (!signal.mrUrl) return;
  const payload: AgentStatusPayload = { ...signal, appRoot: io.appRoot };
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
