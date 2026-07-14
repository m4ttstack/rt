import { describe, expect, test } from "bun:test";
import { buildPermalink, matchReviewMessage, slackRefPath, attachSlack, type SlackMessage, type SlackRef } from "../slack.ts";

const URL_A = "https://gitlab.com/acme/acme-dev/-/merge_requests/4821";
const URL_B = "https://gitlab.com/acme/acme-dev/-/merge_requests/4822";

function msg(ts: string, text: string, user = "U1"): SlackMessage {
  return { ts, user, text };
}

describe("buildPermalink", () => {
  test("strips the dot from ts and builds the archive url", () => {
    expect(buildPermalink("acme-claims.slack.com", "C08GY807K61", "1784046127.318759")).toBe(
      "https://acme-claims.slack.com/archives/C08GY807K61/p1784046127318759",
    );
  });
});

describe("matchReviewMessage", () => {
  test("matches the message containing the MR url", () => {
    const m = matchReviewMessage([msg("2", `please review <${URL_A}|!4821>`), msg("3", "unrelated")], URL_A);
    expect(m?.ts).toBe("2");
  });

  test("prefers the earliest message when several reference the url", () => {
    const m = matchReviewMessage(
      [msg("30", `re: ${URL_A}`), msg("10", `review please ${URL_A}`), msg("20", `bump ${URL_A}`)],
      URL_A,
    );
    expect(m?.ts).toBe("10");
  });

  test("does not match a different MR's url", () => {
    expect(matchReviewMessage([msg("5", `review ${URL_B}`)], URL_A)).toBeNull();
  });

  test("returns null when nothing references the url", () => {
    expect(matchReviewMessage([msg("5", "good morning team")], URL_A)).toBeNull();
  });
});

describe("slackRefPath", () => {
  test("is deterministic and slugs the url", () => {
    expect(slackRefPath(URL_A, "/s")).toBe(slackRefPath(URL_A, "/s"));
    expect(slackRefPath(URL_A, "/s").startsWith("/s/")).toBe(true);
    expect(slackRefPath(URL_A, "/s").endsWith(".json")).toBe(true);
    expect(slackRefPath(URL_A, "/s")).not.toBe(slackRefPath(URL_B, "/s"));
  });
});

describe("attachSlack", () => {
  test("attaches the client slice by webUrl, leaves others untouched", () => {
    const refs = new Map<string, SlackRef>([
      [URL_A, { mrUrl: URL_A, iid: 4821, status: "found", permalink: "https://x/p1", reactions: ["eyes"], checkedAt: 0 }],
    ]);
    const [a, b] = attachSlack([{ webUrl: URL_A }, { webUrl: URL_B }], refs);
    expect(a.slack).toEqual({ status: "found", permalink: "https://x/p1", reactions: ["eyes"] });
    expect(b.slack).toBeUndefined();
  });

  test("defaults reactions to an empty array when the ref has none", () => {
    const refs = new Map<string, SlackRef>([[URL_A, { mrUrl: URL_A, iid: 4821, status: "notfound", checkedAt: 0 }]]);
    const [a] = attachSlack([{ webUrl: URL_A }], refs);
    expect(a.slack).toEqual({ status: "notfound", permalink: undefined, reactions: [] });
  });
});
