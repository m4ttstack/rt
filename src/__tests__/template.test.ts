import { describe, test, expect } from "bun:test";
import {
  renderMr,
  renderMulti,
  renderPost,
  selectionHeader,
  sanitizeHeader,
  MAX_HEADER_LEN,
  type MrFacts,
  type SlackTemplates,
} from "../template.ts";

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

describe("renderPost", () => {
  const TPL: SlackTemplates = {
    single: "{title}: {url}",
    multiHeader: "{count} MR's ready for review :pray:",
    multiItem: "- {title}: {url}",
  };
  const G: MrFacts = { ...F, iid: 1, title: "another", url: "u2" };

  test("one MR and no header keeps the single-line row-menu rendering", () => {
    expect(renderPost(TPL, [F], null)).toBe("fix the thing: https://gitlab.com/x/-/merge_requests/4823");
  });

  test("one MR WITH a header renders multi, so the typed header isn't dropped", () => {
    expect(renderPost(TPL, [F], "just this one please")).toBe(
      "just this one please\n- fix the thing: https://gitlab.com/x/-/merge_requests/4823",
    );
  });

  test("many MRs with no header use the configured header", () => {
    expect(renderPost(TPL, [F, G], null)).toBe(
      "2 MR's ready for review :pray:\n- fix the thing: https://gitlab.com/x/-/merge_requests/4823\n- another: u2",
    );
  });

  test("many MRs with a header use it in place of the configured one", () => {
    expect(renderPost(TPL, [F, G], "mine")).toBe(
      "mine\n- fix the thing: https://gitlab.com/x/-/merge_requests/4823\n- another: u2",
    );
  });

  test("{count} in the rendered header counts the MRs actually posted", () => {
    // The bug this guards: the board posts the selection minus MRs already in
    // slack, so the number has to come from the facts that reach the server.
    expect(renderPost(TPL, [F, G], null).split("\n")[0]).toBe("2 MR's ready for review :pray:");
    expect(renderPost(TPL, [F], "{count} of them").split("\n")[0]).toBe("1 of them");
  });
});

describe("selectionHeader", () => {
  const CONFIGURED = "{count} MR's ready for review :pray:";

  test("untouched: shows the selection count but sends no override", () => {
    const h = selectionHeader(CONFIGURED, null, 3);
    expect(h.display).toBe("3 MR's ready for review :pray:");
    expect(h.copy).toBe(CONFIGURED);
    expect(h.post).toBeUndefined();
  });

  test("untouched copy still renders the selection's own count", () => {
    const h = selectionHeader(CONFIGURED, null, 3);
    expect(renderMulti(h.copy, "- {url}", [F, F, F]).split("\n")[0]).toBe("3 MR's ready for review :pray:");
  });

  test("untouched post lets the server count the postable subset, not the selection", () => {
    // display says 3; the server renders its configured header against the 2
    // MRs it actually posts, so the channel sees 2.
    const h = selectionHeader(CONFIGURED, null, 3);
    expect(h.display).toBe("3 MR's ready for review :pray:");
    const posted = renderPost({ single: "{url}", multiHeader: CONFIGURED, multiItem: "- {url}" }, [F, F], h.post ?? null);
    expect(posted.split("\n")[0]).toBe("2 MR's ready for review :pray:");
  });

  test("typed: goes to both paths verbatim, trimmed, with no number rewriting", () => {
    const h = selectionHeader(CONFIGURED, "  3 of these are mine  ", 2);
    expect(h.display).toBe("  3 of these are mine  ");
    expect(h.copy).toBe("3 of these are mine");
    expect(h.post).toBe("3 of these are mine");
  });

  test("display echoes keystrokes verbatim so a trailing space survives typing", () => {
    expect(selectionHeader(CONFIGURED, "hey ", 1).display).toBe("hey ");
  });

  test("cleared to empty: both paths fall back to the configured header", () => {
    const h = selectionHeader(CONFIGURED, "", 3);
    expect(h.display).toBe("");
    expect(h.copy).toBe(CONFIGURED);
    expect(h.post).toBeUndefined();
  });

  test("whitespace-only is the same as cleared, so post can't 400 on it", () => {
    const h = selectionHeader(CONFIGURED, "   ", 3);
    expect(h.display).toBe("   ");
    expect(h.copy).toBe(CONFIGURED);
    expect(h.post).toBeUndefined();
  });

  test("a cleared header copies without a blank first line", () => {
    const h = selectionHeader(CONFIGURED, "  ", 2);
    expect(renderMulti(h.copy, "- {url}", [F, F]).split("\n")[0]).toBe("2 MR's ready for review :pray:");
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

  test("neutralises a Slack link so it can't form a clickable anchor", () => {
    expect(sanitizeHeader("<https://evil.example|3 MRs ready for review>"))
      .toBe("&lt;https://evil.example|3 MRs ready for review&gt;");
  });

  test("neutralises a channel broadcast", () => {
    expect(sanitizeHeader("<!channel> check these out")).toBe("&lt;!channel&gt; check these out");
  });

  test("neutralises a user mention", () => {
    expect(sanitizeHeader("hey <@U123>")).toBe("hey &lt;@U123&gt;");
  });

  test("escapes a bare ampersand exactly once", () => {
    expect(sanitizeHeader("A & B")).toBe("A &amp; B");
  });

  test("leaves ordinary text with no special characters unchanged", () => {
    expect(sanitizeHeader("3 MRs ready for review")).toBe("3 MRs ready for review");
  });

  test("caps length after escaping, not before, so escaping can't smuggle a longer line", () => {
    // 300 '<' characters would be 300 raw chars but 1500 once escaped to &lt;.
    expect(sanitizeHeader("<".repeat(300))).toBeNull();
    // A string that's short enough pre-escape and still within the cap post-escape passes.
    const short = "<".repeat(20);
    expect(sanitizeHeader(short)).toBe("&lt;".repeat(20));
  });
});
