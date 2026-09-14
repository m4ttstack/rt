import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { INTEGRATIONS } from "../integrations.ts";
import type { ValidateCtx } from "../integrations.ts";

const baseCtx: ValidateCtx = {
  host: null,
  team: { slug: "test", remote: null },
};

describe("github expiry probe", () => {
  const def = INTEGRATIONS.github;

  test("reads expiry from response header", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => ({
        status: 200,
        body: JSON.stringify({ login: "test" }),
        headers: {
          "github-authentication-token-expiration": "2026-12-01 00:00:00 UTC",
        },
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toEqual({ expiresAt: "2026-12-01" });
  });

  test("absent header means no expiry", async () => {
    const p = fakeProbes({
      fetch: async () => ({
        status: 200,
        body: JSON.stringify({ login: "test" }),
        headers: {},
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toEqual({ expiresAt: null });
  });

  test("non-200 returns null (cannot determine)", async () => {
    const p = fakeProbes({
      fetch: async () => ({
        status: 401,
        body: "Unauthorized",
        headers: {},
      }),
    });
    const result = await def.expiry!(p, "ghp_test", baseCtx);
    expect(result).toBeNull();
  });
});

describe("gitlab expiry probe", () => {
  const def = INTEGRATIONS.gitlab;

  test("reads expires_at from /personal_access_tokens/self", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return {
            status: 200,
            body: JSON.stringify({ expires_at: "2026-12-01", active: true }),
            headers: {},
          };
        }
        return { status: 200, body: "{}", headers: {} };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toEqual({ expiresAt: "2026-12-01" });
  });

  test("null expires_at means no expiry", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return {
            status: 200,
            body: JSON.stringify({ expires_at: null, active: true }),
            headers: {},
          };
        }
        return { status: 200, body: "{}", headers: {} };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toEqual({ expiresAt: null });
  });

  test("403 returns null (insufficient scope, not invalid)", async () => {
    const p = fakeProbes({
      fetch: async (url: string) => {
        if (url.includes("personal_access_tokens/self")) {
          return { status: 403, body: "Forbidden", headers: {} };
        }
        return { status: 200, body: "{}", headers: {} };
      },
    });
    const result = await def.expiry!(p, "glpat-test", { ...baseCtx, host: "gitlab.com" });
    expect(result).toBeNull();
  });
});
