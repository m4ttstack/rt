import type { SlackEmojiConfig } from './config.ts';

export type SignalKind = 'review' | 'respond' | 'doctor';

const KINDS: SignalKind[] = ['review', 'respond', 'doctor'];

export function isSignalKind(v: unknown): v is SignalKind {
  return typeof v === 'string' && (KINDS as string[]).includes(v);
}

export const AGENT_STATUS_TOPIC_PREFIX = 'board/agent-status/';

/** One topic segment per launch kind, so a consumer matches all three with
    the single-segment glob `board/agent-status/*`. */
export function agentStatusTopic(kind: SignalKind): string {
  return `${AGENT_STATUS_TOPIC_PREFIX}${kind}`;
}

/** What one agent lifecycle transition writes on the MR's slack message, or
    null for the transitions that say nothing. This is the whole policy: the
    launched agent never touches slack, it only reports status, and the board
    decides here what that status means to the channel.

    `done` with no outcome is deliberately silent -- the human never answered the
    review's posting gate, and an unanswered verdict is not an approve. */
export function signalEmoji(
  kind: SignalKind,
  status: string,
  emoji: SlackEmojiConfig,
  outcome?: string
): string | null {
  if (kind !== 'review') return null;
  if (status === 'reviewing') return emoji.looking;
  if (status !== 'done') return null;
  if (outcome === 'comment') return emoji.commented;
  if (outcome === 'approve') return emoji.approved;
  return null;
}

export interface AgentSignal {
  mrUrl: string;
  iid: number;
  kind: SignalKind;
  status: string;
  outcome?: string;
}

/** `AgentSignal` as it rides the bus. The bus is machine-wide, so a board
    handles only payloads its own status-bin emitted: `appRoot` is the
    launching board's root, which the CLI derives from the state path that
    board handed it rather than from its own environment. */
export interface AgentStatusPayload extends AgentSignal {
  appRoot: string;
}

/** The bus contract every CLI in bin/ emits and the feed consumes. A payload
    with no `appRoot` is not a bus payload and is refused rather than guessed
    at, because handling it on the wrong board posts a latch twice. */
export function parseAgentStatusPayload(
  body: unknown
): AgentStatusPayload | null {
  if (!body || typeof body !== 'object') return null;
  const { mrUrl, iid, kind, status, outcome, appRoot } = body as Record<
    string,
    unknown
  >;
  if (typeof mrUrl !== 'string' || !mrUrl) return null;
  if (typeof appRoot !== 'string' || !appRoot) return null;
  if (!isSignalKind(kind)) return null;
  if (typeof status !== 'string' || !status) return null;
  if (typeof iid !== 'number' || !Number.isFinite(iid)) return null;
  if (outcome !== undefined && typeof outcome !== 'string') return null;
  return {
    mrUrl,
    iid,
    kind,
    status,
    outcome: outcome as string | undefined,
    appRoot,
  };
}
