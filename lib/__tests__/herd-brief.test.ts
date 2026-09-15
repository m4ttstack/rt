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

  test("a marker wrapped across a line break is still caught as leftover when unfilled", () => {
    // Mirrors the real job-template.md: word-wrapped prose puts the slot's
    // < and > on different physical lines.
    const templateWithWrappedMarker = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Inputs",
      "<paths the worker may read and must not modify -- supplied specs or",
      'plans, often gitignored. "none" if none.>',
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedMarker,
      job: "widget-job",
      fills: { goal: "ship the widget" }, // Inputs slot left unfilled
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.leftover).toEqual(['paths the worker may read and must not modify -- supplied specs or plans, often gitignored. "none" if none.']);
  });

  test("a wrapped marker is filled when the fill key uses collapsed whitespace", () => {
    const templateWithWrappedMarker = [
      "# Job: <name>",
      "",
      "## Inputs",
      "<paths the worker may read and must not modify -- supplied specs or",
      'plans, often gitignored. "none" if none.>',
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedMarker,
      job: "widget-job",
      fills: {
        'paths the worker may read and must not modify -- supplied specs or plans, often gitignored. "none" if none.':
          "none",
      },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("## Inputs\nnone");
  });

  test("decorative markers inside backticks or quotes in flowing prose are left literal, not flagged as leftover", () => {
    // Mirrors the real job-template.md boilerplate: illustrative command
    // syntax embeds its own <angle-bracket> placeholders in backticks or
    // quotes, meant for the eventual worker to fill in later -- not for
    // the assembler to fill now.
    const templateWithDecorativeExamples = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Messages",
      "Arrives as `[#<room>] <handle> #<n>: ...`.",
      "",
      "## Milestones",
      "Run `rt herd answer <id>`; a reviewer replies as `review-<your job>`.",
      "",
      "## Asking",
      'Options like "Walk me through <section> first".',
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithDecorativeExamples,
      job: "widget-job",
      fills: { goal: "ship the widget" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("`[#<room>] <handle> #<n>: ...`");
    expect(result.brief).toContain("`rt herd answer <id>`");
    expect(result.brief).toContain("`review-<your job>`");
    expect(result.brief).toContain('"Walk me through <section> first"');
  });

  test("decorative markers stay literal even when the enclosing backtick span itself wraps across lines", () => {
    // Mirrors the real job-template.md exactly: the backtick opens before
    // the line break and closes after it, with two markers inside.
    const templateWithWrappedBacktickSpan = [
      "# Job: <name>",
      "",
      "Goal: <goal>",
      "",
      "## Method",
      "",
      "<REQUIRED: describe the approach here>",
      "",
      "## Asking",
      "naming the surface that recorded it: `[gate] <id> answered",
      "by <surface>; re-read the registry and proceed.` The daemon.",
      "",
    ].join("\n");

    const result = assembleBrief({
      template: templateWithWrappedBacktickSpan,
      job: "widget-job",
      fills: { goal: "ship the widget" },
      method: { kind: "file", content: "Do the thing." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief).toContain("`[gate] <id> answered\nby <surface>; re-read the registry and proceed.`");
  });
});
