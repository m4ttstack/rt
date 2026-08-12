import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { INVITE_TTL_MS, SwitchboardStore } from "../store.ts";

function store() {
  return new SwitchboardStore(new Database(":memory:"));
}

describe("createInvite", () => {
  test("returns a 32-hex code bound to the canonical username with a 7d expiry", () => {
    const s = store();
    const inv = s.createInvite("Grace ", 1000);
    expect(inv.code).toMatch(/^[0-9a-f]{32}$/);
    expect(inv.username).toBe("grace");
    expect(inv.expiresAt).toBe(1000 + INVITE_TTL_MS);
  });

  test("re-creating replaces the outstanding invite: the old code dies", () => {
    const s = store();
    const first = s.createInvite("grace", 1000);
    const second = s.createInvite("grace", 2000);
    expect(s.redeemInvite(first.code, "grace", 3000)).toEqual({ ok: false, error: "unknown" });
    const redeemed = s.redeemInvite(second.code, "grace", 3000);
    expect(redeemed.ok).toBe(true);
  });
});

describe("redeemInvite", () => {
  test("happy path registers the board and consumes the invite", () => {
    const s = store();
    const inv = s.createInvite("grace", 1000);
    const r = s.redeemInvite(inv.code, "grace", 2000);
    if (!r.ok) throw new Error("expected ok");
    expect(r.username).toBe("grace");
    expect(s.authBoard(r.token)).toBe("grace");
    expect(s.redeemInvite(inv.code, "grace", 3000)).toEqual({ ok: false, error: "spent" });
  });

  test("mismatch consumes nothing and rotates nothing", () => {
    const s = store();
    const existing = s.registerBoard("grace");
    const inv = s.createInvite("grace", 1000);
    const r = s.redeemInvite(inv.code, "bob", 2000);
    expect(r).toEqual({ ok: false, error: "mismatch" });
    // grace's live token still works: nothing was rotated
    expect(s.authBoard(existing.token)).toBe("grace");
    // and grace's own link still redeems
    expect(s.redeemInvite(inv.code, "GRACE", 3000).ok).toBe(true);
  });

  test("expired invite is refused and rotates nothing", () => {
    const s = store();
    const inv = s.createInvite("grace", 1000);
    expect(s.redeemInvite(inv.code, "grace", 1000 + INVITE_TTL_MS + 1)).toEqual({ ok: false, error: "expired" });
  });

  test("unknown code", () => {
    expect(store().redeemInvite("f".repeat(32), "grace", 1000)).toEqual({ ok: false, error: "unknown" });
  });

  test("redeem rotates an existing board's token (re-invite recovery)", () => {
    const s = store();
    const old = s.registerBoard("grace");
    const inv = s.createInvite("grace", 1000);
    const r = s.redeemInvite(inv.code, "grace", 2000);
    if (!r.ok) throw new Error("expected ok");
    expect(s.authBoard(old.token)).toBeNull();
    expect(s.authBoard(r.token)).toBe("grace");
  });
});

describe("listBoards / prune", () => {
  test("listBoards returns username + createdAt", () => {
    const s = store();
    s.registerBoard("grace");
    const rows = s.listBoards();
    expect(rows.length).toBe(1);
    expect(rows[0]!.username).toBe("grace");
    expect(typeof rows[0]!.createdAt).toBe("number");
  });

  test("prune removes expired invites but keeps live ones", () => {
    const s = store();
    const live = s.createInvite("grace", 1000);
    s.createInvite("bob", 1000);
    // bob's invite expires; advance past bob's expiry only by pruning at a
    // time where both are expired except we re-create grace's fresh first
    const fresh = s.createInvite("grace", 1000 + INVITE_TTL_MS);
    s.prune(1000 + INVITE_TTL_MS + 1);
    expect(s.redeemInvite(fresh.code, "grace", 1000 + INVITE_TTL_MS + 2).ok).toBe(true);
    expect(s.redeemInvite(live.code, "grace", 1000 + INVITE_TTL_MS + 2)).toEqual({ ok: false, error: "unknown" });
  });
});
