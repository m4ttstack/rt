/** One shared redemption code path for both onboarding entry points (setup and
    the board UI join), so the relay-side identity guard covers both. */
const INVITE_RE = /^(https?:\/\/[^\s\/]+(?:\/[^\s\/]+)*?)\/invite\/([0-9a-f]{32})\/?$/i;

export function parseInvite(s: string): { ok: true; url: string; code: string } | { ok: false; message: string } {
  const m = s.trim().match(INVITE_RE);
  if (!m) return { ok: false, message: "that doesn't look like a board invite (expected .../invite/<code>)" };
  return { ok: true, url: m[1]!.replace(/\/+$/, ""), code: m[2]!.toLowerCase() };
}

/** Setup's prompt accepts four shapes: blank (keep current settings), a full
    invite link, a bare URL (the manual escape hatch: prompt for the values),
    or anything else, which is a typo worth re-prompting on rather than
    silently treating as "skip". */
export function classifySetupAnswer(s: string):
  | { kind: "skip" }
  | { kind: "invite"; url: string; code: string }
  | { kind: "manual-url"; url: string }
  | { kind: "invalid"; message: string } {
  const trimmed = s.trim();
  if (!trimmed) return { kind: "skip" };
  const inv = parseInvite(trimmed);
  if (inv.ok) return { kind: "invite", url: inv.url, code: inv.code };
  if (/^https?:\/\//i.test(trimmed)) return { kind: "manual-url", url: trimmed.replace(/\/+$/, "") };
  return { kind: "invalid", message: inv.message };
}

export async function redeemInvite(
  url: string,
  code: string,
  username: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; username: string; token: string } | { ok: false; error: "network" | "unknown" | "expired" | "mismatch"; message: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${url.replace(/\/+$/, "")}/invites/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, username }),
    });
  } catch {
    return { ok: false, error: "network", message: "could not reach the switchboard; check the address and try again" };
  }
  if (res.ok) {
    const body = (await res.json()) as { username?: unknown; token?: unknown };
    if (typeof body.username === "string" && typeof body.token === "string") return { ok: true, username: body.username, token: body.token };
    return { ok: false, error: "network", message: "unexpected response from the switchboard" };
  }
  const message = await res.text();
  if (res.status === 404) return { ok: false, error: "unknown", message };
  if (res.status === 410) return { ok: false, error: "expired", message };
  if (res.status === 409) return { ok: false, error: "mismatch", message };
  return { ok: false, error: "network", message: message || `switchboard answered ${res.status}` };
}
