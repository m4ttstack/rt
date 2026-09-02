import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: the fetch pipeline feeds the metrics layer, never the reverse. A pipeline
 * module importing from server/metrics would make an external data source impossible.
 */
describe("layering", () => {
  it("server/pipeline never imports server/metrics", () => {
    for (const file of readdirSync("server/pipeline")) {
      const src = readFileSync(`server/pipeline/${file}`, "utf8");
      expect(src, file).not.toMatch(/from "\.\.\/metrics\//);
    }
  });
});
