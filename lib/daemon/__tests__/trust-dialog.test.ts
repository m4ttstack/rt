import { describe, expect, test } from "bun:test";
import { readTrustPrompt } from "../trust-dialog.ts";

/** The plain first-run dialog: the cursor starts on "Yes, proceed". */
const PLAIN = [
  "╭──────────────────────────────────────────────╮",
  "│ Do you trust the files in this folder?       │",
  "│                                              │",
  "│ /Users/matt/Documents/GitHub/glance          │",
  "│                                              │",
  "│ Claude Code may read files in this folder.   │",
  "│                                              │",
  "│ ❯ 1. Yes, proceed                            │",
  "│   2. No, exit                                │",
  "╰──────────────────────────────────────────────╯",
].join("\n");

/** The elevated variant: the cursor defaults to "No, exit". */
const ELEVATED = [
  "╭──────────────────────────────────────────────────────────────╮",
  "│ Do you trust the files in this folder?                       │",
  "│                                                              │",
  "│ /Users/matt/Documents/GitHub/apps                            │",
  "│                                                              │",
  "│ This folder pre-approves 12 tool permissions in              │",
  "│ .claude/settings.local.json. Only proceed if you trust the   │",
  "│ authors of those settings.                                   │",
  "│                                                              │",
  "│   1. Yes, proceed                                            │",
  "│ ❯ 2. No, exit                                                │",
  "╰──────────────────────────────────────────────────────────────╯",
].join("\n");

describe("readTrustPrompt", () => {
  test("a screen with no trust dialog is not a prompt", () => {
    expect(readTrustPrompt("$ claude\nworking on the brief...\n")).toBeNull();
  });

  test("a brief that merely mentions trust is not a prompt", () => {
    expect(readTrustPrompt("reading the brief: trust the fixture owner\n")).toBeNull();
  });

  test("the plain dialog accepts with a bare enter", () => {
    expect(readTrustPrompt(PLAIN)).toEqual({ kind: "accept", variant: "plain", keys: ["enter"] });
  });

  test("the elevated dialog walks up to Yes before entering", () => {
    expect(readTrustPrompt(ELEVATED)).toEqual({ kind: "accept", variant: "elevated", keys: ["up", "enter"] });
  });

  test("the variant names the dialog's own text, not the cursor's distance", () => {
    const preApprovedButCursorOnYes = [
      "Do you trust the files in this folder?",
      "This folder pre-approves 12 tool permissions in .claude/settings.local.json.",
      "❯ 1. Yes, proceed",
      "  2. No, exit",
    ].join("\n");
    expect(readTrustPrompt(preApprovedButCursorOnYes)).toEqual({ kind: "accept", variant: "elevated", keys: ["enter"] });
  });

  test("a cursor below the accept option walks up once per option", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "  1. Yes, proceed",
      "  2. Ask me later",
      "❯ 3. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "accept", variant: "plain", keys: ["up", "up", "enter"] });
  });

  test("a cursor above the accept option walks down", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "❯ 1. No, exit",
      "  2. Yes, proceed",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "accept", variant: "plain", keys: ["down", "enter"] });
  });

  test("a trust dialog whose cursor cannot be located is undrivable, never a guessed enter", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "  1. Yes, proceed",
      "  2. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "undrivable" });
  });

  test("a trust dialog with no accept option is undrivable", () => {
    const screen = [
      "Do you trust the files in this folder?",
      "❯ 1. No, exit",
    ].join("\n");
    expect(readTrustPrompt(screen)).toEqual({ kind: "undrivable" });
  });

  test("the header is recognized even when the options have scrolled off", () => {
    expect(readTrustPrompt("│ Do you trust the files in this folder?  │\n")).toEqual({ kind: "undrivable" });
  });
});
