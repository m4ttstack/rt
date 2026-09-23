import { describe, expect, test } from "bun:test";
import { createTestHome, rt } from "../harness.ts";

describe("rt skills writing-style show", () => {
  test("--json on a fresh home resolves to the conversational fallback", async () => {
    const { path: home, cleanup } = createTestHome();
    try {
      const res = await rt(["skills", "writing-style", "show", "--json"], { home });
      expect(res.exitCode).toBe(0);
      const body = JSON.parse(res.stdout);
      expect(body.contract).toBe(1);
      expect(body.skill).toBe("mattstack:writing-style-conversational");
      expect(body.source).toBe("fallback");
    } finally {
      cleanup();
    }
  });
});

describe("rt skills writing-style use", () => {
  test("a leading-dash id reaches the handler as an id, not a flag", async () => {
    const { path: home, cleanup } = createTestHome();
    try {
      const res = await rt(["skills", "writing-style", "use", "-rf", "--json"], { home });
      expect(res.exitCode).toBe(2);
      const body = JSON.parse(res.stdout);
      expect(body.error.code).toBe("bad-id");
    } finally {
      cleanup();
    }
  });
});
