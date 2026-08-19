import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { tuiTheme } from "../src/theme.ts";
import { tuiIntentResolver } from "../src/intent-resolver.ts";

test("theme carries mr-board's exact values verbatim", () => {
  expect(tuiTheme.tokens.colors.blue!["500"]).toBe("#2e7de9");
  expect(tuiTheme.dark?.colors?.blue?.["500"]).toBe("#7aa2f7");
  expect(tuiTheme.tokens.colors.green!["500"]).toBe("#587539");
  expect(tuiTheme.tokens.colors.dot!["ok"]).toBe("#1f9d3a");
});

test("generated css exposes the alias contract with verbatim values reachable", () => {
  const css = readFileSync(join(import.meta.dir, "..", "src", "generated", "theme.css"), "utf8");
  for (const alias of ["--bg:", "--panel:", "--card:", "--fg:", "--muted:", "--border:", "--border-soft:", "--accent:", "--green:", "--red:", "--amber:", "--purple:", "--cyan:", "--grid-line:", "--dot-ok:", "--dot-warn:", "--dot-bad:", "--font-mono:", "--font-sans:"]) {
    expect(css).toContain(alias);
  }
  expect(css).toContain("#2e7de9"); // light accent, verbatim
  expect(css).toContain("#7aa2f7"); // dark accent, verbatim
  expect(css).toContain("#232a47"); // dark panel (the 2026-08-19 tuning), verbatim
  expect(css).toContain(".dark");   // darkMode selector
});

test("intent resolver maps intent words onto the single-shade families", () => {
  expect(tuiIntentResolver({ intent: "ok", variant: "outline", theme: tuiTheme }).color).toContain(
    "--color-green-500",
  );
  expect(tuiIntentResolver({ intent: "muted", variant: "ghost", theme: tuiTheme }).color).toContain(
    "--color-gray-muted",
  );
  expect(tuiIntentResolver({ intent: "accent", variant: "subtle", theme: tuiTheme }).hover).toBe(
    "color-mix(in srgb, var(--color-blue-500) 14%, transparent)",
  );
});

test("every wash token from the census is emitted, verbatim", () => {
  const css = readFileSync(join(import.meta.dir, "..", "src", "generated", "theme.css"), "utf8");
  for (const wash of [
    "color-mix(in srgb, var(--bg) 55%, transparent)",
    "color-mix(in srgb, var(--panel) 55%, transparent)",
    "color-mix(in srgb, var(--panel) 70%, transparent)",
    "color-mix(in srgb, var(--panel) 88%, transparent)",
    "color-mix(in srgb, var(--panel) 94%, transparent)",
    "color-mix(in srgb, var(--panel) 100%, transparent)",
    "color-mix(in srgb, var(--accent) 7%, transparent)",
    "color-mix(in srgb, var(--accent) 14%, transparent)",
    "color-mix(in srgb, var(--accent) 16%, transparent)",
    "color-mix(in srgb, var(--accent) 70%, var(--fg))",
    "color-mix(in srgb, var(--amber) 7%, transparent)",
    "color-mix(in srgb, var(--amber) 45%, transparent)",
    "color-mix(in srgb, var(--fg) 5%, transparent)",
    "color-mix(in srgb, var(--fg) 8%, transparent)",
    "color-mix(in srgb, var(--cyan) 38%, var(--panel))",
    "color-mix(in srgb, var(--cyan) 45%, var(--border))",
  ]) {
    expect(css).toContain(wash);
  }
});

test("dark block flips color-scheme and carries no font redeclarations", () => {
  const css = readFileSync(join(import.meta.dir, "..", "src", "generated", "theme.css"), "utf8");
  expect(css).toContain("color-scheme: light;");
  expect(css).toContain("color-scheme: dark;");
  // mr-board's :root.dark has 17 vars and never redeclares the font stacks;
  // in soribashi every token carries both schemes via light-dark(), so the
  // dark block holds nothing but the color-scheme flip.
  const darkBlock = css.slice(css.indexOf(".dark {"));
  expect(darkBlock.slice(0, darkBlock.indexOf("}"))).not.toContain("--font-family-");
});
