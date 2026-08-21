import { afterEach, describe, expect, test } from "bun:test";
import { loadGitLabToken, loadSlackToken, loadSwitchboardToken, loadSwitchboardAdminToken } from "../config.ts";
import type { BoardSecretsData } from "../board-secrets.ts";
import type { RtResponse } from "@mattstack/rt-client";

const ENV_KEYS = ["GITLAB_TOKEN", "SLACK_TOKEN", "SWITCHBOARD_TOKEN", "SWITCHBOARD_ADMIN_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function daemonDeps(data: BoardSecretsData) {
  return {
    readApiToken: () => "tok",
    post: async (): Promise<RtResponse<BoardSecretsData>> => ({ ok: true, data }),
  };
}

function refusedDeps(error: string) {
  return {
    readApiToken: () => "tok",
    post: async (): Promise<RtResponse<BoardSecretsData>> => ({ ok: false, error }),
  };
}

describe("config.ts board secrets loaders", () => {
  test("loadGitLabToken prefers GITLAB_TOKEN over the daemon", async () => {
    process.env.GITLAB_TOKEN = "env-gitlab";
    const token = await loadGitLabToken(daemonDeps({ gitlabToken: "daemon-gitlab" }));
    expect(token).toBe("env-gitlab");
  });

  test("loadGitLabToken falls back to the daemon board scope when unset", async () => {
    delete process.env.GITLAB_TOKEN;
    const token = await loadGitLabToken(daemonDeps({ gitlabToken: "daemon-gitlab" }));
    expect(token).toBe("daemon-gitlab");
  });

  test("loadGitLabToken returns null when neither env nor daemon has it", async () => {
    delete process.env.GITLAB_TOKEN;
    const token = await loadGitLabToken(daemonDeps({}));
    expect(token).toBeNull();
  });

  test("loadGitLabToken returns null (not a throw) when the daemon is unreachable", async () => {
    delete process.env.GITLAB_TOKEN;
    const token = await loadGitLabToken(refusedDeps("rt daemon unreachable at /fake/rt.sock: ECONNREFUSED"));
    expect(token).toBeNull();
  });

  test("loadSlackToken prefers SLACK_TOKEN over the daemon", async () => {
    process.env.SLACK_TOKEN = "env-slack";
    const token = await loadSlackToken(daemonDeps({ slackToken: "daemon-slack" }));
    expect(token).toBe("env-slack");
  });

  test("loadSlackToken falls back to the daemon", async () => {
    delete process.env.SLACK_TOKEN;
    const token = await loadSlackToken(daemonDeps({ slackToken: "daemon-slack" }));
    expect(token).toBe("daemon-slack");
  });

  test("loadSwitchboardToken prefers SWITCHBOARD_TOKEN over the daemon", async () => {
    process.env.SWITCHBOARD_TOKEN = "env-sb";
    const token = await loadSwitchboardToken(daemonDeps({ switchboardToken: "daemon-sb" }));
    expect(token).toBe("env-sb");
  });

  test("loadSwitchboardToken falls back to the daemon", async () => {
    delete process.env.SWITCHBOARD_TOKEN;
    const token = await loadSwitchboardToken(daemonDeps({ switchboardToken: "daemon-sb" }));
    expect(token).toBe("daemon-sb");
  });

  test("loadSwitchboardAdminToken prefers SWITCHBOARD_ADMIN_TOKEN over the daemon", async () => {
    process.env.SWITCHBOARD_ADMIN_TOKEN = "env-sba";
    const token = await loadSwitchboardAdminToken(daemonDeps({ switchboardAdminToken: "daemon-sba" }));
    expect(token).toBe("env-sba");
  });

  test("loadSwitchboardAdminToken falls back to the daemon", async () => {
    delete process.env.SWITCHBOARD_ADMIN_TOKEN;
    const token = await loadSwitchboardAdminToken(daemonDeps({ switchboardAdminToken: "daemon-sba" }));
    expect(token).toBe("daemon-sba");
  });

  test("a gate refusal (bad-token) still degrades to null, not a throw", async () => {
    delete process.env.SLACK_TOKEN;
    const token = await loadSlackToken(refusedDeps("bad-token"));
    expect(token).toBeNull();
  });

  test("an old daemon (bad-scope) still degrades to null, not a throw", async () => {
    delete process.env.SWITCHBOARD_TOKEN;
    const token = await loadSwitchboardToken(refusedDeps("bad-scope"));
    expect(token).toBeNull();
  });
});
