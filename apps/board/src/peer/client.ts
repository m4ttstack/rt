import {
  parseEnvelope,
  type DraftEnvelope,
  type Envelope,
} from './envelope.ts';

export interface SwitchboardClient {
  /** Resolves to the HTTP status, or "network" when the relay is unreachable. */
  publish(d: DraftEnvelope): Promise<number | 'network'>;
  /** Pending envelopes oldest-first, "unauthorized" when the relay rejected the
      token (401), or null for any other failed relay call. 401 is called out
      separately because it is the one failure a human can fix: the board's
      token was revoked or never valid, and the UI says so. */
  inbox(): Promise<Envelope[] | null | 'unauthorized'>;
  ack(ids: string[]): Promise<boolean>;
  /** Enrolled usernames, or null when the relay can't say (older relay
      without /peers, a bad body, or a network failure) -- callers treat
      null as "don't filter". */
  peers(): Promise<string[] | null>;
}

export function makeSwitchboardClient(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch
): SwitchboardClient {
  const base = url.replace(/\/+$/, '');
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  return {
    async publish(d) {
      try {
        const res = await fetchFn(`${base}/envelopes`, {
          method: 'POST',
          headers,
          body: JSON.stringify(d),
        });
        return res.status;
      } catch {
        return 'network';
      }
    },
    async inbox() {
      try {
        const res = await fetchFn(`${base}/inbox`, { headers });
        if (res.status === 401) return 'unauthorized';
        if (!res.ok) return null;
        const body = (await res.json()) as { envelopes?: unknown[] };
        if (!Array.isArray(body.envelopes)) return null;
        return body.envelopes
          .map(parseEnvelope)
          .filter((e): e is Envelope => e !== null);
      } catch {
        return null;
      }
    },
    async peers() {
      try {
        const res = await fetchFn(`${base}/peers`, { headers });
        if (!res.ok) return null;
        const body = (await res.json()) as { peers?: unknown };
        if (
          !Array.isArray(body.peers) ||
          body.peers.some(p => typeof p !== 'string')
        )
          return null;
        return body.peers as string[];
      } catch {
        return null;
      }
    },
    async ack(ids) {
      if (!ids.length) return true;
      try {
        const res = await fetchFn(`${base}/inbox/ack`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ids }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
