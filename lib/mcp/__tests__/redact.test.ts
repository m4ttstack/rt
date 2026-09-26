import { describe, expect, test } from "bun:test";
import { callTool, redactCredentials, redactDeep, toCallResult } from "../redact.ts";
import type { McpToolDef } from "../shared.ts";

const FAKE_GL = "glpat-" + "A".repeat(20);
const FAKE_GH = "ghp_" + "B".repeat(36);
const FAKE_FEED = "glft-" + "C".repeat(20);

describe("redactCredentials", () => {
  test("strips a private_token query value from an avatar URL", () => {
    expect(redactCredentials(`https://gitlab.com/uploads/avatar.png?width=96&private_token=${FAKE_GL}`)).toBe("https://gitlab.com/uploads/avatar.png?width=96&private_token=[redacted]");
  });

  test("strips userinfo that carries a secret from an http(s) URL", () => {
    expect(redactCredentials(`https://oauth2:${FAKE_GL}@gitlab.com/acme/api.git`)).toBe("https://[redacted]@gitlab.com/acme/api.git");
    expect(redactCredentials("https://x-access-token:abc@github.com/a/b")).toBe("https://[redacted]@github.com/a/b");
  });

  test("strips credential query values, case-insensitive, including feed_token and sig", () => {
    expect(redactCredentials("https://h/x?ACCESS_TOKEN=abc123&job_token=def&token=ghi&feed_token=jkl&sig=mno&page=2")).toBe(
      "https://h/x?ACCESS_TOKEN=[redacted]&job_token=[redacted]&token=[redacted]&feed_token=[redacted]&sig=[redacted]&page=2",
    );
  });

  test("masks GitLab and GitHub token shapes, including after a newline", () => {
    expect(redactCredentials(`export GITLAB_TOKEN=${FAKE_GL} and ${FAKE_GH}\n${FAKE_FEED}`)).toBe("export GITLAB_TOKEN=[redacted] and [redacted]\n[redacted]");
  });

  test("masks header-style credentials", () => {
    expect(redactCredentials("PRIVATE-TOKEN: secretvalue\nAuthorization: Bearer abc.def\nJOB-TOKEN: x1")).toBe("PRIVATE-TOKEN: [redacted]\nAuthorization: [redacted]\nJOB-TOKEN: [redacted]");
  });

  test("leaves emails in query strings, ssh remotes and plain URLs alone", () => {
    for (const plain of [
      "https://gitlab.com/acme/api/-/merge_requests/12?view=inline see user@example.com",
      "https://gl.com?email=a@b.com",
      "ssh://git@gitlab.com/a/b.git",
      "git@gitlab.com:acme/api.git",
    ]) expect(redactCredentials(plain)).toBe(plain);
  });

  test("stays fast on a long pathological run", () => {
    const long = "a-".repeat(200_000) + "://x";
    const t = performance.now();
    redactCredentials(long);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("redactDeep", () => {
  test("redacts string leaves and keys without touching structure", () => {
    const out = redactDeep({ html: `<img src="https://gl.com/a.png?private_token=${FAKE_GL}">`, list: [`x\n${FAKE_GL}`, 3, null], [FAKE_GL]: true }) as Record<string, unknown>;
    expect(out.html).toBe('<img src="https://gl.com/a.png?private_token=[redacted]">');
    expect(out.list).toEqual(["x\n[redacted]", 3, null]);
    expect(Object.keys(out)).toContain("[redacted]");
  });
});

describe("toCallResult", () => {
  test("output stays valid JSON when a redacted value sat inside escaped quotes", () => {
    const res = toCallResult({ ok: true, body: { html: `<img src="https://gl.com/a.png?private_token=${FAKE_GL}">` } });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.html).toBe('<img src="https://gl.com/a.png?private_token=[redacted]">');
  });

  test("redacts an error message", () => {
    const res = toCallResult({ ok: false, body: undefined, error: `push failed for https://oauth2:${FAKE_GL}@gitlab.com/x.git` });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("push failed for https://[redacted]@gitlab.com/x.git");
  });

  test("a null body serializes as null", () => {
    expect(toCallResult({ ok: true, body: undefined }).content[0]!.text).toBe("null");
  });
});

describe("callTool", () => {
  const tool = (handler: McpToolDef["handler"]): McpToolDef => ({ name: "t", description: "", inputSchema: {}, handler });

  test("a handler that throws becomes a redacted error result, never a rejection", async () => {
    const res = await callTool(tool(async () => { throw new Error(`fetch https://oauth2:${FAKE_GL}@gitlab.com failed`); }), {}, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).not.toContain(FAKE_GL);
  });

  test("a successful handler result is redacted and parses", async () => {
    const res = await callTool(tool(async () => ({ ok: true, body: { trace: `line1\n${FAKE_GL}` } })), {}, {});
    expect(JSON.parse(res.content[0]!.text).trace).toBe("line1\n[redacted]");
  });
});
