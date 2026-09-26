import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../scripts/derive.ts";
import { MATRIX_CLASSIFICATION } from "../src/a11y/matrix-classification.ts";

/**
 * Node-tier guard over matrix-classification.ts. Mirrors soribashi's
 * packages/ui/test/matrix-guard.test.ts: builds the manifest in memory
 * (buildManifest(), same pattern token-existence.test.ts already uses) so
 * this stays correct as recipes are added, rather than hardcoding a list.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const ONLY_FULL_GRID_NAME = "Button";

describe("contrast matrix classification guard", () => {
  it("every manifest recipe has a MATRIX_CLASSIFICATION entry", async () => {
    const manifest = await buildManifest();
    // Floor: a silently-empty manifest would make the loop below pass
    // vacuously (same guard token-existence.test.ts uses).
    expect(manifest.recipes.length, "expected at least one manifest recipe").toBeGreaterThan(0);

    const missing = manifest.recipes.map((r) => r.name).filter((name) => !(name in MATRIX_CLASSIFICATION));

    expect(
      missing,
      missing.length === 0
        ? undefined
        : `Missing MATRIX_CLASSIFICATION entries for: ${missing.join(", ")}. Add each to ` +
            "src/a11y/matrix-classification.ts as 'covered' (Button.matrix.test.tsx's grid only), " +
            "{ toneMapCoveredBy: '<path to the recipe's own visual-baseline test>' }, or " +
            "{ exempt: '<reason>' }.",
    ).toEqual([]);
  });

  it("only Button is classified 'covered'", () => {
    const invalid = Object.entries(MATRIX_CLASSIFICATION)
      .filter(([, c]) => c === "covered")
      .map(([name]) => name)
      .filter((name) => name !== ONLY_FULL_GRID_NAME);

    expect(
      invalid,
      invalid.length === 0
        ? undefined
        : `These recipes are classified 'covered' but only Button has a contrast grid ` +
            `(Button.matrix.test.tsx): ${invalid.join(", ")}. Reclassify as { toneMapCoveredBy } or { exempt }.`,
    ).toEqual([]);
  });

  it("every toneMapCoveredBy path points at a real, existing test file", () => {
    const broken = Object.entries(MATRIX_CLASSIFICATION)
      .filter((entry): entry is [string, { toneMapCoveredBy: string }] => {
        const c = entry[1];
        return typeof c === "object" && "toneMapCoveredBy" in c;
      })
      .filter(([, c]) => !existsSync(join(REPO_ROOT, c.toneMapCoveredBy)))
      .map(([name, c]) => `${name} -> ${c.toneMapCoveredBy}`);

    expect(
      broken,
      broken.length === 0
        ? undefined
        : `These toneMapCoveredBy paths do not exist on disk: ${broken.join("; ")}`,
    ).toEqual([]);
  });
});
