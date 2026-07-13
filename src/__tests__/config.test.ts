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
});
