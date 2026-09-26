import type { MRDetail } from '@mattstack/glance';
import type { Commands, RtResponse } from '@mattstack/rt-client';
import {
  summarizeDiscussions,
  type CommentThread,
  type GeneralComment,
} from './discussions.ts';

/** The drawer's address for one thread. `repo` is the client's rt repo label;
    the route resolves it to a repo identity before anything is sent.
    `author` is the MR author, which thread status is computed against. */
interface ThreadTarget {
  repo: string;
  iid: number;
  discussionId: string;
  author: string | null;
}

export interface ThreadReply extends ThreadTarget {
  body: string;
}

export interface ThreadResolve extends ThreadTarget {
  resolved: boolean;
}

type WriteVerb = 'discussions:reply' | 'discussions:resolve';

/** `rtCommand` narrowed to the two thread writes; tests pass a stand-in. */
export type ThreadWriteSend = (
  verb: WriteVerb,
  payload: Commands[WriteVerb]['payload']
) => Promise<RtResponse<Commands[WriteVerb]['data']>>;

export type ThreadWriteResult =
  | { ok: true; threads: CommentThread[]; comments: GeneralComment[] }
  | { ok: false; error: string };

function parseTarget(raw: unknown): ThreadTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const { repo, iid, discussionId, author } = raw as Record<string, unknown>;
  if (typeof repo !== 'string' || !repo) return null;
  if (typeof iid !== 'number' || !Number.isInteger(iid)) return null;
  if (typeof discussionId !== 'string' || !discussionId) return null;
  if (author !== null && typeof author !== 'string') return null;
  return { repo, iid, discussionId, author };
}

export function parseThreadReply(raw: unknown): ThreadReply | null {
  const target = parseTarget(raw);
  const body = (raw as { body?: unknown } | null)?.body;
  if (!target || typeof body !== 'string' || !body.trim()) return null;
  return { ...target, body };
}

export function parseThreadResolve(raw: unknown): ThreadResolve | null {
  const target = parseTarget(raw);
  const resolved = (raw as { resolved?: unknown } | null)?.resolved;
  if (!target || typeof resolved !== 'boolean') return null;
  return { ...target, resolved };
}

async function write(
  send: ThreadWriteSend,
  verb: WriteVerb,
  payload: Commands[WriteVerb]['payload'],
  author: string | null,
  botUsernames: string[]
): Promise<ThreadWriteResult> {
  const res = await send(verb, payload);
  if (!res.ok || !res.data)
    return { ok: false, error: res.error ?? 'empty daemon response' };
  const detail = { discussions: res.data.discussions } as MRDetail;
  return { ok: true, ...summarizeDiscussions(detail, author, botUsernames) };
}

export function replyToThread(
  send: ThreadWriteSend,
  repoName: string,
  r: ThreadReply,
  botUsernames: string[]
): Promise<ThreadWriteResult> {
  return write(
    send,
    'discussions:reply',
    { repoName, iid: r.iid, discussionId: r.discussionId, body: r.body },
    r.author,
    botUsernames
  );
}

export function resolveThread(
  send: ThreadWriteSend,
  repoName: string,
  r: ThreadResolve,
  botUsernames: string[]
): Promise<ThreadWriteResult> {
  return write(
    send,
    'discussions:resolve',
    {
      repoName,
      iid: r.iid,
      discussionId: r.discussionId,
      resolved: r.resolved,
    },
    r.author,
    botUsernames
  );
}
