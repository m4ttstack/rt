import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Packaging gate for oven-sh/bun#18921: Bun through 1.3.14 hashes a CSS
 * module's `@keyframes` ident but emits `animation` / `animation-name`
 * verbatim, so a keyframe declared inside `*.module.css` paints frame zero
 * and never moves in a consumer built with `Bun.build`. The kit keeps
 * keyframes AND their `animation` declarations in a plain
 * `<Recipe>.keyframes.css` sibling (docs/decisions.md). This test bundles
 * the barrel with the local `bun` and reads the CSS it emits, the only place
 * the mismatch is observable: computed styles report the specified ident
 * either way, and the Vite tiers rewrite both sides so they never see it.
 */

const ENTRY = join(import.meta.dirname, "fixtures", "bun-build-entry.ts");

/** Every keyframe ident the kit ships, under the global name it must keep. */
const KIT_KEYFRAMES = [
  "chip-pulse",
  "contextmenu-in",
  "drawer-slide-in",
  "sb-spinner-spin",
  "toasthost-in",
] as const;

/** `animation` shorthand words that are never a custom ident. */
const ANIMATION_KEYWORDS = new Set([
  "none",
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

function bundleWithBun(): string {
  const outdir = mkdtempSync(join(tmpdir(), "tui-kit-bun-build-"));
  try {
    execFileSync("bun", ["build", ENTRY, "--outdir", outdir, "--target", "browser"], {
      stdio: "pipe",
    });
    return readdirSync(outdir)
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(outdir, file), "utf8"))
      .join("\n");
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

function keyframesNames(css: string): Set<string> {
  return new Set([...css.matchAll(/@keyframes\s+([^\s{]+)/g)].map((m) => m[1] as string));
}

/** Custom idents named by every `animation` / `animation-name` declaration. */
function referencedAnimationNames(css: string): string[] {
  const names: string[] = [];
  for (const m of css.matchAll(/(?<![\w-])animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    const value = (m[1] as string).replace(/[\w-]+\([^)]*\)/g, " ");
    for (const token of value.split(/[\s,]+/)) {
      if (!token || ANIMATION_KEYWORDS.has(token)) continue;
      if (/^[\d.]+(?:m?s)?$/.test(token)) continue;
      names.push(token);
    }
  }
  return names;
}

describe("Bun.build: every animation ident resolves inside the emitted bundle", () => {
  let css = "";
  beforeAll(() => {
    css = bundleWithBun();
  });

  it("the bundle carries CSS with keyframes at all", () => {
    expect(css.length).toBeGreaterThan(0);
    expect(keyframesNames(css).size).toBeGreaterThanOrEqual(KIT_KEYFRAMES.length);
  });

  it.each(KIT_KEYFRAMES)("emits @keyframes %s under its global, unhashed name", (name) => {
    expect([...keyframesNames(css)]).toContain(name);
  });

  it("every animation / animation-name ident names a @keyframes rule in the same bundle", () => {
    const declared = keyframesNames(css);
    const referenced = referencedAnimationNames(css);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
  });
});
