import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock, servedAppCatalog } from "../../../lib/bundle-layout.ts";

// Parity anchor: byte-identical twin at
// apps/deck/src/registry/__fixtures__/deps-lock-serve.fixture.json (same
// repo, since the fold-in), read by deck's readBundleCatalog test. Change
// both files together and move this digest in both tests, or the two
// parsers drift apart silently.
const FIXTURE_SHA256 = "1d651d8275690b5465cf67ea6926287537020673d2c272834da74503db1f1828";

interface Fixture {
  lock: unknown;
  expectedCatalog: { name: string; port: number; args: string[] }[];
}

const bytes = readFileSync(join(import.meta.dir, "fixtures", "deps-lock-serve.fixture.json"));
const fixture = JSON.parse(bytes.toString("utf8")) as Fixture;

describe("deps-lock-serve parity fixture", () => {
  test("bytes match the digest its twin pins", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
  });

  test("servedAppCatalog yields the expected catalog in lock order", () => {
    const catalog = servedAppCatalog(parseDepsLock(JSON.stringify(fixture.lock)));
    expect([...catalog].map(([name, serve]) => ({ name, ...serve }))).toEqual(fixture.expectedCatalog);
  });
});
