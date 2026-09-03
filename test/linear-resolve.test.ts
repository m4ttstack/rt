import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLinearTickets } from "../server/linear/fetch.js";
import { isValidLinearId, putLinearIds } from "../server/cache/mr-store.js";
import { mr } from "./fixtures.js";
import type { LeaderboardWarning } from "../shared/types.js";

// The mock instance is hoisted alongside vi.mock so the factory closes over the
// same fn the test drives; vi.mocked() on the import does not survive Bun.
const { mocked } = vi.hoisted(() => ({ mocked: vi.fn() }));

vi.mock("../server/linear/client.js", () => ({ linearRequest: mocked }));

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

/** Resolve every identifier in the query successfully. */
const respondOk = (query: string) =>
  Promise.resolve(Object.fromEntries(idsInQuery(query).map((id, i) => [`_${i}`, rawFor(id)])));

const sourceMr = (iid: number, ticket: string) =>
  mr({ iid, authorUsername: "alice", title: `${ticket}: do the thing`, state: "merged" });

beforeEach(() => {
  mocked.mockReset();
});

describe("resolveLinearTickets resilience", () => {
  // The 81 -> 74 regression: a rate-limited batch query for KNOWN-VALID identifiers was
  // silently swallowed, dropping ~100 tickets from the envelope with no warning. A failed
  // batch must fall back to individual lookups, exactly like the unknown-identifier path.
  it("falls back to individual lookups when a known-valid batch chunk fails", async () => {
    putLinearIds([{ id: "ACME-9001", valid: true }, { id: "ACME-9002", valid: true }]);
    let batchCalls = 0;
    mocked.mockImplementation((_key, query) => {
      if (idsInQuery(query).length > 1) {
        batchCalls++;
        return Promise.reject(new Error("429 rate limited"));
      }
      return respondOk(query);
    });

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets(
      "key",
      [sourceMr(1, "ACME-9001"), sourceMr(2, "ACME-9002")],
      warnings,
    );

    expect(batchCalls).toBe(1);
    expect(issues.map((i) => i.identifier).sort()).toEqual(["ACME-9001", "ACME-9002"]);
  });

  it("warns when identifiers are lost even after the individual fallback", async () => {
    putLinearIds([{ id: "ACME-9010", valid: true }]);
    mocked.mockRejectedValue(new Error("429 rate limited"));

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets("key", [sourceMr(1, "ACME-9010")], warnings);

    expect(issues).toEqual([]);
    expect(warnings.some((w) => w.code === "linear_partial")).toBe(true);
  });

  // A transient error is NOT proof a ticket doesn't exist. Recording valid:false poisons
  // the permanent cache, so the ticket is skipped on every future refresh.
  it("does not mark an unknown identifier invalid when its lookup errors", async () => {
    mocked.mockRejectedValue(new Error("429 rate limited"));

    const warnings: LeaderboardWarning[] = [];
    await resolveLinearTickets("key", [sourceMr(1, "ACME-9020")], warnings);

    expect(isValidLinearId("ACME-9020")).toBeNull();
  });

  // Linear throws "Entity not found" for a nonexistent id rather than returning null,
  // so a junk identifier scraped from MR text (e.g. PARTY-3) errors on every lookup.
  // That IS a definitive answer: cache it as invalid, and don't warn about it forever.
  it("caches an identifier as invalid on an entity-not-found error, without warning", async () => {
    mocked.mockRejectedValue(new Error("Linear errors: Entity not found: Issue"));

    const warnings: LeaderboardWarning[] = [];
    const issues = await resolveLinearTickets("key", [sourceMr(1, "ACME-9040")], warnings);

    expect(issues).toEqual([]);
    expect(isValidLinearId("ACME-9040")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("still records definitive answers from a successful verify", async () => {
    mocked.mockImplementation((_key, query) => {
      const ids = idsInQuery(query);
      return Promise.resolve(
        Object.fromEntries(ids.map((id, i) => [`_${i}`, id === "ACME-9030" ? rawFor(id) : null])),
      );
    });

    const warnings: LeaderboardWarning[] = [];
    await resolveLinearTickets("key", [sourceMr(1, "ACME-9030"), sourceMr(2, "ACME-9031")], warnings);

    expect(isValidLinearId("ACME-9030")).toBe(true);
    expect(isValidLinearId("ACME-9031")).toBe(false);
  });
});
