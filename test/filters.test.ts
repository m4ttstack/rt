import { describe, expect, it } from "vitest";

import { buildIgnoredMrSet, buildMetricFilters, globToRegExp, isDoneState, matchesTeam } from "../src/server/metrics/filters.js";
import { mr } from "./fixtures.js";

describe("globToRegExp", () => {
  it("matches at any depth when the pattern has no slash", () => {
    const re = globToRegExp("*.json");
    expect(re.test("package.json")).toBe(true);
    expect(re.test("apps/backend/package.json")).toBe(true);
    expect(re.test("apps/backend/index.ts")).toBe(false);
  });

  it("anchors to the path when the pattern has a slash", () => {
    const re = globToRegExp("generated/*");
    expect(re.test("generated/schema.ts")).toBe(true);
    expect(re.test("apps/generated/schema.ts")).toBe(false);
  });
});

describe("buildIgnoredMrSet", () => {
  const ignored = buildIgnoredMrSet(["!7", "org/app!9", " ", "org/other!7"]);

  it("bare !iid matches every project; project!iid matches one", () => {
    expect(ignored({ iid: 7, projectPath: "org/app" })).toBe(true);
    expect(ignored({ iid: 7, projectPath: "org/zzz" })).toBe(true);
    expect(ignored({ iid: 9, projectPath: "org/app" })).toBe(true);
    expect(ignored({ iid: 9, projectPath: "org/other" })).toBe(false);
  });

  it("an empty list ignores nothing", () => {
    expect(buildIgnoredMrSet([])({ iid: 7, projectPath: "org/app" })).toBe(false);
    expect(buildIgnoredMrSet(undefined)({ iid: 7, projectPath: "org/app" })).toBe(false);
  });
});

describe("buildMetricFilters", () => {
  it("excludes matching files from line counts and memoizes per MR", () => {
    const f = buildMetricFilters({ excludeFilePatterns: ["*.json"] });
    const m = mr({
      iid: 1,
      authorUsername: "alice",
      title: "x",
      additions: 30,
      deletions: 3,
      diffStats: [
        { path: "src/a.ts", additions: 10, deletions: 1 },
        { path: "package.json", additions: 20, deletions: 2 },
      ],
    });
    expect(f.lineCounts(m)).toEqual({ additions: 10, deletions: 1 });
    expect(f.lineCounts(m)).toBe(f.lineCounts(m));
  });

  it("hasTeamTicket scans title, branch, and description, and passes everything with no team", () => {
    const gated = buildMetricFilters({ linearTeam: "ENG" });
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: "eng-12-fix", description: null })).toBe(true);
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: null, description: "closes ENG:9" })).toBe(true);
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: null, description: null })).toBe(false);
    const open = buildMetricFilters({});
    expect(open.hasTeamTicket({ title: "fix", sourceBranch: null, description: null })).toBe(true);
  });

  it("isBot honors extra patterns and skips a bad regex", () => {
    const f = buildMetricFilters({ extraBotPatterns: ["^ci-", "("] });
    expect(f.isBot("ci-runner")).toBe(true);
    expect(f.isBot("alice")).toBe(false);
  });
});

describe("Linear gates", () => {
  it("matchesTeam is a case-insensitive prefix check", () => {
    expect(matchesTeam("eng-1", "ENG")).toBe(true);
    expect(matchesTeam("ENGX-1", "ENG")).toBe(false);
    expect(matchesTeam("PLA-1", undefined)).toBe(true);
  });

  it("isDoneState falls open on missing data and honors explicit state names", () => {
    expect(isDoneState(null, null, ["Done"])).toBe(true);
    expect(isDoneState("started", "In Progress", ["Done"])).toBe(false);
    expect(isDoneState("completed", "Shipped", ["Done"])).toBe(false);
    expect(isDoneState("canceled", "Won't do", [])).toBe(true);
  });
});
