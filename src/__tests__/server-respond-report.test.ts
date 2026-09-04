import { afterAll, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Proves the real (non-fixture) /respond/report route -- readRespondReport's
// wiring into server.ts -- answers 404 before a fill has saved anything and
// 200 with the markdown once it has. Same minimal boot as
// server-healthz-fast.test.ts: a fake $HOME with a team settings store, no
// config.json, no live tokens.
const fakeHome = mkdtempSync(join(tmpdir(), "board-respond-report-"));

const teamDir = join(fakeHome, ".mattstack", "teams", "testteam", "mattstack");
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, "settings.team.jsonc"),
  JSON.stringify({
    "board.gitlabHost": "https://gitlab.example.com",
    "board.projects": ["g/p"],
    "board.members": [{ username: "alice" }],
  }),
);

const PORT = 47946;
const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "server.ts")], {
  env: {
    ...process.env,
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    PORT: String(PORT),
    GITLAB_TOKEN: "",
    SLACK_TOKEN: "",
    SWITCHBOARD_TOKEN: "",
    SWITCHBOARD_ADMIN_TOKEN: "",
  },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => proc.kill());

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

const MR_URL = "https://gitlab.example.com/g/p/-/merge_requests/1";

// Mirrors respondFilePath's own slugging (src/respond-state.ts) rather than
// importing it -- that module reads APP_ROOT from this test process's own
// env at import time, which would resolve against the wrong $HOME.
function respondReportFile(mrUrl: string): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(fakeHome, "state", "responds", `${slug}.md`);
}

test("/respond/report 404s before a fill has saved anything, then serves the saved markdown", async () => {
  await ready();
  const before = await fetch(`http://127.0.0.1:${PORT}/respond/report?mr=${encodeURIComponent(MR_URL)}`);
  expect(before.status).toBe(404);

  const reportPath = respondReportFile(MR_URL);
  mkdirSync(join(reportPath, ".."), { recursive: true });
  writeFileSync(reportPath, "# adjudication\n\nreply to thread 7080da2f");

  const after = await fetch(`http://127.0.0.1:${PORT}/respond/report?mr=${encodeURIComponent(MR_URL)}`);
  expect(after.status).toBe(200);
  expect(await after.text()).toContain("reply to thread 7080da2f");
}, 15_000);

test("/respond/report requires the mr query param", async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/respond/report`);
  expect(res.status).toBe(400);
});
