import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkInviteReplies, listInviteSlugs, type InviteReplyDeps } from "../invite-replies.ts";
import type { InviteRecords } from "../../team/invite-records.ts";
import type { NotifyEventInput } from "../../notifier.ts";

const NOW = Date.parse("2026-09-24T18:00:00Z");
const LATER = new Date(NOW + 5 * 24 * 3600 * 1000).toISOString();
const EARLIER = new Date(NOW - 3600 * 1000).toISOString();

function rec(id: string, expiresAt = LATER) {
  return { id, creatorSecret: `secret-${id}`, keyB64: "a2V5", expiresAt };
}

function fakeDeps(opts: {
  records?: Record<string, InviteRecords | Error>;
  replies?: Record<string, { blob: string } | "none" | Error>;
  /** Blobs that open to a usable age key; any other blob fails to open. */
  opens?: Record<string, string>;
  notified?: string[];
  enabled?: boolean;
} = {}) {
  const notified = new Set(opts.notified ?? []);
  const marks: { id: string; outcome: string }[] = [];
  const sent: NotifyEventInput[] = [];
  const warned: string[] = [];
  const reads: string[] = [];
  const opened: string[] = [];
  const deps: InviteReplyDeps = {
    slugs: () => Object.keys(opts.records ?? {}),
    records: (slug) => {
      const r = opts.records?.[slug] ?? {};
      if (r instanceof Error) throw r;
      return r;
    },
    readReply: async (id, creatorSecret) => {
      reads.push(`${id}:${creatorSecret}`);
      const r = opts.replies?.[id] ?? "none";
      if (r instanceof Error) throw r;
      return r;
    },
    openReply: async (blob, keyB64, id) => {
      opened.push(`${id}:${keyB64}`);
      const key = (opts.opens ?? { ciphertext: "age1validkey" })[blob];
      if (!key) throw new Error("reply did not decrypt under this invite's key");
      return key;
    },
    isNotified: (id) => notified.has(id),
    markNotified: (id, outcome) => { notified.add(id); marks.push({ id, outcome }); },
    notify: (event) => { sent.push(event); },
    enabled: () => opts.enabled ?? true,
    now: () => NOW,
    warn: (msg) => { warned.push(msg); },
  };
  return { deps, sent, warned, reads, opened, marks, notified };
}

describe("checkInviteReplies", () => {
  test("no reply yet: nothing is sent and nothing is marked", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } } });

    const result = await checkInviteReplies(f.deps);

    expect(result.notified).toEqual([]);
    expect(f.sent).toEqual([]);
    expect(f.notified.size).toBe(0);
    expect(f.reads).toEqual(["inv-1:secret-inv-1"]);
  });

  test("a posted reply sends one member_joined event naming the handle and team, and marks the invite", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": { blob: "ciphertext" } } });

    const result = await checkInviteReplies(f.deps);

    expect(result.notified).toEqual([{ slug: "acme", handle: "ed", id: "inv-1" }]);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({
      id: "member_joined:acme:inv-1",
      category: "member_joined",
      team: "acme",
      handle: "ed",
      title: "ed replied to your acme invite",
    });
    expect(f.sent[0]!.message).toContain("rt team members sync");
    expect(f.notified.has("inv-1")).toBe(true);
  });

  test("an invite already notified is neither read nor sent again", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": { blob: "x" } }, notified: ["inv-1"] });

    const result = await checkInviteReplies(f.deps);

    expect(result.notified).toEqual([]);
    expect(f.sent).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  test("an expired invite record is skipped without a relay read", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-old", EARLIER) } }, replies: { "inv-old": { blob: "x" } } });

    await checkInviteReplies(f.deps);

    expect(f.sent).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  test("a relay failure on one invite is warned and the others still run", async () => {
    const f = fakeDeps({
      records: { acme: { ed: rec("inv-1"), jo: rec("inv-2") } },
      replies: { "inv-1": new Error("relay-unreachable"), "inv-2": { blob: "ciphertext" } },
    });

    const result = await checkInviteReplies(f.deps);

    expect(result.notified).toEqual([{ slug: "acme", handle: "jo", id: "inv-2" }]);
    expect(f.warned).toHaveLength(1);
    expect(f.warned[0]).toContain("ed");
  });

  test("the member_joined preference off means no read and no send", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": { blob: "x" } }, enabled: false });

    await checkInviteReplies(f.deps);

    expect(f.sent).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  test("a reply is opened under the invite's key before anyone is told about it", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": { blob: "ciphertext" } } });

    await checkInviteReplies(f.deps);

    expect(f.opened).toEqual(["inv-1:a2V5"]);
    expect(f.sent).toHaveLength(1);
    expect(f.marks).toEqual([{ id: "inv-1", outcome: "notified" }]);
  });

  test("a blob that does not open is warned once, marked rejected, and never announced", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": { blob: "garbage" } }, opens: {} });

    const first = await checkInviteReplies(f.deps);
    const second = await checkInviteReplies(f.deps);

    expect(first.notified).toEqual([]);
    expect(second.notified).toEqual([]);
    expect(f.sent).toEqual([]);
    expect(f.warned).toHaveLength(1);
    expect(f.warned[0]).toContain("ed");
    expect(f.marks).toEqual([{ id: "inv-1", outcome: "rejected" }]);
    expect(f.reads).toHaveLength(1);
  });

  test("one team's unreadable invite file does not stop the other teams", async () => {
    const f = fakeDeps({
      records: { broken: new Error("invite records file is not a valid records map"), acme: { ed: rec("inv-1") } },
      replies: { "inv-1": { blob: "ciphertext" } },
    });

    const result = await checkInviteReplies(f.deps);

    expect(result.notified).toEqual([{ slug: "acme", handle: "ed", id: "inv-1" }]);
    expect(f.warned).toHaveLength(1);
    expect(f.warned[0]).toContain("broken");
  });

  test("an unparsable expiry counts as expired, matching the records reader", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1", "not a date") } }, replies: { "inv-1": { blob: "ciphertext" } } });

    await checkInviteReplies(f.deps);

    expect(f.sent).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  test("the warning for a relay read failure names the handle, never the invite id", async () => {
    const f = fakeDeps({ records: { acme: { ed: rec("inv-1") } }, replies: { "inv-1": new Error("relay-unreachable") } });

    await checkInviteReplies(f.deps);

    expect(f.warned[0]).toContain("ed");
    expect(f.warned[0]).not.toContain("inv-1");
  });
});

describe("listInviteSlugs", () => {
  test("names every <slug>.json under the invites dir, and nothing else", () => {
    const home = mkdtempSync(join(tmpdir(), "rt-invites-"));
    try {
      const dir = join(home, ".mattstack", "rt", "invites");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "acme.json"), "{}");
      writeFileSync(join(dir, "beta.json"), "{}");
      writeFileSync(join(dir, "notes.txt"), "");

      expect(listInviteSlugs(home).sort()).toEqual(["acme", "beta"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("no invites dir means no slugs", () => {
    const home = mkdtempSync(join(tmpdir(), "rt-invites-"));
    try {
      expect(listInviteSlugs(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
