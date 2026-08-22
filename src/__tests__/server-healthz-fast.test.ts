import { afterAll, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// Proves src/server.ts:452ish's hoist: /healthz, /events, and the static
// shell/assets must answer even when the rt daemon is wedged (accepts the
// connection, never responds) -- the exact condition /healthz exists to let
// an operator detect. Real (non-fixture) boot, fully isolated: a fake $HOME
// with a team settings store (no config.json needed, and none written --
// see config.ts's storeOwnsRequiredFields) and a fake daemon socket that
// never answers, so this never touches the real ~/.mattstack or a real
// daemon.
const fakeHome = mkdtempSync(join(tmpdir(), "board-healthz-fast-"));

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

const rtDir = join(fakeHome, ".mattstack", "rt");
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, "api-token"), "fake-token\n");

// Accepts the unix-socket connection but never answers -- board-secrets.ts's
// rtCommand call only gives up after its own 15s AbortSignal.timeout.
const wedgedDaemon = Bun.serve({
  unix: join(rtDir, "rt.sock"),
  fetch: () => new Promise<Response>(() => {}),
});

const PORT = 47943;
const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "server.ts")], {
  env: {
    ...process.env,
    HOME: fakeHome,
    PORT: String(PORT),
    // Force every token through the (wedged) daemon path -- a token
    // inherited from the developer's own shell env would skip it and let
    // this test pass for the wrong reason.
    GITLAB_TOKEN: "",
    SLACK_TOKEN: "",
    SWITCHBOARD_TOKEN: "",
    SWITCHBOARD_ADMIN_TOKEN: "",
  },
  stdout: "pipe",
  stderr: "pipe",
});

afterAll(() => {
  proc.kill();
  wedgedDaemon.stop(true);
});

test("/healthz responds fast even with a wedged rt daemon blocking every board-secret round trip", async () => {
  const start = Date.now();
  let res: Response | undefined;
  for (let i = 0; i < 100; i++) {
    try {
      res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) break;
    } catch {
      // server not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const elapsed = Date.now() - start;
  expect(res?.ok).toBe(true);
  expect(await res!.text()).toBe("ok");
  // The wedged daemon never answers; the pre-fix code awaited it (15s
  // timeout, per token getter) before even reaching the /healthz case.
  // 8s leaves generous CI/subprocess-startup margin while still failing
  // loudly if that wait ever comes back.
  expect(elapsed).toBeLessThan(8_000);
}, 20_000);
