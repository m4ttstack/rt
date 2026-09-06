import { describe, expect, test } from "bun:test";
import { allDefs } from "@mattstack/rt-client";
import {
  COMPOSITE_SHAPES,
  addToList,
  filterDefs,
  getLeaf,
  groupByScope,
  isSet,
  matchesShape,
  parseScalar,
  rosterSummary,
  rowKind,
  scopeLabel,
  setLeaf,
  slugTabId,
  type ConfigDef,
} from "../board/config-shapes.ts";

function def(over: Partial<ConfigDef> & { key: string }): ConfigDef {
  return {
    type: "string",
    scopes: ["team"],
    merge: "replace",
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: "",
    hasDefault: false,
    defaultValue: undefined,
    effective: { scope: null, file: null },
    ...over,
  };
}

/** Composite board.* registry keys with no edit UI yet -- rowKind's
    "readonly" fallback (no COMPOSITE_SHAPES entry) is the intended
    rendering for these, not a coverage gap. */
// board.rtRepos is retired: the board derives it from board.projects and
// board.gitlabHost (config.ts deriveRtRepos). The registry row goes with the
// next @mattstack/rt-client publish; until board picks that up, the key is
// still registered and must not be offered for editing.
// board.reReview ({enabled}, rt-client 0.16.0) has no editor shape yet --
// pending its own task, not a coverage gap.
const DELIBERATELY_READONLY_COMPOSITES: string[] = ["board.rtRepos", "board.reReview"];

describe("COMPOSITE_SHAPES", () => {
  test("covers every composite board.* key in the registry except the deliberately-readonly ones", () => {
    const composites = allDefs()
      .filter((d) => d.key.startsWith("board.") && (d.type === "object" || d.type === "array"))
      .map((d) => d.key)
      .filter((k) => !DELIBERATELY_READONLY_COMPOSITES.includes(k))
      .sort();
    expect(Object.keys(COMPOSITE_SHAPES).sort()).toEqual(composites);
  });

  test("names no key the registry lacks", () => {
    const known = new Set(allDefs().map((d) => d.key));
    for (const key of Object.keys(COMPOSITE_SHAPES)) expect(known.has(key)).toBe(true);
  });
});

describe("rowKind", () => {
  test("scalars by type when writable", () => {
    expect(rowKind(def({ key: "board.title" }))).toBe("scalar");
    expect(rowKind(def({ key: "board.staleAfterDays", type: "number" }))).toBe("scalar");
  });

  test("secrets and unwritable keys are read-only", () => {
    expect(rowKind(def({ key: "board.title", secret: true }))).toBe("readonly");
    expect(rowKind(def({ key: "board.title", writable: false }))).toBe("readonly");
  });

  test("composites dispatch on their shape", () => {
    expect(rowKind(def({ key: "board.projects", type: "array" }))).toBe("stringList");
    expect(rowKind(def({ key: "board.cwds", type: "object" }))).toBe("leaves");
  });

  test("roster keys summarize regardless of writability", () => {
    expect(rowKind(def({ key: "board.members", type: "array", writable: false }))).toBe("roster");
    expect(rowKind(def({ key: "board.hiddenMembers", type: "array" }))).toBe("roster");
  });

  test("composites the server refuses, or with no shape, are read-only", () => {
    expect(rowKind(def({ key: "board.projects", type: "array", writable: false }))).toBe("readonly");
    expect(rowKind(def({ key: "board.mystery", type: "object" }))).toBe("readonly");
  });
});

describe("isSet", () => {
  test("true only when a real scope layer holds the value", () => {
    expect(isSet(def({ key: "k", effective: { scope: "team", value: "x", file: "/t" } }))).toBe(true);
    expect(isSet(def({ key: "k", effective: { scope: "default", value: "x", file: null } }))).toBe(false);
    expect(isSet(def({ key: "k", effective: { scope: null, file: null } }))).toBe(false);
    expect(isSet(def({ key: "k" }))).toBe(false);
  });
});

describe("scopeLabel", () => {
  test("machine applies immediately; the git-backed scopes warn", () => {
    expect(scopeLabel("machine")).toBe("machine");
    expect(scopeLabel("user")).toBe("user · local until pushed");
    expect(scopeLabel("team")).toBe("team · local until pushed");
  });
});

describe("matchesShape", () => {
  test("stringList accepts only arrays of strings", () => {
    const s = COMPOSITE_SHAPES["board.projects"]!;
    expect(matchesShape(s, [])).toBe(true);
    expect(matchesShape(s, ["a/b"])).toBe(true);
    expect(matchesShape(s, ["a", 1])).toBe(false);
    expect(matchesShape(s, "a")).toBe(false);
  });

  test("board.rtRepos is no longer a configurable key: the board derives it", () => {
    expect(COMPOSITE_SHAPES["board.rtRepos"]).toBeUndefined();
  });

  test("pairList accepts arrays of objects carrying both string fields", () => {
    const s = { kind: "pairList", fields: ["project", "repo"] } as const;
    expect(matchesShape(s, [{ project: "g/p", repo: "host/x" }])).toBe(true);
    expect(matchesShape(s, [{ project: "g/p" }])).toBe(false);
    expect(matchesShape(s, [["g/p", "x"]])).toBe(false);
  });

  test("leaves accepts a plain object whose known leaves have the right type; unknown keys pass through", () => {
    const s = COMPOSITE_SHAPES["board.triage"]!;
    expect(matchesShape(s, {})).toBe(true);
    expect(matchesShape(s, { enabled: true, fixClasses: { retryFlake: false }, notify: "rt" })).toBe(true);
    expect(matchesShape(s, { enabled: "yes" })).toBe(false);
    expect(matchesShape(s, { notify: "loud" })).toBe(false);
    expect(matchesShape(s, { fixClasses: { retryFlake: "no" } })).toBe(false);
    expect(matchesShape(s, { doctorSkill: "x" })).toBe(true);
    expect(matchesShape(s, [])).toBe(false);
  });
});

describe("leaf access", () => {
  test("getLeaf walks dotted paths and tolerates missing branches", () => {
    expect(getLeaf({ emoji: { looking: "eyes" } }, "emoji.looking")).toBe("eyes");
    expect(getLeaf({}, "emoji.looking")).toBeUndefined();
    expect(getLeaf(undefined, "channel")).toBeUndefined();
  });

  test("setLeaf returns a new object, creating intermediates, without touching the input", () => {
    const before = { channel: "reviews", emoji: { looking: "eyes" } };
    const after = setLeaf(before, "emoji.approved", "white_check_mark");
    expect(after).toEqual({ channel: "reviews", emoji: { looking: "eyes", approved: "white_check_mark" } });
    expect(before).toEqual({ channel: "reviews", emoji: { looking: "eyes" } });
    expect(setLeaf(undefined, "a.b", 1)).toEqual({ a: { b: 1 } });
  });

  test("setLeaf with undefined removes the leaf", () => {
    expect(setLeaf({ a: 1, b: 2 }, "a", undefined)).toEqual({ b: 2 });
  });
});

describe("parseScalar", () => {
  test("strings pass through untouched", () => {
    expect(parseScalar("string", "  x ")).toEqual({ ok: true, value: "  x " });
  });

  test("numbers must parse whole", () => {
    expect(parseScalar("number", "14")).toEqual({ ok: true, value: 14 });
    expect(parseScalar("number", " 2.5 ")).toEqual({ ok: true, value: 2.5 });
    expect(parseScalar("number", "")).toEqual({ ok: false, error: "enter a number" });
    expect(parseScalar("number", "14 days")).toEqual({ ok: false, error: "not a number" });
  });
});

describe("addToList", () => {
  test("trims, drops empties, and refuses duplicates", () => {
    expect(addToList(["a"], " b ")).toEqual(["a", "b"]);
    expect(addToList(["a"], "   ")).toBeNull();
    expect(addToList(["a"], "a")).toBeNull();
  });
});

describe("filterDefs", () => {
  const defs = [
    def({ key: "board.title", description: "Display title shown in the board's UI." }),
    def({ key: "board.staleAfterDays", description: "Days of MR inactivity before stale." }),
  ];

  test("empty query keeps everything", () => {
    expect(filterDefs(defs, "  ")).toHaveLength(2);
  });

  test("matches key or description, case-insensitively", () => {
    expect(filterDefs(defs, "STALE").map((d) => d.key)).toEqual(["board.staleAfterDays"]);
    expect(filterDefs(defs, "display").map((d) => d.key)).toEqual(["board.title"]);
    expect(filterDefs(defs, "nothing")).toEqual([]);
  });
});

describe("groupByScope", () => {
  test("orders team, user, machine and drops empty groups", () => {
    const groups = groupByScope([
      def({ key: "m", scopes: ["machine"] }),
      def({ key: "t", scopes: ["team"] }),
      def({ key: "m2", scopes: ["machine"] }),
    ]);
    expect(groups.map((g) => [g.scope, g.defs.map((d) => d.key)])).toEqual([
      ["team", ["t"]],
      ["machine", ["m", "m2"]],
    ]);
  });
});

describe("rosterSummary", () => {
  test("counts members and hidden entries, tolerating unset values", () => {
    expect(rosterSummary([{ username: "a" }, { username: "b", hidden: true }], ["c"])).toBe("2 members, 2 hidden");
    expect(rosterSummary(undefined, undefined)).toBe("no members");
    expect(rosterSummary([{ username: "a" }], undefined)).toBe("1 member");
  });
});

describe("tabs shape", () => {
  const s = COMPOSITE_SHAPES["board.tabs"]!;
  const team = { id: "team", label: "Team", source: { kind: "authors" } };
  const acme = { id: "acme", label: "Acme", source: { kind: "codeowners", section: "Acme", excludeMembers: true }, slackChannel: "c", reviewSkill: "s" };

  test("board.tabs rows are the tabs kind regardless of writability", () => {
    expect(rowKind(def({ key: "board.tabs", type: "array" }))).toBe("tabs");
  });

  test("accepts the shapes parseTabs accepts", () => {
    expect(matchesShape(s, [team])).toBe(true);
    expect(matchesShape(s, [team, acme])).toBe(true);
  });

  test("rejects an empty list and duplicate ids, like parseTabs", () => {
    expect(matchesShape(s, [])).toBe(false);
    expect(matchesShape(s, [team, { ...acme, id: "team" }])).toBe(false);
  });

  test("rejects what parseTabs rejects", () => {
    expect(matchesShape(s, "team")).toBe(false);
    expect(matchesShape(s, [{ ...team, id: "" }])).toBe(false);
    expect(matchesShape(s, [{ ...team, label: 3 }])).toBe(false);
    expect(matchesShape(s, [{ ...team, source: { kind: "codeowners" } }])).toBe(false);
    expect(matchesShape(s, [{ ...acme, source: { ...acme.source, excludeMembers: "yes" } }])).toBe(false);
    expect(matchesShape(s, [{ ...team, source: { kind: "other" } }])).toBe(false);
    expect(matchesShape(s, [{ ...team, slackChannel: 1 }])).toBe(false);
  });
});

describe("slugTabId", () => {
  test("slugs the label and dodges taken ids", () => {
    expect(slugTabId("Acme Codeowners", [])).toBe("acme-codeowners");
    expect(slugTabId("  Team!  ", ["team"])).toBe("team-2");
    expect(slugTabId("Team", ["team", "team-2"])).toBe("team-3");
    expect(slugTabId("???", [])).toBe("tab");
  });
});
