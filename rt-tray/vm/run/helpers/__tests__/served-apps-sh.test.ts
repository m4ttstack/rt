import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GUEST_DIR, jqBin } from "./jq.ts";

const SERVED = join(GUEST_DIR, "served-apps.sh");
const APPS = [
  { name: "board", port: 11006 },
  { name: "chat", port: 11002 },
];

interface World {
  root: string;
  home: string;
  app: string;
  calls: string;
  env: Record<string, string>;
}

function lockRow(name: string, serve?: { port: number; args: string[] }) {
  return {
    name, version: "1.0.0", license: "MIT", url: "https://example.com/x.tgz", sha256: "a".repeat(64),
    archive: "tar.gz", extract: name, bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
    exposeByDefault: false, entitlements: "jit", status: "bundled", kind: "helper", ...(serve ? { serve } : {}),
  };
}

// A fake bundle, HOME, launchctl and curl: the stubs answer from files under
// root and append every call to root/calls so a test can see what ran.
function world(opts: { statusFailures?: number; deadHosts?: string[]; withLock?: boolean; restartAfterPrints?: number } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "served-apps-sh-"));
  const home = join(root, "home");
  const app = join(root, "mattstack.app");
  const calls = join(root, "calls");
  mkdirSync(join(app, "Contents", "Helpers"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  mkdirSync(join(home, ".mattstack", "deck"), { recursive: true });
  mkdirSync(join(home, ".portless"), { recursive: true });
  mkdirSync(join(root, "launchd"), { recursive: true });
  symlinkSync(jqBin(), join(app, "Contents", "Helpers", "jq"));
  if (opts.withLock !== false) {
    writeFileSync(join(app, "Contents", "Resources", "deps.lock"), JSON.stringify({
      schema: 1, arch: "arm64",
      tools: [...APPS.map((a) => lockRow(a.name, { port: a.port, args: [] })), lockRow("gitq")],
    }));
  }
  writeFileSync(join(home, ".mattstack", "deck", "api.json"), JSON.stringify({ port: 7940, pid: 1, runMode: "standalone" }));
  writeFileSync(join(home, ".portless", "routes.json"), JSON.stringify([
    ...APPS.map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 })),
    { hostname: "deck.mattstack", port: 7940, pid: 0 },
    { hostname: "board.localhost", port: 11006, pid: 0 },
  ]));
  writeFileSync(join(root, "status.json"), JSON.stringify({
    devMode: false,
    apps: APPS.map((a) => ({ name: a.name, url: `https://${a.name}.mattstack`, icon: `/api/apps/${a.name}/icon`, health: { ok: true, status: 200, ms: 1 }, managedBy: "rt", issues: [] })),
  }));
  for (const a of APPS) {
    const bin = join(app, "Contents", "Helpers", a.name);
    writeFileSync(join(root, "launchd", `com.mattstack.deck.${a.name}`),
      `gui/501/com.mattstack.deck.${a.name} = {\n\tstate = running\n\n\tprogram = ${bin}\n\targuments = {\n\t\t${bin}\n\t}\n\n\tworking directory = ${home}/.mattstack/${a.name}\n\n\tpid = 4242\n}\n`);
  }
  writeFileSync(join(root, "status-failures"), String(opts.statusFailures ?? 0));
  writeFileSync(join(root, "dead-hosts"), (opts.deadHosts ?? []).join("\n") + "\n");
  writeFileSync(join(root, "restart-after"), String(opts.restartAfterPrints ?? 1_000_000));
  const launchctl = join(root, "launchctl");
  writeFileSync(launchctl, `#!/bin/bash
echo "launchctl $*" >> "${calls}"
label="\${2##*/}"
if [ -f "${root}/launchd/$label" ]; then
  n=$(( $(cat "${root}/prints-$label" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${root}/prints-$label"
  if [ "$n" -gt "$(cat "${root}/restart-after")" ]; then sed 's/pid = 4242$/pid = 5151/' "${root}/launchd/$label"; else cat "${root}/launchd/$label"; fi
  exit 0
fi
echo "Bad request."; echo "Could not find service \\"$label\\" in domain for user gui: 501"; exit 113
`);
  const curl = join(root, "curl");
  writeFileSync(curl, `#!/bin/bash
url="\${@: -1}"
echo "curl $url" >> "${calls}"
case "$url" in
  */api/v1/status)
    n=$(cat "${root}/status-failures")
    if [ "$n" -gt 0 ]; then echo $((n - 1)) > "${root}/status-failures"; exit 7; fi
    cat "${root}/status.json";;
  https://*)
    host="\${url#https://}"
    grep -qx "$host" "${root}/dead-hosts" && exit 22
    echo ok;;
  *) exit 2;;
esac
`);
  chmodSync(launchctl, 0o755);
  chmodSync(curl, 0o755);
  return {
    root, home, app, calls,
    env: { HOME: home, PATH: "/usr/bin:/bin", SERVED_APP: app, SERVED_CURL: curl, SERVED_LAUNCHCTL: launchctl, SERVED_POLL_S: "1" },
  };
}

// Sources the helper the way the guest scripts do: the caller owns ok/bad and
// the fails counter, and the counter has to survive the helper's loops.
function run(w: World, body: string): { out: string; fails: number } {
  const script = `
set -uo pipefail
LOGS="${w.root}/logs"; mkdir -p "$LOGS"
fails=0
ok()  { echo "ASSERT ok   $1"; }
bad() { echo "ASSERT FAIL $1"; fails=$((fails+1)); }
source "${SERVED}"
${body}
echo "FAILS=$fails"
`;
  const r = Bun.spawnSync(["/bin/bash", "-c", script], { env: w.env });
  const out = r.stdout.toString() + r.stderr.toString();
  const m = out.match(/FAILS=(\d+)/);
  if (!m) throw new Error(`no FAILS line:\n${out}`);
  return { out, fails: Number(m[1]) };
}
const calls = (w: World) => (existsSync(w.calls) ? readFileSync(w.calls, "utf8") : "");
// One verdict pass spawns a dozen jq and stub processes, which takes seconds
// on a loaded host, so the polling cases outlive bun's 5s default.
const POLL_TEST_MS = 60_000;

describe("assert_served_apps", () => {
  test("a healthy bundle passes, and the bad count reaches the caller", () => {
    const w = world();
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(0);
    expect(out).toContain("ASSERT ok   board: running (pid 4242)");
    expect(out).toContain("ASSERT ok   chat: argv matches deps.lock serve.args");
    expect(out).toContain("ASSERT ok   no deps.lock tool is loaded as a deck app (checked 1)");
    expect(calls(w)).toContain("launchctl print gui/");
    expect(calls(w)).toContain("/com.mattstack.deck.gitq");
  });

  test("the expected set comes from the bundle's deps.lock, not a list in the script", () => {
    const w = world({ withLock: false });
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL cannot read the served-app catalog from");
  });

  test("it polls until deck answers inside the deadline", () => {
    const w = world({ statusFailures: 2 });
    const { fails } = run(w, "assert_served_apps served 30");
    expect(fails).toBe(0);
    expect(calls(w).match(/api\/v1\/status/g)?.length).toBe(3);
  }, POLL_TEST_MS);

  test("a deck that never answers fails once the deadline passes, with one bad line", () => {
    const w = world({ statusFailures: 99 });
    const { out, fails } = run(w, "assert_served_apps served 5");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL deck /api/v1/status did not answer with an apps list");
    expect(calls(w).match(/api\/v1\/status/g)!.length).toBeGreaterThanOrEqual(2);
  }, POLL_TEST_MS);

  test("an update leg fails a job still on its pre-update pid", () => {
    const w = world();
    const { out, fails } = run(w, 'record_served_jobs update-before\nassert_served_apps served 0 "$LOGS/update-before/launchd.json"');
    expect(fails).toBe(2);
    expect(out).toContain("ASSERT FAIL board: still the pre-update process (pid 4242)");
    expect(out).toContain("ASSERT FAIL chat: still the pre-update process (pid 4242)");
  });

  test("it polls until every app has moved off its pre-update pid", () => {
    const w = world({ restartAfterPrints: 2 });
    const { out, fails } = run(w, 'record_served_jobs update-before\nassert_served_apps served 30 "$LOGS/update-before/launchd.json"');
    expect(fails).toBe(0);
    expect(out).toContain("ASSERT ok   board: restarted since the update (pid 4242, now 5151)");
    expect(calls(w).match(/com\.mattstack\.deck\.board/g)?.length).toBe(3);
  }, POLL_TEST_MS);

  test("a missing pre-update snapshot fails rather than skipping the comparison", () => {
    const w = world();
    const { out, fails } = run(w, 'assert_served_apps served 0 "$LOGS/nope.json"');
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL no pre-update launchd snapshot at");
  });

  test("a loaded gitq label fails even though no script names gitq", () => {
    const w = world();
    writeFileSync(join(w.root, "launchd", "com.mattstack.deck.gitq"), readFileSync(join(w.root, "launchd", "com.mattstack.deck.board"), "utf8"));
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL com.mattstack.deck.gitq is loaded, but deps.lock ships gitq as a tool, never an app");
  });
});

describe("assert_mattstack_routes", () => {
  test("every .mattstack route is fetched, not just the first, and .localhost routes are not", () => {
    const w = world({ deadHosts: ["chat.mattstack"] });
    const { out, fails } = run(w, "assert_mattstack_routes trusted proxy");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT ok   board.mattstack answers over https through the proxy");
    expect(out).toContain("ASSERT FAIL chat.mattstack is routed but does not answer through the proxy");
    expect(out).toContain("ASSERT ok   deck.mattstack answers over https through the proxy");
    expect(calls(w)).not.toContain("board.localhost");
  });

  test("the untrusted mode wants every route to answer insecurely and fail trust", () => {
    const w = world();
    const { out, fails } = run(w, "assert_mattstack_routes untrusted proxy");
    expect(out).toContain("ASSERT ok   board.mattstack answers over https through the untrusted proxy");
    expect(out).toContain("ASSERT FAIL board.mattstack verified against the system trust store, so the certificate was not declined");
    expect(fails).toBe(3);
  });

  test("no .mattstack route at all is one bad line", () => {
    const w = world();
    writeFileSync(join(w.home, ".portless", "routes.json"), JSON.stringify([{ hostname: "board.localhost", port: 11006, pid: 0 }]));
    const { out, fails } = run(w, "assert_mattstack_routes trusted proxy");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL no .mattstack route in ~/.portless/routes.json for the proxy to serve");
  });
});
