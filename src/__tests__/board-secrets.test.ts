import { describe, expect, test } from "bun:test";
import { readBoardSecrets, type BoardSecretsData } from "../board-secrets.ts";
import type { RtResponse } from "@mattstack/rt-client";

function deps(overrides: {
  readApiToken?: () => string;
  post?: (payload: { token: string; scope: "board" }) => Promise<RtResponse<BoardSecretsData>>;
} = {}) {
  return {
    readApiToken: overrides.readApiToken ?? (() => "tok-123"),
    post: overrides.post ?? (async () => ({ ok: true, data: {} })),
  };
}

describe("readBoardSecrets", () => {
  test("returns the six board-scope keys on success", async () => {
    const data: BoardSecretsData = {
      slackToken: "xoxp-1",
      slackClientSecret: "sc-1",
      slackSigningSecret: "ss-1",
      gitlabToken: "glpat-1",
      switchboardToken: "sb-1",
      switchboardAdminToken: "sba-1",
    };
    const res = await readBoardSecrets(deps({ post: async () => ({ ok: true, data }) }));
    expect(res).toEqual({ ok: true, ...data });
  });

  test("omits keys the daemon didn't return (not-configured stays quiet)", async () => {
    const res = await readBoardSecrets(deps({ post: async () => ({ ok: true, data: { gitlabToken: "g" } }) }));
    expect(res).toEqual({ ok: true, gitlabToken: "g" });
  });

  test("passes the api token and board scope in the request payload", async () => {
    let seen: { token: string; scope: "board" } | undefined;
    await readBoardSecrets(deps({
      readApiToken: () => "the-token",
      post: async (payload) => {
        seen = payload;
        return { ok: true, data: {} };
      },
    }));
    expect(seen).toEqual({ token: "the-token", scope: "board" });
  });

  test("a missing/unreadable api-token file points at rt daemon start, never throws", async () => {
    const res = await readBoardSecrets(deps({
      readApiToken: () => {
        throw new Error("ENOENT: no such file or directory, open '/fake/home/.mattstack/rt/api-token'");
      },
    }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("rt daemon start");
    expect((res as { message: string }).message).toContain("ENOENT");
  });

  test("a transport-level throw from post() collapses to the daemon-down message", async () => {
    const res = await readBoardSecrets(deps({
      post: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("rt daemon start");
    expect((res as { message: string }).message).toContain("ECONNREFUSED");
  });

  test("rtCommand's own unreachable envelope also reads as daemon-down", async () => {
    const res = await readBoardSecrets(deps({
      post: async () => ({ ok: false, error: "rt daemon unreachable at /fake/rt.sock: connect ENOENT" }),
    }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("rt daemon start");
  });

  test("bad-token / missing-token point at the api-token file, not daemon-down", async () => {
    const badToken = await readBoardSecrets(deps({ post: async () => ({ ok: false, error: "bad-token" }) }));
    expect((badToken as { message: string }).message).toContain("api-token");
    expect((badToken as { message: string }).message).not.toContain("daemon start");

    const missingToken = await readBoardSecrets(deps({ post: async () => ({ ok: false, error: "missing-token" }) }));
    expect((missingToken as { message: string }).message).toContain("api-token");
  });

  test("bad-scope (old daemon that knows the verb but not \"board\") points at updating rt", async () => {
    const res = await readBoardSecrets(deps({ post: async () => ({ ok: false, error: "bad-scope" }) }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("update rt");
  });

  test("unknown command (a daemon that predates secrets:read entirely) points at updating rt", async () => {
    const res = await readBoardSecrets(deps({ post: async () => ({ ok: false, error: "unknown command secrets:read" }) }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("update rt");
  });

  test("an unrecognized daemon-side error surfaces verbatim, not misdirected to the token file", async () => {
    const res = await readBoardSecrets(deps({ post: async () => ({ ok: false, error: "internal error boom" }) }));
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain("internal error boom");
    expect((res as { message: string }).message).not.toContain("api-token");
  });

  test("never echoes the token itself in any failure message", async () => {
    const results = await Promise.all([
      readBoardSecrets(deps({ readApiToken: () => { throw new Error("SECRET-abc123 missing"); } })),
      readBoardSecrets(deps({ post: async () => { throw new Error("SECRET-abc123 unreachable"); } })),
    ]);
    // The fs/transport error text itself may appear (path/cause only, per the
    // deck-ratified contract) -- what must never appear is the api token
    // value this module reads and sends, which none of these paths touch.
    for (const r of results) {
      expect((r as { message: string }).message).not.toContain("tok-123");
    }
  });
});
