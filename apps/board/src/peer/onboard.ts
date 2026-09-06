import { canonicalUsername } from "./envelope.ts";
import { parseInvite, redeemInvite } from "./invite.ts";

/** Onboarding logic for the board's local-only peer endpoints. Pure over
    injected effects so the whole flow is testable without a server; src/server.ts
    only wires request parsing, the isLocal gate, and the real effects. */
export interface InviteCtx { url: string; adminToken: string; fetchFn?: typeof fetch }

export async function createInvite(username: string, ctx: InviteCtx): Promise<{ status: number; body: string }> {
  const fetchFn = ctx.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`${ctx.url}/invites`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ username }),
    });
  } catch {
    return { status: 502, body: "could not reach the switchboard" };
  }
  if (res.status !== 201) return { status: res.status, body: await res.text() };
  // A 201 body is not a promise of a code. Unguarded, a malformed one rejects
  // out of the handler and a missing code composes ".../invite/undefined",
  // which reads like a real invite right up until someone pastes it.
  let code: unknown;
  try {
    code = ((await res.json()) as { code?: unknown })?.code;
  } catch {
    // fall through: same "unexpected response" answer as a missing code
  }
  if (typeof code !== "string" || !code) return { status: 502, body: "unexpected response from the switchboard" };
  return { status: 200, body: JSON.stringify({ invite: `${ctx.url}/invite/${code}` }) };
}

export async function listPeerBoards(ctx: InviteCtx): Promise<{ status: number; body: string }> {
  const fetchFn = ctx.fetchFn ?? fetch;
  try {
    const res = await fetchFn(`${ctx.url}/boards`, { headers: { authorization: `Bearer ${ctx.adminToken}` } });
    return { status: res.ok ? 200 : res.status, body: await res.text() };
  } catch {
    return { status: 502, body: "could not reach the switchboard" };
  }
}

export interface JoinCtx {
  defaultMember: string;
  persist(url: string, token: string): void;
  startPeering(url: string, token: string): void;
  fetchFn?: typeof fetch;
}

export async function joinSwitchboard(invite: string, ctx: JoinCtx): Promise<{ status: number; body: string }> {
  if (!ctx.defaultMember || ctx.defaultMember === "all") {
    return { status: 400, body: 'joining needs your own username: set "defaultMember" in config.json first' };
  }
  const parsed = parseInvite(invite);
  if (!parsed.ok) return { status: 400, body: parsed.message };
  const r = await redeemInvite(parsed.url, parsed.code, canonicalUsername(ctx.defaultMember), ctx.fetchFn);
  if (!r.ok) {
    const status = r.error === "mismatch" ? 409 : r.error === "network" ? 502 : r.error === "expired" ? 410 : 404;
    return { status, body: r.message };
  }
  try {
    ctx.persist(parsed.url, r.token);
  } catch (err) {
    return {
      status: 500,
      body: `joining failed after the invite was used (${err instanceof Error ? err.message : err}); ask for a re-invite and try again`,
    };
  }
  ctx.startPeering(parsed.url, r.token);
  return { status: 200, body: JSON.stringify({ ok: true, username: r.username }) };
}
