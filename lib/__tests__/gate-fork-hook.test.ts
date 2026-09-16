// PreToolUse hook (matcher AskUserQuestion): see docs/superpowers/specs/
// 2026-09-11-executor-reconciler-design.md "AskUserQuestion hook" / "Hook
// contract". Driven as a real subprocess against a stub `rt` on PATH so the
// decision branches (daemon down, missing CLI, open/parked/closed gate)
// exercise the actual script rather than a reimplementation of its logic.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const HOOK_PATH = resolve(import.meta.dir, "..", "..", "scripts", "hooks", "gate-fork.sh");
const SUBJECT = "mr:https://gitlab.example.com/acme/widget/-/merge_requests/42";
// Standard system dirs only: no custom `rt` install lives here, so a
// subprocess given just this PATH can never resolve the real CLI.
const PATH_WITHOUT_RT = "/usr/bin:/bin:/usr/sbin:/sbin";

function gateRow(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "g1", subject: SUBJECT, kind: "human", questions: [], meta: null,
    status, answer: null, openedAt: 1, parkedAt: null, closedAt: null,
    closedReason: null, supersededBy: null, agent: null, pane: null,
    nudge: null, delivery: null, released: false, owner: "human", escalatedAt: null,
    ...overrides,
  };
}

/** Writes a stub `rt` executable that always prints `body` (a single JSON
 *  line, matching `rt gate list`'s own output shape) and exits `exitCode`.
 *  Returns a PATH string with the stub ahead of the real system dirs. */
function pathWithStubRt(body: string, exitCode: number): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-fork-hook-")));
  const script = `#!/bin/sh\ncat <<'EOF'\n${body}\nEOF\nexit ${exitCode}\n`;
  const rtPath = join(dir, "rt");
  writeFileSync(rtPath, script);
  chmodSync(rtPath, 0o755);
  return `${dir}:${PATH_WITHOUT_RT}`;
}

/** Writes a stub `rt` executable that checks its full $* against each route's
 *  match substring in order and prints the first hit's body (default exit 0);
 *  no route hit prints {"ok":true,"gates":[],"cursor":0}. Returns a PATH
 *  string with the stub ahead of the real system dirs. */
function pathWithStubRtRouting(
  routes: Array<{ match: string; body: string; exitCode?: number }>
): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-fork-hook-")));
  let script = "#!/bin/sh\ncase \"$*\" in\n";

  // route.match may contain spaces (e.g. "--subject-prefix herd:x"); quoting
  // keeps it one case pattern word. Routes are checked in order, so list the
  // most specific match before any broader prefix it overlaps with.
  for (const route of routes) {
    script += `  *"${route.match}"*)\n`;
    script += `    cat <<'EOF'\n${route.body}\nEOF\n`;
    script += `    exit ${route.exitCode ?? 0}\n`;
    script += `    ;;\n`;
  }

  script += `  *)\n`;
  script += `    cat <<'EOF'\n{"ok":true,"gates":[],"cursor":0}\nEOF\n`;
  script += `    exit 0\n`;
  script += `    ;;\n`;
  script += `esac\n`;

  const rtPath = join(dir, "rt");
  writeFileSync(rtPath, script);
  chmodSync(rtPath, 0o755);
  return `${dir}:${PATH_WITHOUT_RT}`;
}

async function runHook(path: string, subject: string): Promise<{
  stdout: string; stderr: string; exitCode: number;
}> {
  const proc = Bun.spawn([HOOK_PATH], {
    env: {
      ...process.env,
      PATH: path,
      RT_AGENT_ID: "agent-1",
      RT_GATE_SUBJECT: subject,
      RT_DAEMON_SOCK: join(tmpdir(), "gate-fork-hook-unused.sock"),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const ALLOW = {
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
};

describe("scripts/hooks/gate-fork.sh", () => {
  test("daemon unreachable (rt exits nonzero): allow", async () => {
    const path = pathWithStubRt(JSON.stringify({ ok: false, error: "rt daemon unreachable" }), 1);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("rt CLI missing from PATH: allow", async () => {
    const { stdout, exitCode } = await runHook(PATH_WITHOUT_RT, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("open gate exists for the subject: allow", async () => {
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [gateRow("open")], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("parked gate exists for the subject: allow", async () => {
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [gateRow("parked")], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("no open/parked gate for the subject: deny, naming rt gate ask and the subject", async () => {
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    const reason: string = parsed.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("rt gate ask");
    expect(reason).toContain(SUBJECT);
  });

  test("closed gate for the subject, no open/parked sibling: deny", async () => {
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [gateRow("closed")], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("a same-prefix sibling subject's open status never leaks into this subject's decision", async () => {
    const mine = gateRow("closed", { id: "g1" });
    const sibling = gateRow("open", { id: "g2", subject: `${SUBJECT}-sibling` });
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [mine, sibling], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("an open multi-question gate (multi tiers question with object options, plus a single outcome question) allows", async () => {
    const questions = [
      {
        id: "tiers", label: "Which tiers", multi: true,
        options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }],
      },
      { id: "outcome", label: "Outcome", multi: false, options: ["approve", "reject"] },
    ];
    const mine = gateRow("open", { id: "g1", questions });
    const path = pathWithStubRt(JSON.stringify({ ok: true, gates: [mine], cursor: 0 }), 0);
    const { stdout, exitCode } = await runHook(path, SUBJECT);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("RT-162 finding 2: an open run-gate in this worktree now allows", async () => {
    const herdSubject = "herd:hoki-x/cv-2492-attorney";
    const runGate = JSON.stringify({
      ok: true, cursor: 0,
      gates: [gateRow("open", {
        id: "g-run", subject: "run:r1", kind: "plan",
        origin: { runId: "r1", worktree: process.cwd(), presentation: "form", paneId: "w1:p1" },
        owner: "herd:hoki-x",
      })],
    });
    const path = pathWithStubRtRouting([
      { match: `--subject-prefix ${herdSubject}`, body: '{"ok":true,"gates":[],"cursor":0}' },
      { match: "--subject-prefix run:", body: runGate },
    ]);
    const { stdout, exitCode } = await runHook(path, herdSubject);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("an open run-gate in a DIFFERENT worktree still denies", async () => {
    const herdSubject = "herd:hoki-x/cv-2492-attorney";
    const runGate = JSON.stringify({
      ok: true, cursor: 0,
      gates: [gateRow("open", {
        id: "g-run", subject: "run:r1", kind: "plan",
        origin: { runId: "r1", worktree: `${process.cwd()}-other`, presentation: "form", paneId: "w1:p1" },
        owner: "herd:hoki-x",
      })],
    });
    const path = pathWithStubRtRouting([
      { match: `--subject-prefix ${herdSubject}`, body: '{"ok":true,"gates":[],"cursor":0}' },
      { match: "--subject-prefix run:", body: runGate },
    ]);
    const { stdout, exitCode } = await runHook(path, herdSubject);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  // Two rows in one payload: this worktree closed, another worktree open. Proves
  // the awk row-split is load-bearing -- without it the unsplit blob still
  // contains both this worktree's string and an "open" status as substrings.
  test("a closed run-gate in this worktree plus an open one elsewhere never combine into a false allow", async () => {
    const herdSubject = "herd:hoki-x/cv-2492-attorney";
    const mine = gateRow("closed", {
      id: "g-run-mine", subject: "run:r1", kind: "plan",
      origin: { runId: "r1", worktree: process.cwd(), presentation: "form", paneId: "w1:p1" },
      owner: "herd:hoki-x",
    });
    const other = gateRow("open", {
      id: "g-run-other", subject: "run:r2", kind: "plan",
      origin: { runId: "r2", worktree: `${process.cwd()}-other`, presentation: "form", paneId: "w1:p2" },
      owner: "herd:hoki-x",
    });
    const runGate = JSON.stringify({ ok: true, cursor: 0, gates: [mine, other] });
    const path = pathWithStubRtRouting([
      { match: `--subject-prefix ${herdSubject}`, body: '{"ok":true,"gates":[],"cursor":0}' },
      { match: "--subject-prefix run:", body: runGate },
    ]);
    const { stdout, exitCode } = await runHook(path, herdSubject);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim()).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("the run-gate list call failing (exitCode 1) still allows: degraded mode stays legal", async () => {
    const herdSubject = "herd:hoki-x/cv-2492-attorney";
    const path = pathWithStubRtRouting([
      { match: `--subject-prefix ${herdSubject}`, body: '{"ok":true,"gates":[],"cursor":0}' },
      { match: "--subject-prefix run:", body: '{"ok":false,"error":"rt daemon unreachable"}', exitCode: 1 },
    ]);
    const { stdout, exitCode } = await runHook(path, herdSubject);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });
});
