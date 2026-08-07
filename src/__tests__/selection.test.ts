import { describe, test, expect } from "bun:test";
import { selectionOf, postableOf } from "../selection.ts";

const a = { webUrl: "https://gl/a", iid: 1 };
const b = { webUrl: "https://gl/b", iid: 2 };
const c = { webUrl: "https://gl/c", iid: 3 };

describe("selectionOf", () => {
  test("keeps only the selected MRs, in board order", () => {
    expect(selectionOf([a, b, c], new Set(["https://gl/c", "https://gl/a"]))).toEqual([a, c]);
  });

  test("a selected url no longer on the board simply drops out", () => {
    expect(selectionOf([a, b], new Set(["https://gl/a", "https://gl/gone"]))).toEqual([a]);
  });

  test("an empty selection selects nothing", () => {
    expect(selectionOf([a, b], new Set())).toEqual([]);
  });

  test("MRs without a webUrl never match", () => {
    const orphan = { webUrl: null, iid: 4 };
    expect(selectionOf([orphan, a], new Set(["https://gl/a"]))).toEqual([a]);
  });

  test("survives a filtered list -- selection is about urls, not positions", () => {
    // Board switched to a filter that only shows b and c; a stays selected and
    // reappears when the filter widens again.
    const sel = new Set(["https://gl/a", "https://gl/c"]);
    expect(selectionOf([b, c], sel)).toEqual([c]);
    expect(selectionOf([a, b, c], sel)).toEqual([a, c]);
  });
});

describe("postableOf", () => {
  test("drops MRs already posted to slack", () => {
    const posted = { webUrl: "https://gl/p", iid: 5, slack: { posted: true } };
    const unposted = { webUrl: "https://gl/u", iid: 6, slack: { posted: false } };
    expect(postableOf([posted, unposted])).toEqual([unposted]);
  });

  test("keeps MRs with no slack info at all", () => {
    expect(postableOf([a, b])).toEqual([a, b]);
  });

  test("drops MRs without a webUrl", () => {
    const orphan = { webUrl: null, iid: 7 };
    expect(postableOf([orphan, a])).toEqual([a]);
  });
});
