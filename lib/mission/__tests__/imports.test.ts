import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const missionDir = join(import.meta.dir, "..");

test("glitter's mission modules import nothing from lib/daemon/", () => {
  const offenders = readdirSync(missionDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => /from "\.\.\/daemon\//.test(readFileSync(join(missionDir, name), "utf8")));
  expect(offenders).toEqual([]);
});
