import { afterAll, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Proves /slack/post's channel derivation (server.ts's targetChannel logic,
// right after `picked` resolves): with no explicit body channel, a single
// tagged-stranger MR posts into its codeowners tab's slackChannel rather than
// the board's default channel, and a multi-MR post whose picked MRs resolve to
// different channels 400s instead of guessing one. Real (non-fixture) boot --
// fixture mode answers /data.json from a canned file and refuses every POST
// outright, so it can't exercise this path at all. A fake rt daemon (unix
// socket, mirrors server-healthz-fast.test.ts's pattern) serves the picked
// MRs so cache.get() resolves without any real GitLab connectivity, and
// slack-api-mock-preload.ts (loaded via `bun --preload`) answers slack.com's
// API locally so resolveSlackRef's channel-name lookup never leaves the box.
// The mock gives each channel name its own channel id (see CHANNEL_IDS
// there), so the returned permalink's channel id is a fingerprint for which
// channel name the derivation actually picked.
const fakeHome = mkdtempSync(join(tmpdir(), "board-slack-post-channel-"));

const teamDir = join(fakeHome, ".mattstack", "teams", "testteam", "mattstack");
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, "settings.team.jsonc"),
  JSON.stringify({
    "board.gitlabHost": "https://gitlab.example.com",
    "board.projects": ["g/p"],
    "board.members": [{ username: "alice" }],
    "board.tabs": [
      { id: "team", label: "Team", source: { kind: "authors" } },
      {
        id: "acme",
        label: "Acme",
        source: { kind: "codeowners", section: "Acme" },
        slackChannel: "acme-channel",
      },
      {
        id: "other",
        label: "Other",
        source: { kind: "codeowners", section: "OtherSection" },
        slackChannel: "other-channel",
      },
    ],
  }),
);

// board.rtRepos is machine-scoped (registry-defs.ts), not team-scoped -- a
// team-store value for it is silently ignored, which would leave
// fetchTeamMRs with no daemon mapping for "g/p" and every MR dropped before
// buildBoard ever saw them.
writeFileSync(join(fakeHome, ".mattstack", "machine-key"), "testmachine");
const machineDir = join(fakeHome, ".mattstack", "user", "local", "testmachine");
mkdirSync(machineDir, { recursive: true });
writeFileSync(
  join(machineDir, "settings.local.jsonc"),
  JSON.stringify({
    "board.rtRepos": [{ project: "g/p", repo: "gitlab.example.com/g/p" }],
  }),
);

const GITLAB_HOST = "https://gitlab.example.com";
const acmeMrUrl = `${GITLAB_HOST}/g/p/-/merge_requests/501`;
const otherSectionMrUrl = `${GITLAB_HOST}/g/p/-/merge_requests/502`;

function fakePr(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: overrides.id,
    iid: overrides.iid,
    repositoryId: "gitlab:42",
    title: "An MR",
    description: null,
    state: "opened",
    draft: false,
    conflicts: false,
    webUrl: overrides.webUrl,
    sourceBranch: "feat/x",
    targetBranch: "main",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: new Date().toISOString(),
    sha: null,
    author: overrides.author,
    assignees: [],
    reviewers: [],
    roles: [],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 1,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

const acmePr = fakePr({
  id: "gitlab:501",
  iid: 501,
  webUrl: acmeMrUrl,
  author: { id: "gitlab:901", username: "outsider1", name: "Outsider One", avatarUrl: null },
});
const otherSectionPr = fakePr({
  id: "gitlab:502",
  iid: 502,
  webUrl: otherSectionMrUrl,
  author: { id: "gitlab:902", username: "outsider2", name: "Outsider Two", avatarUrl: null },
});

const rtDir = join(fakeHome, ".mattstack", "rt");
mkdirSync(rtDir, { recursive: true });

// Every mapped project's opened MRs, tagged the way the daemon reports a
// codeowners match -- see fetchTeamMRs' `entry.codeownerSections`. Every
// other command answers `ok:false` immediately (never hangs), which is what
// lets the token round trips (board-secrets.ts) degrade to "not configured"
// without a wedged wait.
const rtDaemon = Bun.serve({
  unix: join(rtDir, "rt.sock"),
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/project-mrs:read") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            mrs: {
              "gitlab:501": { pr: acmePr, fetchedAt: Date.now(), codeownerSections: ["Acme"] },
              "gitlab:502": { pr: otherSectionPr, fetchedAt: Date.now(), codeownerSections: ["OtherSection"] },
            },
            listSyncedAt: Date.now(),
            source: "poll",
            syncedAt: Date.now(),
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: false, error: "not implemented" }), {
      headers: { "content-type": "application/json" },
    });
  },
});

const PORT = 47946;
const proc = Bun.spawn(
  [
    "bun",
    "run",
    "--preload",
    join(import.meta.dir, "slack-api-mock-preload.ts"),
    join(import.meta.dir, "..", "server.ts"),
  ],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      GITLAB_TOKEN: "",
      SLACK_TOKEN: "fake-slack-token",
      SWITCHBOARD_TOKEN: "",
      SWITCHBOARD_ADMIN_TOKEN: "",
      // Consumed by slack-api-mock-preload.ts's conversations.history stub.
      SLACK_MOCK_MR_URL: acmeMrUrl,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);

afterAll(() => {
  proc.kill();
  rtDaemon.stop(true);
});

async function ready(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server never came up");
}

test("/slack/post with no explicit channel derives a tagged stranger's MR to its tab's slackChannel", async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/post`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mrUrls: [acmeMrUrl] }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; linked?: boolean; permalink?: string };
  expect(body.ok).toBe(true);
  // C_ACME is "acme-channel"'s id in the mock (see CHANNEL_IDS in
  // slack-api-mock-preload.ts) -- proves the post targeted the tab's channel,
  // not C_DEFAULT ("code-review", config.slack.channel).
  expect(body.permalink).toContain("C_ACME");
}, 15_000);

test("/slack/post with no explicit channel 400s when picked MRs span different channels", async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/slack/post`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mrUrls: [acmeMrUrl, otherSectionMrUrl] }),
  });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe("MRs span Slack channels; post them per tab");
}, 15_000);
