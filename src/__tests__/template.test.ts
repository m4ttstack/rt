import { describe, test, expect } from "bun:test";
import { renderMr, renderMulti, type MrFacts } from "../template.ts";

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
