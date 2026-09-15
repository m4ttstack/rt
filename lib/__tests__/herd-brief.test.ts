import { describe, expect, test } from "bun:test";
import { assembleBrief } from "../herd-brief.ts";

const HAPPY_TEMPLATE = [
  "# Job: <name>",
  "",
  "Goal: <goal>",
  "",
  "Paths: <paths>",
  "",
  "## Method",
  "",
  "<REQUIRED: describe the approach here>",
  "",
  "## Done",
  "",
  "Nothing else.",
  "",
].join("\n");

const STRATEGIES = [
  "## trivial",
  "",
  "```",
  "Do the trivial thing.",
  "```",
  "",
  "## other",
  "",
  "```",
  "Do other thing.",
  "```",
  "",
].join("\n");

describe("assembleBrief", () => {
  test("happy path fills a 3-slot template and splices in the strategy body", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("# Job: widget-job");
    expect(result.brief).toContain("Goal: ship the widget");
    expect(result.brief).toContain("Paths: src/**");
    expect(result.brief).toContain("Do the trivial thing.");
    expect(result.brief).not.toContain("<REQUIRED");
    expect(result.brief).not.toContain("<name>");
    expect(result.brief).not.toContain("<goal>");
    expect(result.brief).not.toContain("<paths>");
    expect(result.brief).toContain("## Done");
    expect(result.brief).toContain("Nothing else.");
  });

  test("unknown strategy name errors and names the available strategies", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "strategy", strategies: STRATEGIES, name: "nonexistent" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unknown strategy 'nonexistent'; available: trivial, other");
  });

  test("leftover unfilled markers are reported and fail assembly", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget" }, // paths left unfilled
      method: { kind: "strategy", strategies: STRATEGIES, name: "trivial" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.leftover).toEqual(["paths"]);
    expect(result.error).toBe("unfilled markers: paths");
  });

  test("method-file variant bypasses the strategies file entirely", () => {
    const result = assembleBrief({
      template: HAPPY_TEMPLATE,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "file", content: "Do exactly this custom thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("Do exactly this custom thing.");
    expect(result.brief).not.toContain("<REQUIRED");
  });

  test("indented example lines are excluded from marker substitution and the leftover check", () => {
    const templateWithIndentedExample = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "Paths: <paths>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Notes",
      "",
      "Example command:",
      "    echo <not-a-real-marker>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithIndentedExample,
      job: "widget-job",
      fills: { goal: "ship the widget", paths: "src/**" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("    echo <not-a-real-marker>");
  });
});
