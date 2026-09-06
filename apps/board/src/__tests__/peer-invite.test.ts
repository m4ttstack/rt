import { describe, expect, test } from "bun:test";
import { carrySwitchboard, classifySetupAnswer, parseInvite, redeemInvite } from "../peer/invite.ts";

describe("parseInvite", () => {
  test("extracts url + code, tolerating whitespace", () => {
    const p = parseInvite("  https://sb.example.app/invite/aabbccddeeff00112233445566778899 \n");
    expect(p).toEqual({ ok: true, url: "https://sb.example.app", code: "aabbccddeeff00112233445566778899" });
  });
  test("lowercases the code and tolerates a trailing slash after it", () => {
    const upper = parseInvite("https://sb.example.app/invite/AABBCCDDEEFF00112233445566778899");
    expect(upper).toEqual({ ok: true, url: "https://sb.example.app", code: "aabbccddeeff00112233445566778899" });
    const slashed = parseInvite("https://sb.example.app/invite/aabbccddeeff00112233445566778899/");
    expect(slashed).toEqual({ ok: true, url: "https://sb.example.app", code: "aabbccddeeff00112233445566778899" });
  });
  test("rejects non-invite strings with a clear message", () => {
    for (const bad of ["", "not a url", "https://sb.example.app", "https://sb.example.app/invite/", "https://sb.example.app/invite/nothex!"]) {
      const p = parseInvite(bad);
      expect(p.ok).toBe(false);
    }
  });
});

describe("classifySetupAnswer", () => {
  test("blank skips, invite parses, bare url falls back to manual", () => {
    expect(classifySetupAnswer("")).toEqual({ kind: "skip" });
    expect(classifySetupAnswer("https://sb.example.app/invite/" + "a".repeat(32))).toEqual({
      kind: "invite", url: "https://sb.example.app", code: "a".repeat(32),
    });
    expect(classifySetupAnswer("https://sb.example.app/")).toEqual({ kind: "manual-url", url: "https://sb.example.app" });
  });
  test("garbage input is invalid, not silently skipped", () => {
    expect(classifySetupAnswer("garbage")).toEqual({ kind: "invalid", message: expect.any(String) });
  });
  test("a broken invite link is invalid, never a manual url", () => {
    // Falling through to manual-url would store the whole invite path as
    // switchboard.url, and every later relay call would target
    // .../invite/abc/<endpoint>.
    expect(classifySetupAnswer("https://sb.example.app/invite/abc")).toEqual({ kind: "invalid", message: expect.any(String) });
  });
});

describe("redeemInvite", () => {
  const fake = (status: number, body: string) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  test("maps 200 to ok with username + token", async () => {
    const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe("https://sb.example.app/invites/redeem");
      expect(JSON.parse(String(init?.body))).toEqual({ code: "c".repeat(32), username: "grace" });
      return Response.json({ username: "grace", token: "tok" });
    }) as unknown as typeof fetch;
    expect(await redeemInvite("https://sb.example.app", "c".repeat(32), "grace", f)).toEqual({ ok: true, username: "grace", token: "tok" });
  });

  test("maps 404/410/409/network to typed errors carrying the body text", async () => {
    expect(await redeemInvite("https://x", "c", "u", fake(404, "invite not recognized"))).toEqual({ ok: false, error: "unknown", message: "invite not recognized" });
    expect(await redeemInvite("https://x", "c", "u", fake(410, "expired"))).toEqual({ ok: false, error: "expired", message: "expired" });
    expect(await redeemInvite("https://x", "c", "u", fake(409, "different handle"))).toEqual({ ok: false, error: "mismatch", message: "different handle" });
    const dead = (async () => { throw new Error("nope"); }) as unknown as typeof fetch;
    const r = await redeemInvite("https://x", "c", "u", dead);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("network");
  });

  test("resolves (not rejects) to a typed network error on a 200 with unparseable JSON", async () => {
    const notJson = fake(200, "not json {");
    await expect(redeemInvite("https://x", "c", "u", notJson)).resolves.toEqual({
      ok: false, error: "network", message: "unexpected response from the switchboard",
    });
  });
});

describe("carrySwitchboard", () => {
  test("fresh join wins, existing survives a blank re-run, absent stays absent", () => {
    expect(carrySwitchboard({ url: "https://old" }, { url: "https://new" })).toEqual({ switchboard: { url: "https://new" } });
    expect(carrySwitchboard({ url: "https://old" }, null)).toEqual({ switchboard: { url: "https://old" } });
    expect(carrySwitchboard(undefined, null)).toEqual({});
  });
});
