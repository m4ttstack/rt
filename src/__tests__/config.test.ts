import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, saveSwitchboardUrl, setHiddenInRaw } from "../config.ts";

const base = {
  gitlabHost: "https://gitlab.com",
  projects: ["org/repo"],
  members: [{ username: "alice", name: "Alice Ng" }, { username: "bob" }],
};

describe("parseConfig", () => {
  test("parses members and applies defaults", () => {
    const cfg = parseConfig(JSON.stringify(base));
    expect(cfg.members).toEqual([{ username: "alice", name: "Alice Ng" }, { username: "bob" }]);
    expect(cfg.title).toBe("MRs ready for review");
    expect(cfg.port).toBe(7930);
    expect(cfg.staleAfterDays).toBe(90);
    expect(cfg.ticketPrefixes).toEqual([]);
  });

  test("botUsernames default to empty, trim, and reject non-string entries", () => {
    expect(parseConfig(JSON.stringify(base)).botUsernames).toEqual([]);
    expect(parseConfig(JSON.stringify({ ...base, botUsernames: [" Mr. MR ", "x-bot"] })).botUsernames).toEqual(["Mr. MR", "x-bot"]);
    expect(() => parseConfig(JSON.stringify({ ...base, botUsernames: "Mr. MR" }))).toThrow(/botUsernames/);
    expect(() => parseConfig(JSON.stringify({ ...base, botUsernames: [""] }))).toThrow(/botUsernames/);
  });

  test("ticketPrefixes are uppercased and trimmed; rejects non-string entries", () => {
    expect(parseConfig(JSON.stringify({ ...base, ticketPrefixes: ["cv", " int "] })).ticketPrefixes).toEqual(["CV", "INT"]);
    expect(() => parseConfig(JSON.stringify({ ...base, ticketPrefixes: "CV" }))).toThrow(/ticketPrefixes/);
    expect(() => parseConfig(JSON.stringify({ ...base, ticketPrefixes: [""] }))).toThrow(/ticketPrefixes/);
  });

  test("accepts a positive staleAfterDays override", () => {
    expect(parseConfig(JSON.stringify({ ...base, staleAfterDays: 30 })).staleAfterDays).toBe(30);
  });

  test("throws when staleAfterDays is not a positive number", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, staleAfterDays: 0 }))).toThrow(/staleAfterDays/);
    expect(() => parseConfig(JSON.stringify({ ...base, staleAfterDays: -5 }))).toThrow(/staleAfterDays/);
  });

  test("throws when members is missing or empty", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, members: [] }))).toThrow(/members/);
    const { members, ...noMembers } = base;
    expect(() => parseConfig(JSON.stringify(noMembers))).toThrow(/members/);
  });

  test("throws when a member has no username", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, members: [{ name: "No User" }] }))).toThrow(/username/);
  });

  test("throws when gitlabHost or projects missing", () => {
    const { gitlabHost, ...noHost } = base;
    expect(() => parseConfig(JSON.stringify(noHost))).toThrow(/gitlabHost/);
  });

  test("defaultMember defaults to all when absent", () => {
    const cfg = parseConfig(JSON.stringify(base));
    expect(cfg.defaultMember).toBe("all");
  });

  test("accepts a defaultMember matching a member's username", () => {
    const cfg = parseConfig(JSON.stringify({ ...base, defaultMember: "bob" }));
    expect(cfg.defaultMember).toBe("bob");
  });

  test("throws when defaultMember is neither 'all' nor a known member", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, defaultMember: "ghost" }))).toThrow(/defaultMember/);
  });

  test("parses a member's hidden flag and rejects a non-boolean one", () => {
    const cfg = parseConfig(JSON.stringify({ ...base, members: [{ username: "alice", hidden: true }, { username: "bob" }] }));
    expect(cfg.members[0]!.hidden).toBe(true);
    expect(cfg.members[1]!.hidden).toBeUndefined();
    expect(() => parseConfig(JSON.stringify({ ...base, members: [{ username: "alice", hidden: "yes" }] }))).toThrow(/hidden/);
  });

  test("claudeCommand defaults empty, accepts a string, rejects non-strings", () => {
    expect(parseConfig(JSON.stringify(base)).claudeCommand).toBe("");
    expect(parseConfig(JSON.stringify({ ...base, claudeCommand: "cswap run 2 -- claude" })).claudeCommand).toBe(
      "cswap run 2 -- claude",
    );
    expect(() => parseConfig(JSON.stringify({ ...base, claudeCommand: 2 }))).toThrow(/claudeCommand/);
  });

  test("reviewCwd defaults empty; reviewsWorkspace defaults to 'reviews'", () => {
    const cfg = parseConfig(JSON.stringify(base));
    expect(cfg.reviewCwd).toBe("");
    expect(cfg.reviewsWorkspace).toBe("reviews");
  });

  test("reviewCwd and reviewsWorkspace pass through", () => {
    const cfg = parseConfig(JSON.stringify({ ...base, reviewCwd: "/Users/matt/code/webapp", reviewsWorkspace: "code review" }));
    expect(cfg.reviewCwd).toBe("/Users/matt/code/webapp");
    expect(cfg.reviewsWorkspace).toBe("code review");
  });

  test("rejects non-string reviewCwd", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, reviewCwd: 5 }))).toThrow(/reviewCwd/);
  });

  test("rtRepos parses as a string map and defaults to {}", () => {
    const cfg = parseConfig(JSON.stringify({ ...base, rtRepos: { "group/proj": "proj-repo" } }));
    expect(cfg.rtRepos).toEqual({ "group/proj": "proj-repo" });
    expect(parseConfig(JSON.stringify(base)).rtRepos).toEqual({});
  });

  test("host: defaults to empty string, accepts a string, rejects non-strings", () => {
    expect(parseConfig(JSON.stringify(base)).host).toBe("");
    expect(parseConfig(JSON.stringify({ ...base, host: "0.0.0.0" })).host).toBe("0.0.0.0");
    expect(() => parseConfig(JSON.stringify({ ...base, host: 5 }))).toThrow(/host/);
  });
});

describe("switchboard config", () => {
  test("defaults to empty url", () => {
    expect(parseConfig(JSON.stringify(base)).switchboard).toEqual({ url: "" });
  });
  test("accepts an https url", () => {
    const cfg = parseConfig(JSON.stringify({ ...base, switchboard: { url: "https://sb.example.dev" } }));
    expect(cfg.switchboard.url).toBe("https://sb.example.dev");
  });
  test("rejects a non-object block", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, switchboard: "x" }))).toThrow(/switchboard/);
  });
  test("rejects a non-string url", () => {
    expect(() => parseConfig(JSON.stringify({ ...base, switchboard: { url: 5 } }))).toThrow(/switchboard.url/);
  });
});

describe("saveSwitchboardUrl", () => {
  function tmpConfig(): string {
    const p = join(mkdtempSync(join(tmpdir(), "configtest-")), "config.json");
    writeFileSync(p, JSON.stringify(base, null, 2) + "\n");
    return p;
  }

  test("writes the block and reparses", () => {
    const p = tmpConfig();
    const cfg = saveSwitchboardUrl("https://sb.example.app/", p);
    expect(cfg.switchboard.url).toBe("https://sb.example.app");
    const onDisk = JSON.parse(readFileSync(p, "utf8"));
    expect(onDisk.switchboard).toEqual({ url: "https://sb.example.app/" });
  });
});

describe("setHiddenInRaw", () => {
  const raw = JSON.stringify({ members: [{ username: "alice", name: "Alice" }, { username: "bob" }] }, null, 2);

  test("sets the hidden flag on the named member", () => {
    const parsed = JSON.parse(setHiddenInRaw(raw, "bob", true));
    expect(parsed.members.find((m: any) => m.username === "bob").hidden).toBe(true);
    expect(parsed.members.find((m: any) => m.username === "alice").hidden).toBeUndefined();
  });

  test("removes the flag entirely when set to false, keeping the file clean", () => {
    const hidden = setHiddenInRaw(raw, "alice", true);
    const shown = JSON.parse(setHiddenInRaw(hidden, "alice", false));
    expect("hidden" in shown.members[0]).toBe(false);
  });

  test("throws for an unknown member", () => {
    expect(() => setHiddenInRaw(raw, "carol", true)).toThrow(/unknown member/);
  });
});
