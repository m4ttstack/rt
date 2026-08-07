import { describe, test, expect } from "bun:test";
import { renderMr, renderMulti, sanitizeHeader, MAX_HEADER_LEN, type MrFacts } from "../template.ts";

const F: MrFacts = {
  iid: 4823,
  title: "fix the thing",
  url: "https://gitlab.com/x/-/merge_requests/4823",
  ticket: "ACME-1234",
  author: "matt",
  sourceBranch: "feat/foo",
  targetBranch: "main",
};

describe("renderMr", () => {
  test("replaces every placeholder", () => {
    expect(renderMr("!{iid} [{ticket}] {title} by @{author} — {url}", F))
      .toBe("!4823 [ACME-1234] fix the thing by @matt — https://gitlab.com/x/-/merge_requests/4823");
  });

  test("leaves unknown placeholders literal so users see what they mistyped", () => {
    expect(renderMr("{title} {nope}", F)).toBe("fix the thing {nope}");
  });

  test("branches", () => {
    expect(renderMr("{sourceBranch} -> {targetBranch}", F)).toBe("feat/foo -> main");
  });
});

describe("renderMulti", () => {
  test("header gets {count}, items get each MR's placeholders", () => {
    const out = renderMulti("{count} MRs :pray:", "- {title}: {url}", [F, { ...F, iid: 1, title: "another", url: "u2" }]);
    expect(out).toBe(
      "2 MRs :pray:\n" +
      "- fix the thing: https://gitlab.com/x/-/merge_requests/4823\n" +
      "- another: u2",
    );
  });
});

describe("sanitizeHeader", () => {
  test("trims an ordinary line", () => {
    expect(sanitizeHeader("  3 MRs ready :pray:  ")).toBe("3 MRs ready :pray:");
  });

  test("collapses newline runs into a single space", () => {
    expect(sanitizeHeader("two\nlines")).toBe("two lines");
    expect(sanitizeHeader("crlf\r\nhere")).toBe("crlf here");
    expect(sanitizeHeader("many\n\n\nbreaks")).toBe("many breaks");
  });

  test("rejects anything that isn't a string", () => {
    for (const bad of [undefined, null, 3, {}, ["x"], true]) {
      expect(sanitizeHeader(bad)).toBeNull();
    }
  });

  test("rejects empty and whitespace-only", () => {
    expect(sanitizeHeader("")).toBeNull();
    expect(sanitizeHeader("   ")).toBeNull();
    expect(sanitizeHeader("\n\n")).toBeNull();
  });

  test("accepts exactly the cap and rejects one over", () => {
    expect(sanitizeHeader("a".repeat(MAX_HEADER_LEN))).toBe("a".repeat(MAX_HEADER_LEN));
    expect(sanitizeHeader("a".repeat(MAX_HEADER_LEN + 1))).toBeNull();
  });

  test("measures length after collapsing, not before", () => {
    // 299 chars plus three newlines is 302 raw but 299 once collapsed+trimmed.
    expect(sanitizeHeader("a".repeat(299) + "\n\n\n")).toBe("a".repeat(299));
  });
});
