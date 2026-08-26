import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildPermalink,
  buildThreadPermalink,
  extractMrUrls,
  matchReviewMessage,
  slackRefPath,
  slackIndexPath,
  legacyIndexPath,
  readIndex,
  writeIndex,
  adoptLegacyIndex,
  attachSlack,
  type SlackMessage,
  type SlackRef,
  type SlackIndex,
} from "../slack.ts";

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";
const URL_B = "https://gitlab.com/acme/webapp/-/merge_requests/4822";

function msg(ts: string, text: string, user = "U1"): SlackMessage {
  return { ts, user, text };
}

describe("buildPermalink", () => {
  test("strips the dot from ts and builds the archive url", () => {
    expect(buildPermalink("myteam.slack.com", "C08GY807K61", "1784046127.318759")).toBe(
      "https://myteam.slack.com/archives/C08GY807K61/p1784046127318759",
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

describe("buildThreadPermalink", () => {
  test("includes thread_ts and cid for an in-thread reply", () => {
    expect(buildThreadPermalink("myteam.slack.com", "C08GY807K61", "1784058445.555169", "1783888278.629199")).toBe(
      "https://myteam.slack.com/archives/C08GY807K61/p1784058445555169?thread_ts=1783888278.629199&cid=C08GY807K61",
    );
  });
});

describe("extractMrUrls", () => {
  test("returns the distinct MR urls in a message", () => {
    const text = `please review <${URL_A}|!4821> and <${URL_B}|!4822>`;
    expect(extractMrUrls(text).sort()).toEqual([URL_A, URL_B].sort());
  });
  test("collapses a repeated url to one (single-MR message)", () => {
    expect(extractMrUrls(`${URL_A} ... ${URL_A}`)).toEqual([URL_A]);
  });
  test("returns empty for a message with no MR link", () => {
    expect(extractMrUrls("just chatting")).toEqual([]);
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

describe("slackIndexPath", () => {
  test("is stable per channel and distinct across channels", () => {
    expect(slackIndexPath("code-review")).not.toBe(slackIndexPath("team-codeowners"));
    expect(slackIndexPath("code-review")).toBe(slackIndexPath("code-review"));
  });

  test("slugs unsafe characters and lives under the given dir", () => {
    expect(slackIndexPath("pod/weird name!", "/s")).toBe("/s/slack-index-pod-weird-name-.json");
  });
});

describe("readIndex / writeIndex per-channel", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "slack-idx-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("readIndex never touches the legacy file -- adoption is a separate, id-verified step", () => {
    const legacy: SlackIndex = { channelId: "C1", teamDomain: "acme.slack.com", lastTs: "100.0", messages: [] };
    writeFileSync(legacyIndexPath(dir), JSON.stringify(legacy));
    expect(readIndex("code-review", dir)).toBeNull();
    expect(existsSync(legacyIndexPath(dir))).toBe(true); // untouched
  });

  test("with no legacy file, a fresh install just starts with null per channel", () => {
    expect(readIndex("code-review", dir)).toBeNull();
    expect(readIndex("team-codeowners", dir)).toBeNull();
  });

  test("writeIndex writes to the channel-specific path, independent of other channels", () => {
    const idx: SlackIndex = { channelId: "C2", teamDomain: "acme.slack.com", lastTs: "200.0", messages: [] };
    writeIndex("team-codeowners", idx, dir);
    expect(readIndex("team-codeowners", dir)).toEqual(idx);
    expect(readIndex("code-review", dir)).toBeNull();
  });
});

describe("adoptLegacyIndex", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "slack-idx-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // The legacy index's channelId is the real Slack id of whichever channel a
  // pre-tabs install was actually using -- here, "code-review"'s.
  const legacy: SlackIndex = { channelId: "C1", teamDomain: "acme.slack.com", lastTs: "100.0", messages: [] };

  test("adopts when the resolved channel id matches (the default channel winning the race)", () => {
    writeFileSync(legacyIndexPath(dir), JSON.stringify(legacy));
    const adopted = adoptLegacyIndex("code-review", "C1", dir);
    expect(adopted).toEqual(legacy);
    expect(existsSync(legacyIndexPath(dir))).toBe(false); // consumed
    expect(readIndex("code-review", dir)).toEqual(legacy);
  });

  test("refuses when the resolved channel id does not match (a codeowners tab winning the race), leaving the legacy file for its real owner", () => {
    writeFileSync(legacyIndexPath(dir), JSON.stringify(legacy));
    // team-codeowners's own resolved id ("C2") is not code-review's ("C1").
    const adopted = adoptLegacyIndex("team-codeowners", "C2", dir);
    expect(adopted).toBeNull();
    expect(readIndex("team-codeowners", dir)).toBeNull(); // no fresh file written by adoptLegacyIndex itself
    expect(existsSync(legacyIndexPath(dir))).toBe(true); // legacy file untouched, still there for code-review
    expect(readIndex("code-review", dir)).toBeNull(); // not adopted for code-review either -- still pending

    // The default channel can still adopt it afterward.
    const laterAdopted = adoptLegacyIndex("code-review", "C1", dir);
    expect(laterAdopted).toEqual(legacy);
    expect(existsSync(legacyIndexPath(dir))).toBe(false);
    expect(readIndex("code-review", dir)).toEqual(legacy);
  });

  test("returns null with no legacy file to adopt", () => {
    expect(adoptLegacyIndex("code-review", "C1", dir)).toBeNull();
  });

  test("returns null (does not overwrite) when the channel already has its own index", () => {
    const own: SlackIndex = { channelId: "C1", teamDomain: "acme.slack.com", lastTs: "50.0", messages: [] };
    writeIndex("code-review", own, dir);
    writeFileSync(legacyIndexPath(dir), JSON.stringify(legacy));
    expect(adoptLegacyIndex("code-review", "C1", dir)).toBeNull();
    expect(readIndex("code-review", dir)).toEqual(own); // untouched
    expect(existsSync(legacyIndexPath(dir))).toBe(true); // legacy left alone too
  });
});

describe("attachSlack", () => {
  test("attaches the client slice by webUrl, leaves others untouched", () => {
    const refs = new Map<string, SlackRef>([
      [URL_A, { mrUrl: URL_A, iid: 4821, status: "found", messageTs: "1.2", permalink: "https://x/p1", reactions: ["eyes"], checkedAt: 0 }],
    ]);
    const [a, b] = attachSlack([{ webUrl: URL_A }, { webUrl: URL_B }], refs);
    expect(a!.slack).toEqual({ status: "found", permalink: "https://x/p1", reactions: ["eyes"], posted: true });
    expect(b!.slack).toBeUndefined();
  });

  test("defaults reactions to an empty array when the ref has none", () => {
    const refs = new Map<string, SlackRef>([[URL_A, { mrUrl: URL_A, iid: 4821, status: "notfound", checkedAt: 0 }]]);
    const [a] = attachSlack([{ webUrl: URL_A }], refs);
    expect(a!.slack).toEqual({ status: "notfound", permalink: undefined, reactions: [], posted: false });
  });

  test("posted=false when a multi-MR ref has no reply reified yet", () => {
    const refs = new Map<string, SlackRef>([
      [URL_A, { mrUrl: URL_A, iid: 4821, status: "found", multi: true, parentTs: "1.0", checkedAt: 0 }],
    ]);
    const [a] = attachSlack([{ webUrl: URL_A }], refs);
    expect(a!.slack?.posted).toBe(false);
  });
});
