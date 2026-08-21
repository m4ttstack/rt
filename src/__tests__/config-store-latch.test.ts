import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { getSetting, setSetting } from "@mattstack/rt-client";
import { loadConfigFrom, saveMemberHidden, saveSwitchboardUrl, DEFAULT_SLACK_EMOJI } from "../config.ts";

type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

/** A resolve stand-in returning `values[key]` (or undefined for an absent
    key), matching getSetting's shape without touching any real store --
    same "tests inject a stand-in" precedent as deck's platform-settings
    latch tests (local-apps-settings-wt), just for the success path too. */
function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

function throwingResolve(message = "rt daemon unreachable"): GetSettingFn {
  return (() => {
    throw new Error(message);
  }) as GetSettingFn;
}

/** Records every setSetting call instead of writing anywhere real. */
function fakeWrite(calls: Array<{ key: string; value: unknown; scope: string }>): SetSettingFn {
  return ((key: string, value: unknown, scope: string) => {
    calls.push({ key, value, scope });
  }) as SetSettingFn;
}

const base = {
  gitlabHost: "https://gitlab.com",
  projects: ["org/repo"],
  members: [{ username: "alice", name: "Alice Ng" }, { username: "bob" }],
};

function tmpConfig(body: Record<string, unknown> = base): string {
  const p = join(mkdtempSync(join(tmpdir(), "board-latch-")), "config.json");
  writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
  return p;
}

describe("loadConfigFrom: per-key store-wins fallback", () => {
  test("an unowned key falls back to config.json's value", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, fakeResolve({}));
    expect(cfg.gitlabHost).toBe("https://gitlab.com");
    expect(cfg.projects).toEqual(["org/repo"]);
    expect(cfg.title).toBe("MRs ready for review");
  });

  test("a store-owned scalar key wins over config.json's value", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, fakeResolve({ "board.gitlabHost": "https://gitlab.example.com", "board.title": "Team Board" }));
    expect(cfg.gitlabHost).toBe("https://gitlab.example.com");
    expect(cfg.title).toBe("Team Board");
    // untouched keys still fall back to the file
    expect(cfg.projects).toEqual(["org/repo"]);
  });

  test("board.workspaces wins per sub-field, not wholesale", () => {
    const p = tmpConfig({ ...base, reviewsWorkspace: "file-reviews", respondsWorkspace: "file-responds", doctorsWorkspace: "file-doctors" });
    const cfg = loadConfigFrom(p, fakeResolve({ "board.workspaces": { reviews: "store-reviews" } }));
    expect(cfg.reviewsWorkspace).toBe("store-reviews");
    expect(cfg.respondsWorkspace).toBe("file-responds");
    expect(cfg.doctorsWorkspace).toBe("file-doctors");
  });

  test("board.cwds wins per sub-field, not wholesale", () => {
    const p = tmpConfig({ ...base, reviewCwd: "/file/review", respondCwd: "/file/respond", doctorCwd: "/file/doctor" });
    const cfg = loadConfigFrom(p, fakeResolve({ "board.cwds": { doctor: "/store/doctor" } }));
    expect(cfg.reviewCwd).toBe("/file/review");
    expect(cfg.respondCwd).toBe("/file/respond");
    expect(cfg.doctorCwd).toBe("/store/doctor");
  });

  test("board.rtRepos converts the store's array-of-pairs to config.json's path-keyed record", () => {
    const p = tmpConfig({ ...base, rtRepos: { "org/repo": "file-repo-name" } });
    const cfg = loadConfigFrom(p, fakeResolve({
      "board.rtRepos": [{ project: "org/repo", repo: "store-repo-name" }, { project: "org/other", repo: "other-name" }],
    }));
    expect(cfg.rtRepos).toEqual({ "org/repo": "store-repo-name", "org/other": "other-name" });
  });

  test("a resolver throw degrades that key to config.json's value, never crashes the load", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, throwingResolve());
    expect(cfg.gitlabHost).toBe("https://gitlab.com");
    expect(cfg.title).toBe("MRs ready for review");
  });
});

describe("loadConfigFrom: members roster + hiddenMembers overlay", () => {
  test("unowned board.members and board.hiddenMembers: hidden comes from config.json's inline flags", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice", hidden: true }, { username: "bob" }] });
    const cfg = loadConfigFrom(p, fakeResolve({}));
    expect(cfg.members).toEqual([{ username: "alice", hidden: true }, { username: "bob" }]);
  });

  test("owned board.hiddenMembers overlays hidden by username onto the file roster, replacing inline flags", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice", hidden: true }, { username: "bob" }] });
    const cfg = loadConfigFrom(p, fakeResolve({ "board.hiddenMembers": ["bob"] }));
    expect(cfg.members).toEqual([{ username: "alice" }, { username: "bob", hidden: true }]);
  });

  test("owned board.members (team roster) with owned board.hiddenMembers (user overlay) compose", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, fakeResolve({
      "board.members": [{ username: "carol", name: "Carol" }, { username: "dave" }],
      "board.hiddenMembers": ["dave"],
    }));
    expect(cfg.members).toEqual([{ username: "carol", name: "Carol" }, { username: "dave", hidden: true }]);
  });

  test("owned board.members with unowned board.hiddenMembers falls back to the store roster's own inline hidden flags", () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(p, fakeResolve({
      "board.members": [{ username: "carol", hidden: true }, { username: "dave" }],
    }));
    expect(cfg.members).toEqual([{ username: "carol", hidden: true }, { username: "dave" }]);
  });
});

describe("loadConfigFrom: config.json-optional boot once the team store owns the required fields", () => {
  test("a missing file with the store fully owning gitlabHost/projects/members loads from the store alone", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "board-latch-nofile-")), "config.json");
    const cfg = loadConfigFrom(missing, fakeResolve({
      "board.gitlabHost": "https://gitlab.example.com",
      "board.projects": ["team/repo"],
      "board.members": [{ username: "carol" }],
    }));
    expect(cfg.gitlabHost).toBe("https://gitlab.example.com");
    expect(cfg.projects).toEqual(["team/repo"]);
    expect(cfg.members).toEqual([{ username: "carol" }]);
  });

  test("a missing file with the store only partially owning the required fields still throws", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "board-latch-nofile-")), "config.json");
    expect(() =>
      loadConfigFrom(missing, fakeResolve({ "board.gitlabHost": "https://gitlab.example.com" })),
    ).toThrow(/config\.json not found/);
  });

  test("a missing file with nothing in the store throws the same instructive error as before", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "board-latch-nofile-")), "config.json");
    expect(() => loadConfigFrom(missing, fakeResolve({}))).toThrow(/config\.json not found/);
  });
});

describe("saveMemberHidden: latch-gated writer", () => {
  test("unowned: writes config.json's inline hidden flag, store untouched", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice" }, { username: "bob" }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveMemberHidden("bob", true, p, fakeResolve({}), fakeWrite(calls));
    expect(calls).toEqual([]);
    expect(cfg.members).toEqual([{ username: "alice" }, { username: "bob", hidden: true }]);
    const onDisk = JSON.parse(readFileSync(p, "utf8"));
    expect(onDisk.members.find((m: { username: string }) => m.username === "bob").hidden).toBe(true);
  });

  test("owned: writes board.hiddenMembers (user), config.json untouched", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice" }, { username: "bob" }] });
    const before = readFileSync(p, "utf8");
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden("bob", true, p, fakeResolve({ "board.hiddenMembers": [] }), fakeWrite(calls));
    expect(calls).toEqual([{ key: "board.hiddenMembers", value: ["bob"], scope: "user" }]);
    expect(readFileSync(p, "utf8")).toBe(before);
    // A resolver that already reflects the write's own value proves the overlay reads it back correctly.
    const reloaded = loadConfigFrom(p, fakeResolve({ "board.hiddenMembers": ["bob"] }));
    expect(reloaded.members).toEqual([{ username: "alice" }, { username: "bob", hidden: true }]);
  });

  test("owned: unhiding removes the username from the stored array rather than appending a duplicate", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice" }, { username: "bob" }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden("alice", false, p, fakeResolve({ "board.hiddenMembers": ["alice", "bob"] }), fakeWrite(calls));
    expect(calls).toEqual([{ key: "board.hiddenMembers", value: ["bob"], scope: "user" }]);
  });

  test("owned: an unknown member throws before any write", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice" }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden("ghost", true, p, fakeResolve({ "board.hiddenMembers": [] }), fakeWrite(calls)),
    ).toThrow(/unknown member/);
    expect(calls).toEqual([]);
  });

  test("a resolver throw on the ownership probe degrades to unowned, still writes the file", () => {
    const p = tmpConfig({ ...base, members: [{ username: "alice" }, { username: "bob" }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveMemberHidden("bob", true, p, throwingResolve(), fakeWrite(calls));
    expect(calls).toEqual([]);
    expect(cfg.members).toEqual([{ username: "alice" }, { username: "bob", hidden: true }]);
  });
});

describe("saveSwitchboardUrl: latch-gated writer", () => {
  test("unowned: writes config.json (temp-file-plus-rename), store untouched", () => {
    const p = tmpConfig();
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveSwitchboardUrl("https://sb.example.app/", p, fakeResolve({}), fakeWrite(calls));
    expect(calls).toEqual([]);
    expect(cfg.switchboard.url).toBe("https://sb.example.app");
    const onDisk = JSON.parse(readFileSync(p, "utf8"));
    expect(onDisk.switchboard).toEqual({ url: "https://sb.example.app/" });
  });

  test("owned: writes board.switchboardUrl (machine), config.json untouched", () => {
    const p = tmpConfig();
    const before = readFileSync(p, "utf8");
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveSwitchboardUrl("https://sb.example.app", p, fakeResolve({ "board.switchboardUrl": "https://old.example.app" }), fakeWrite(calls));
    expect(calls).toEqual([{ key: "board.switchboardUrl", value: "https://sb.example.app", scope: "machine" }]);
    expect(readFileSync(p, "utf8")).toBe(before);
    // A resolver that already reflects the write's own value proves the reload reads it back correctly.
    const reloaded = loadConfigFrom(p, fakeResolve({ "board.switchboardUrl": "https://sb.example.app" }));
    expect(reloaded.switchboard.url).toBe("https://sb.example.app");
  });
});

describe("slack default emoji re-export sanity", () => {
  test("still the standard set (unaffected by the migration)", () => {
    expect(DEFAULT_SLACK_EMOJI).toEqual({ looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" });
  });
});
