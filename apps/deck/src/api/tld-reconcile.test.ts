import { test, expect } from "bun:test";
import { deriveTlds } from "./tld-reconcile.ts";

test("deriveTlds: localhost always present and first; route TLDs collected once", () => {
  expect(deriveTlds([])).toEqual(["localhost"]);
  expect(deriveTlds(["a.localhost", "b.localhost"])).toEqual(["localhost"]);
  expect(deriveTlds(["a.localhost", "deck.mattstack", "b.mattstack"])).toEqual(["localhost", "mattstack"]);
  expect(deriveTlds(["deck.mattstack"])).toEqual(["localhost", "mattstack"]);
});

test("deriveTlds ignores bare single-label hostnames", () => {
  expect(deriveTlds(["weird"])).toEqual(["localhost"]);
});
