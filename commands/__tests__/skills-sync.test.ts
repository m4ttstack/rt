import { describe, expect, test } from "bun:test";
import type { PackInfo } from "../../lib/skills/packs.ts";
import { deriveEngine } from "../skills-sync.ts";

function pack(name: string): PackInfo {
  return { name, dir: `/fake/${name}`, layout: "flat", surfacePath: `/fake/${name}/surface.jsonc`, marketplace: "local" };
}

describe("deriveEngine", () => {
  test("uses the discovered mattstack pack as the engine", () => {
    const mattstack = pack("mattstack");
    const acme = pack("acme");
    const result = deriveEngine([acme, mattstack], acme);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("the mattstack pack is its own engine", () => {
    const mattstack = pack("mattstack");
    const result = deriveEngine([mattstack], mattstack);
    expect("engine" in result && result.engine).toBe(mattstack);
  });

  test("refuses naming the pack and the marketplace registration when no mattstack pack is discovered", () => {
    const acme = pack("acme");
    const result = deriveEngine([acme], acme);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain('"acme"');
      expect(result.error).toContain("mattstack");
      expect(result.error).toContain("extraKnownMarketplaces");
    }
  });
});
