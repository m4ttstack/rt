import { afterEach, describe, expect, it } from "vitest";
import { readSecrets } from "../server/config/secrets.js";

const ENV_KEYS = ["GITLAB_TOKEN", "LINEAR_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readSecrets", () => {
  it("env vars win without touching the daemon", async () => {
    process.env.GITLAB_TOKEN = "glpat-env";
    process.env.LINEAR_API_KEY = "lin_api_env";
    const post = () => {
      throw new Error("daemon must not be called when env covers both keys");
    };
    const res = await readSecrets({ readApiToken: () => "t", post: post as never });
    expect(res).toEqual({ gitlabToken: "glpat-env", linearApiKey: "lin_api_env" });
  });

  it("fills missing keys from the daemon", async () => {
    process.env.GITLAB_TOKEN = "glpat-env";
    delete process.env.LINEAR_API_KEY;
    const res = await readSecrets({
      readApiToken: () => "t",
      post: async () => ({ ok: true, data: { gitlabToken: "glpat-daemon", linearApiKey: "lin_api_daemon" } }),
    });
    expect(res.gitlabToken).toBe("glpat-env");
    expect(res.linearApiKey).toBe("lin_api_daemon");
    expect(res.warning).toBeUndefined();
  });

  it("degrades to not-configured with one warning when the daemon is unreachable", async () => {
    delete process.env.GITLAB_TOKEN;
    delete process.env.LINEAR_API_KEY;
    const res = await readSecrets({
      readApiToken: () => {
        throw new Error("ENOENT api-token");
      },
      post: async () => ({ ok: true, data: {} }),
    });
    expect(res.gitlabToken).toBeUndefined();
    expect(res.linearApiKey).toBeUndefined();
    expect(res.warning).toContain("rt daemon");
  });

  it("a daemon refusal surfaces as a warning, not a throw", async () => {
    delete process.env.GITLAB_TOKEN;
    const res = await readSecrets({
      readApiToken: () => "t",
      post: async () => ({ ok: false, error: "bad-token" }),
    });
    expect(res.warning).toContain("bad-token");
  });
});
