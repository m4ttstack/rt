import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLinearTickets } from "../server/linear/fetch.js";
import { getStore, __resetStore } from "../server/store/index.js";
import { mr } from "./fixtures.js";
import type { LeaderboardWarning } from "../shared/types.js";

const dir = mkdtempSync(join(tmpdir(), "boxscore-linear-resolve-"));
process.env.BOXSCORE_DB = join(dir, "test.sqlite");

beforeEach(() => getStore().clear());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

/** Pull the identifiers out of a buildVerifyQuery query string, alias-ordered. */
const idsInQuery = (query: string): string[] =>
  [...query.matchAll(/issue\(id: "([^"]+)"\)/g)].map((m) => m[1]!);

const rawFor = (id: string) => ({
  id: `uuid-${id}`,
  identifier: id,
  title: `Ticket ${id}`,
  url: `https://linear.app/acme/issue/${id}`,
  state: { type: "completed", name: "Done" },
});

/**
 * Stub global fetch, the transport linearRequest (server/linear/client.ts) actually calls,
 * rather than mocking linearRequest itself -- vi.mock's module replacement does not survive
 * being loaded transitively through server/linear/fetch.ts under the Bun runtime, so the
 * real (unmocked) function would run and hit the network. Stubbing one level lower, at
 * fetch, exercises the real retry/error-classification path (already covered in isolation
 * by test/http-retry.test.ts) alongside resolveLinearTickets's own fallback logic.
 */
function stubLinear(respond: (ids: string[], query: string) => Response): void {
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    return respond(idsInQuery(query), query);
  });
}

/** A batch (>1 id) response that always 429s; retry-after:0 keeps the real retry loop fast. */
const alwaysRateLimited = () => new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });

const okData = (ids: string[], pick: (id: string) => unknown) =>
  Response.json({ data: Object.fromEntries(ids.map((id, i) => [`_${i}`, pick(id)])) });

const sourceMr = (iid: number, ticket: string) =>
  mr({ iid, authorUsername: "alice", title: `${ticket}: do the thing`, state: "merged" });

describe("resolveLinearTickets resilience", () => {
  // The 81 -> 74 regression: a rate-limited batch query for KNOWN-VALID identifiers was
  // silently swallowed, dropping ~100 tickets from the envelope with no warning. A failed
  // batch must fall back to individual lookups, exactly like the unknown-identifier path.
  it("falls back to individual lookups when a known-valid batch chunk fails", async () => {
    getStore().putLinearIds([{ id: "ACME-9001", valid: true }, { id: "ACME-9002", valid: true }]);
    stubLinear((ids) => (ids.length > 1 ? alwaysRateLimited() : okData(ids, rawFor)));

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets(
      "key",
      [sourceMr(1, "ACME-9001"), sourceMr(2, "ACME-9002")],
      warnings,
    );

    expect(issues.map((i) => i.identifier).sort()).toEqual(["ACME-9001", "ACME-9002"]);
  });

  it("warns when identifiers are lost even after the individual fallback", async () => {
    getStore().putLinearIds([{ id: "ACME-9010", valid: true }]);
    stubLinear(alwaysRateLimited);

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets("key", [sourceMr(1, "ACME-9010")], warnings);

    expect(issues).toEqual([]);
    expect(warnings.some((w) => w.code === "linear_partial")).toBe(true);
  });

  // A transient error is NOT proof a ticket doesn't exist. Recording valid:false poisons
  // the permanent cache, so the ticket is skipped on every future refresh.
  it("does not mark an unknown identifier invalid when its lookup errors", async () => {
    stubLinear(alwaysRateLimited);

    const warnings: LeaderboardWarning[] = [];
    await resolveLinearTickets("key", [sourceMr(1, "ACME-9020")], warnings);

    expect(getStore().isValidLinearId("ACME-9020")).toBeNull();
  });

  // Linear throws "Entity not found" for a nonexistent id rather than returning null,
  // so a junk identifier scraped from MR text (e.g. PARTY-3) errors on every lookup.
  // That IS a definitive answer: cache it as invalid, and don't warn about it forever.
  it("caches an identifier as invalid on an entity-not-found error, without warning", async () => {
    stubLinear(() => Response.json({ errors: [{ message: "Linear errors: Entity not found: Issue" }] }));

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets("key", [sourceMr(1, "ACME-9040")], warnings);

    expect(issues).toEqual([]);
    expect(getStore().isValidLinearId("ACME-9040")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("still records definitive answers from a successful verify", async () => {
    stubLinear((ids) => okData(ids, (id) => (id === "ACME-9030" ? rawFor(id) : null)));

    const warnings: LeaderboardWarning[] = [];
    await resolveLinearTickets("key", [sourceMr(1, "ACME-9030"), sourceMr(2, "ACME-9031")], warnings);

    expect(getStore().isValidLinearId("ACME-9030")).toBe(true);
    expect(getStore().isValidLinearId("ACME-9031")).toBe(false);
  });
});
