import { describe, expect, test } from "bun:test";
import { parseConfig } from "../config.ts";

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
});
