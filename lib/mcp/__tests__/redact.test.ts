import { describe, expect, test } from "bun:test";
import { redactCredentials, toCallResult } from "../redact.ts";

const FAKE_GL = "glpat-" + "A".repeat(20);
const FAKE_GH = "ghp_" + "B".repeat(36);

describe("redactCredentials", () => {
  test("strips a private_token query value from an avatar URL", () => {
    const out = redactCredentials(`https://gitlab.com/uploads/avatar.png?width=96&private_token=${FAKE_GL}`);
    expect(out).toBe("https://gitlab.com/uploads/avatar.png?width=96&private_token=[redacted]");
  });

  test("strips userinfo from a URL", () => {
    expect(redactCredentials(`https://oauth2:${FAKE_GL}@gitlab.com/acme/api.git`)).toBe("https://[redacted]@gitlab.com/acme/api.git");
  });

  test("strips access_token, job_token and token query values, case-insensitive", () => {
    expect(redactCredentials("https://h/x?ACCESS_TOKEN=abc123&job_token=def&token=ghi&page=2")).toBe("https://h/x?ACCESS_TOKEN=[redacted]&job_token=[redacted]&token=[redacted]&page=2");
  });

  test("masks bare GitLab and GitHub token shapes anywhere in text", () => {
    expect(redactCredentials(`export GITLAB_TOKEN=${FAKE_GL} and ${FAKE_GH}`)).toBe("export GITLAB_TOKEN=[redacted] and [redacted]");
  });

  test("leaves ordinary URLs and text alone", () => {
    const plain = "https://gitlab.com/acme/api/-/merge_requests/12?view=inline see user@example.com";
    expect(redactCredentials(plain)).toBe(plain);
  });
});

describe("toCallResult", () => {
  test("redacts a success body after serializing it", () => {
    const res = toCallResult({ ok: true, body: { mr: { author: { avatarUrl: `https://gitlab.com/a.png?private_token=${FAKE_GL}` } } } });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).not.toContain(FAKE_GL);
    expect(JSON.parse(res.content[0]!.text).mr.author.avatarUrl).toBe("https://gitlab.com/a.png?private_token=[redacted]");
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
