import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { runVersion } from "../version.ts";

async function banner(): Promise<string> {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
  try {
    await runVersion([]);
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

describe("rt version", () => {
  afterEach(() => { process.env.MATTSTACK_FLAVOR = "prod"; });

  test("names the app this process belongs to, from its own flavor", async () => {
    process.env.MATTSTACK_FLAVOR = "prod";
    expect(await banner()).toContain("mattstack.app");
    process.env.MATTSTACK_FLAVOR = "dev";
    const dev = await banner();
    expect(dev).toContain("mattstack-dev.app");
    expect(dev).not.toContain("dev-mode");
  });
});
