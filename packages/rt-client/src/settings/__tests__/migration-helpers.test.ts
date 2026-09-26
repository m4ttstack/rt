/**
 * migrations/helpers.ts building blocks: a plain object's inherited
 * prototype names (constructor, toString, hasOwnProperty) must never read as
 * present just because JS's `in` operator sees the prototype chain.
 */

import { describe, expect, test } from "bun:test";
import { renameProperty, setDefault } from "../migrations/helpers.ts";

describe("migration helpers over prototype-shadowing names", () => {
  test("setDefault sets a property named after an Object.prototype member that is absent as an own property", () => {
    expect(setDefault({}, [], "constructor", 1)).toEqual({ constructor: 1 });
  });

  test("renameProperty is a no-op when the source name is only an inherited prototype member", () => {
    expect(renameProperty({}, [], "toString", "x")).toEqual({});
  });

  test("a path segment matching only an inherited prototype member does not walk into it", () => {
    expect(renameProperty({ a: 1 }, ["constructor"], "x", "y")).toEqual({ a: 1 });
  });
});
