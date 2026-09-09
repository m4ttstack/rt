import { Database } from 'bun:sqlite';

import {
  getKvValue,
  getStateDb,
  persistOrWarn,
  runCriticalWrite,
  setKvValue,
} from './state/index.ts';

/** How far back the first index build reaches. Review requests older than the
    board's stale window are irrelevant, so we never page the whole channel. */
const INITIAL_LOOKBACK_DAYS = 90;
const MAX_PAGES = 25;

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
}

export interface SlackIndex {
  channelId: string;
  teamDomain: string;
  /** Newest message ts seen; the next sync only fetches messages after this. */
  lastTs: string;
  messages: SlackMessage[];
}

export interface SlackRef {
  mrUrl: string;
  iid: number;
  status: 'found' | 'notfound';
  channelId?: string;
  /** The message reactions land on: the request message, or (when that message
      links several MRs) a threaded reply pinned to this MR. Undefined for a
      multi-MR message with no reply yet — created on the first reaction. */
  messageTs?: string;
  /** Set when the request message links multiple MRs: reactions go on a reply. */
  multi?: boolean;
  /** The request message's ts (the thread parent) when `multi`. */
  parentTs?: string;
  /** Cached for building threaded reply permalinks server-side. */
  teamDomain?: string;
  permalink?: string;
  /** Emoji names currently on the target message (of the ones we care about). */
  reactions?: string[];
  checkedAt: number;
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Slack archive permalink for a message, built from its ts (no API call). */
export function buildPermalink(
  teamDomain: string,
  channelId: string,
  ts: string
): string {
  return `https://${teamDomain}/archives/${channelId}/p${ts.replace('.', '')}`;
}

/** Permalink for a threaded reply (opens in-thread), matching Slack's own form. */
export function buildThreadPermalink(
  teamDomain: string,
  channelId: string,
  replyTs: string,
  parentTs: string
): string {
  return `https://${teamDomain}/archives/${channelId}/p${replyTs.replace('.', '')}?thread_ts=${parentTs}&cid=${channelId}`;
}

const MR_URL_RE = /https:\/\/[^\s<>|]+\/-\/merge_requests\/\d+/g;

/** Distinct GitLab MR URLs referenced in a message. More than one means a
    single message is asking for review of several MRs at once. */
export function extractMrUrls(text: string): string[] {
  return [...new Set(text.match(MR_URL_RE) ?? [])];
}

/**
 * The review-request message for an MR: the earliest channel message whose text
 * contains the MR's web URL. Matching on the full URL avoids cross-project
 * collisions and any need to map GitLab authors to Slack users. Earliest wins
 * so an ask-for-review post is chosen over later replies that quote the link.
 */
export function matchReviewMessage(
  messages: SlackMessage[],
  webUrl: string
): SlackMessage | null {
  const hits = messages.filter(m => m.text.includes(webUrl));
  if (!hits.length) return null;
  return hits.reduce((a, b) => (parseFloat(a.ts) <= parseFloat(b.ts) ? a : b));
}

// ── Slack Web API ────────────────────────────────────────────────────────────

async function call(
  method: string,
  token: string,
  params: Record<string, string>,
  post = false
): Promise<any> {
  const base = `https://slack.com/api/${method}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let res: Response;
  if (post) {
    headers['content-type'] = 'application/json; charset=utf-8';
    res = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  } else {
    res = await fetch(`${base}?${new URLSearchParams(params)}`, { headers });
  }
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    [k: string]: unknown;
  };
  if (!data.ok)
    throw new Error(`slack ${method}: ${data.error ?? 'unknown error'}`);
  return data;
}

/** team.slack.com host for permalinks, derived once from auth.test. */
async function teamDomain(token: string): Promise<string> {
  const data = await call('auth.test', token, {});
  return new URL(data.url as string).host;
}

async function resolveChannelId(
  token: string,
  channelName: string
): Promise<string> {
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await call('conversations.list', token, {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '1000',
      ...(cursor ? { cursor } : {}),
    });
    const found = (data.channels as Array<{ id: string; name: string }>).find(
      c => c.name === channelName
    );
    if (found) return found.id;
    cursor =
      (data.response_metadata as { next_cursor?: string })?.next_cursor ?? '';
    if (!cursor) break;
  }
  throw new Error(
    `slack channel #${channelName} not found (is the token's user a member?)`
  );
}

/** The kv key a channel's index lives under -- a channel NAME slug, never the
    channel id. Exported so tests and callers can predict/inspect the key. */
export function slackIndexPath(channelName: string): string {
  return channelName.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

/** Read a channel's own index. */
export function readIndex(
  channelName: string,
  db: Database = getStateDb()
): SlackIndex | null {
  return getKvValue<SlackIndex | null>(
    'slack-index',
    slackIndexPath(channelName),
    null,
    db
  );
}

export function writeIndex(
  channelName: string,
  index: SlackIndex,
  db: Database = getStateDb()
): void {
  persistOrWarn('slack index write', () =>
    setKvValue('slack-index', slackIndexPath(channelName), index, db)
  );
}

/**
 * Bring the local channel index up to date and return it. First run seeds from
 * the last INITIAL_LOOKBACK_DAYS; later runs fetch only messages after lastTs.
 * Message text/ts never change once posted, so the index only ever grows.
 */
export async function syncIndex(
  token: string,
  channelName: string,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<SlackIndex> {
  const existing = readIndex(channelName, db);
  const channelId =
    existing?.channelId ?? (await resolveChannelId(token, channelName));
  const domain = existing?.teamDomain ?? (await teamDomain(token));
  const oldest =
    existing?.lastTs && existing.lastTs !== '0'
      ? existing.lastTs
      : String(Math.floor(now / 1000 - INITIAL_LOOKBACK_DAYS * 86400));

  const fresh: SlackMessage[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await call('conversations.history', token, {
      channel: channelId,
      oldest,
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });
    for (const m of data.messages as Array<{
      ts: string;
      user?: string;
      text?: string;
    }>) {
      fresh.push({ ts: m.ts, user: m.user ?? '', text: m.text ?? '' });
    }
    if (!data.has_more) break;
    cursor =
      (data.response_metadata as { next_cursor?: string })?.next_cursor ?? '';
    if (!cursor) break;
  }

  const merged = [...(existing?.messages ?? []), ...fresh];
  const lastTs = merged.reduce(
    (max, m) => (parseFloat(m.ts) > parseFloat(max) ? m.ts : max),
    existing?.lastTs ?? '0'
  );
  const index: SlackIndex = {
    channelId,
    teamDomain: domain,
    lastTs,
    messages: merged,
  };
  writeIndex(channelName, index, db);
  return index;
}

/** Current reaction emoji names on a message. */
export async function messageReactions(
  token: string,
  channelId: string,
  ts: string
): Promise<string[]> {
  const data = await call('reactions.get', token, {
    channel: channelId,
    timestamp: ts,
  });
  const reactions = (
    (data.message as { reactions?: Array<{ name: string }> })?.reactions ?? []
  ).map(r => r.name);
  return reactions;
}

/** Add a reaction; treats an already-reacted response as success. */
export async function addReaction(
  token: string,
  channelId: string,
  ts: string,
  name: string
): Promise<void> {
  try {
    await call(
      'reactions.add',
      token,
      { channel: channelId, timestamp: ts, name },
      true
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('already_reacted')) return;
    throw err;
  }
}

/** Remove a reaction; treats a "no reaction" response as success (idempotent). */
export async function removeReaction(
  token: string,
  channelId: string,
  ts: string,
  name: string
): Promise<void> {
  try {
    await call(
      'reactions.remove',
      token,
      { channel: channelId, timestamp: ts, name },
      true
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('no_reaction')) return;
    throw err;
  }
}

/** Replies in a message's thread (excludes the parent). */
async function threadReplies(
  token: string,
  channelId: string,
  parentTs: string
): Promise<SlackMessage[]> {
  const data = await call('conversations.replies', token, {
    channel: channelId,
    ts: parentTs,
    limit: '200',
  });
  return (data.messages as Array<{ ts: string; user?: string; text?: string }>)
    .filter(m => m.ts !== parentTs)
    .map(m => ({ ts: m.ts, user: m.user ?? '', text: m.text ?? '' }));
}

/** Post a reply in a thread; returns the reply's ts. */
async function postThreadReply(
  token: string,
  channelId: string,
  parentTs: string,
  text: string
): Promise<string> {
  const data = await call(
    'chat.postMessage',
    token,
    { channel: channelId, thread_ts: parentTs, text },
    true
  );
  return data.ts as string;
}

/** Post a top-level message; returns the message's ts. */
async function postMessage(
  token: string,
  channelId: string,
  text: string
): Promise<string> {
  const data = await call(
    'chat.postMessage',
    token,
    { channel: channelId, text },
    true
  );
  return data.ts as string;
}

/**
 * Post `text` to `channelName` and record a slack ref against the given MR URLs
 * so subsequent reactions target it. When multiple MRs are passed, each gets a
 * ref pointing at the same parent message (multi mode); reactions on those refs
 * will lazily post a thread reply the first time they're clicked.
 */
export async function postToSlack(
  token: string,
  channelName: string,
  text: string,
  mrs: Array<{ webUrl: string; iid: number }>,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<SlackRef[]> {
  if (!mrs.length) throw new Error('nothing to post');
  const existing = readIndex(channelName, db);
  const channelId =
    existing?.channelId ?? (await resolveChannelId(token, channelName));
  const domain = existing?.teamDomain ?? (await teamDomain(token));
  const ts = await postMessage(token, channelId, text);
  const multi = mrs.length > 1;
  const refs: SlackRef[] = mrs.map(mr => {
    const base: SlackRef = {
      mrUrl: mr.webUrl,
      iid: mr.iid,
      status: 'found',
      channelId,
      teamDomain: domain,
      checkedAt: now,
    };
    if (multi) {
      return {
        ...base,
        multi: true,
        parentTs: ts,
        permalink: buildPermalink(domain, channelId, ts),
        reactions: [],
      };
    }
    return {
      ...base,
      messageTs: ts,
      permalink: buildPermalink(domain, channelId, ts),
      reactions: [],
    };
  });
  for (const ref of refs) writeSlackRef(ref, db);
  return refs;
}

// ── per-MR ref state ─────────────────────────────────────────────────────────

/** `critical` selects the retry-then-throw write path: a caller that has
    already posted a Slack reply (reactToMR) must not swallow a busy-database
    write, since losing this ref means the next reaction posts a duplicate
    reply. Every other caller only caches a lookup, so a swallowed busy write
    just re-resolves on the next read. */
export function writeSlackRef(
  ref: SlackRef,
  db: Database = getStateDb(),
  critical = false
): void {
  const write = () => {
    db.query(
      `INSERT INTO slack_refs (mr_url, ref, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(mr_url) DO UPDATE SET ref = excluded.ref, updated_at = excluded.updated_at`
    ).run(ref.mrUrl, JSON.stringify(ref), Date.now());
  };
  if (critical) runCriticalWrite('slack ref write', write);
  else persistOrWarn('slack ref write', write);
}

function readSlackRef(mrUrl: string, db: Database): SlackRef | null {
  const row = db
    .query('SELECT ref FROM slack_refs WHERE mr_url = ?')
    .get(mrUrl) as { ref: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.ref) as SlackRef;
  } catch {
    return null;
  }
}

/** All resolved Slack refs, keyed by mrUrl, for merging into /data.json. */
export function readSlackRefs(
  db: Database = getStateDb()
): Map<string, SlackRef> {
  const out = new Map<string, SlackRef>();
  const rows = db.query('SELECT mr_url, ref FROM slack_refs').all() as {
    mr_url: string;
    ref: string;
  }[];
  for (const row of rows) {
    try {
      out.set(row.mr_url, JSON.parse(row.ref) as SlackRef);
    } catch {
      // skip unreadable ref
    }
  }
  return out;
}

/** The client-facing slice of a ref attached to each MR in /data.json. */
export function attachSlack<T extends { webUrl?: string | null }>(
  mrs: T[],
  refs: Map<string, SlackRef>
): Array<
  T & {
    slack?: {
      status: SlackRef['status'];
      permalink?: string;
      reactions: string[];
      posted: boolean;
    };
  }
> {
  return mrs.map(mr => {
    const ref = mr.webUrl ? refs.get(mr.webUrl) : undefined;
    if (!ref) return mr;
    return {
      ...mr,
      slack: {
        status: ref.status,
        permalink: ref.permalink,
        reactions: ref.reactions ?? [],
        posted: ref.status === 'found' && !!ref.messageTs,
      },
    };
  });
}

/**
 * Resolve an MR to its review-request message: sync the index, match on the MR
 * URL, fetch the message's live reactions, and cache the ref. Returns the ref
 * (status "notfound" when no message references the MR yet).
 */
export async function resolveSlackRef(
  token: string,
  channelName: string,
  mrUrl: string,
  iid: number,
  now: number = Date.now(),
  presynced?: SlackIndex,
  db: Database = getStateDb()
): Promise<SlackRef> {
  const index = presynced ?? (await syncIndex(token, channelName, now, db));
  const msg = matchReviewMessage(index.messages, mrUrl);
  if (!msg) {
    const ref: SlackRef = { mrUrl, iid, status: 'notfound', checkedAt: now };
    writeSlackRef(ref, db);
    return ref;
  }
  const base = {
    mrUrl,
    iid,
    status: 'found' as const,
    channelId: index.channelId,
    teamDomain: index.teamDomain,
    checkedAt: now,
  };

  // Single MR in the message: react on the message itself.
  if (extractMrUrls(msg.text).length <= 1) {
    const ref: SlackRef = {
      ...base,
      messageTs: msg.ts,
      permalink: buildPermalink(index.teamDomain, index.channelId, msg.ts),
      reactions: await messageReactions(token, index.channelId, msg.ts),
    };
    writeSlackRef(ref, db);
    return ref;
  }

  // Multiple MRs: reactions belong on a per-MR reply. Reuse an existing reply
  // (ours or a manual one) that references this MR; otherwise defer creating it
  // to the first reaction so we don't post into threads we never mark.
  const reply = matchReviewMessage(
    await threadReplies(token, index.channelId, msg.ts),
    mrUrl
  );
  const ref: SlackRef = {
    ...base,
    multi: true,
    parentTs: msg.ts,
    messageTs: reply?.ts,
    permalink: reply
      ? buildThreadPermalink(
          index.teamDomain,
          index.channelId,
          reply.ts,
          msg.ts
        )
      : buildPermalink(index.teamDomain, index.channelId, msg.ts),
    reactions: reply
      ? await messageReactions(token, index.channelId, reply.ts)
      : [],
  };
  writeSlackRef(ref, db);
  return ref;
}

export interface SweepTarget {
  mrUrl: string;
  iid: number;
  channel: string;
}

/**
 * Which MRs a sweep should (re)resolve: anything without a ref, plus
 * `notfound` refs older than `retryAfter` (an MR posted just now isn't in the
 * index until the next sync). `force` retries every `notfound` ref regardless
 * of age. A `found` ref is never retried: a message doesn't stop containing
 * the URL.
 */
export function slackSweepTargets<T extends { webUrl?: string | null }>(
  mrs: T[],
  refs: Map<string, SlackRef>,
  opts: { retryAfter: number; force?: boolean }
): T[] {
  return mrs.filter(mr => {
    if (!mr.webUrl) return false;
    const ref = refs.get(mr.webUrl);
    if (!ref) return true;
    return (
      ref.status === 'notfound' &&
      (!!opts.force || ref.checkedAt < opts.retryAfter)
    );
  });
}

/**
 * Resolve every target, syncing each channel's index once and matching the
 * rest locally: the only per-target API traffic is the reactions fetch on a
 * hit, which is what `gapMs` spaces out. Per-target failures are collected,
 * not thrown, so one bad MR (or one unreachable channel) can't end the sweep.
 */
export async function sweepSlackRefs(
  token: string,
  targets: SweepTarget[],
  opts: { gapMs?: number; now?: number; db?: Database } = {}
): Promise<{ resolved: number; failed: number; errors: string[] }> {
  const gapMs = opts.gapMs ?? 250;
  const now = opts.now ?? Date.now();
  const db = opts.db ?? getStateDb();
  const indexes = new Map<string, Promise<SlackIndex>>();
  const indexFor = (channel: string): Promise<SlackIndex> => {
    let pending = indexes.get(channel);
    if (!pending) {
      pending = syncIndex(token, channel, now, db);
      indexes.set(channel, pending);
    }
    return pending;
  };
  const errors: string[] = [];
  let resolved = 0;
  for (const t of targets) {
    try {
      const ref = await resolveSlackRef(
        token,
        t.channel,
        t.mrUrl,
        t.iid,
        now,
        await indexFor(t.channel),
        db
      );
      resolved++;
      if (ref.status === 'found' && gapMs > 0)
        await new Promise(r => setTimeout(r, gapMs));
    } catch (err) {
      errors.push(
        `!${t.iid}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { resolved, failed: errors.length, errors };
}

/**
 * Add a reaction to an MR's review signal and refresh its reactions. For a
 * multi-MR request message with no reply yet, first post a threaded reply
 * pinned to this MR (matching the manual convention) and react there instead.
 */
export async function reactToMR(
  token: string,
  mrUrl: string,
  emoji: string,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<SlackRef> {
  const ref = readSlackRef(mrUrl, db);
  if (!ref || ref.status !== 'found' || !ref.channelId) {
    throw new Error('no resolved slack message for this MR');
  }
  const next = { ...ref };
  if (ref.multi && !ref.messageTs) {
    if (!ref.parentTs || !ref.teamDomain)
      throw new Error('multi-MR ref missing thread parent');
    const replyTs = await postThreadReply(
      token,
      ref.channelId,
      ref.parentTs,
      ref.mrUrl
    );
    next.messageTs = replyTs;
    next.permalink = buildThreadPermalink(
      ref.teamDomain,
      ref.channelId,
      replyTs,
      ref.parentTs
    );
  }
  if (!next.messageTs) throw new Error('no target message for reaction');
  await addReaction(token, ref.channelId, next.messageTs, emoji);
  next.reactions = await messageReactions(token, ref.channelId, next.messageTs);
  next.checkedAt = now;
  writeSlackRef(next, db, true);
  return next;
}

/** Remove a review-signal reaction from an MR's request message. No-op if the
    reaction wasn't there. Never creates a thread reply (unlike reactToMR): if
    a multi-MR ref hasn't been reified into its own reply yet, there's nothing
    to unreact from. */
export async function unreactFromMR(
  token: string,
  mrUrl: string,
  emoji: string,
  now: number = Date.now(),
  db: Database = getStateDb()
): Promise<SlackRef> {
  const ref = readSlackRef(mrUrl, db);
  if (!ref || ref.status !== 'found' || !ref.channelId || !ref.messageTs) {
    throw new Error('no resolved slack message for this MR');
  }
  await removeReaction(token, ref.channelId, ref.messageTs, emoji);
  const next = {
    ...ref,
    reactions: await messageReactions(token, ref.channelId, ref.messageTs),
    checkedAt: now,
  };
  writeSlackRef(next, db);
  return next;
}
