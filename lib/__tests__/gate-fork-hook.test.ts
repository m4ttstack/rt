// PreToolUse hook (matcher AskUserQuestion): see docs/superpowers/specs/
// 2026-09-11-executor-reconciler-design.md "AskUserQuestion hook". The
// decision itself is `rt gate fork-check`'s (commands/gate.ts, daemon-side in
// handlers/gate.ts); these drive the real script against a stub `rt` on PATH
// to pin what the wrapper alone owns: the stdin hand-off and every
// no-verdict fallback allowing.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const HOOK_PATH = resolve(import.meta.dir, "..", "..", "scripts", "hooks", "gate-fork.sh");
// Standard system dirs only: no custom `rt` install lives here, so a
// subprocess given just this PATH can never resolve the real CLI.
const PATH_WITHOUT_RT = "/usr/bin:/bin:/usr/sbin:/sbin";

const ALLOW = {
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
};
const DENY_LINE = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "go through rt gate ask" },
});

/** A stub `rt` that records its argv and stdin next to itself, prints `body`,
    and exits `exitCode`. */
function stubRt(body: string, exitCode: number): { path: string; argvFile: string; stdinFile: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-fork-hook-")));
  dirs.push(dir);
  const argvFile = join(dir, "argv");
  const stdinFile = join(dir, "stdin");
  const script = `#!/bin/sh\nprintf '%s' "$*" > '${argvFile}'\ncat > '${stdinFile}'\ncat <<'EOF'\n${body}\nEOF\nexit ${exitCode}\n`;
  const rtPath = join(dir, "rt");
  writeFileSync(rtPath, script);
  chmodSync(rtPath, 0o755);
  return { path: `${dir}:${PATH_WITHOUT_RT}`, argvFile, stdinFile };
}

async function runHook(path: string, stdin: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn([HOOK_PATH], {
    env: { ...process.env, PATH: path, RT_AGENT_ID: "agent-1", RT_GATE_SUBJECT: "herd:acme-x/acme-1234-attorney" },
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, exitCode };
}

const PAYLOAD = JSON.stringify({
  session_id: "sess-review", cwd: "/wt/eomer", hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Proceed?", options: [] }] },
});

describe("scripts/hooks/gate-fork.sh", () => {
  test("hands the hook payload to `rt gate fork-check` on stdin and prints its verdict verbatim", async () => {
    const rt = stubRt(DENY_LINE, 0);
    const { stdout, exitCode } = await runHook(rt.path, PAYLOAD);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${DENY_LINE}\n`);
    expect(readFileSync(rt.argvFile, "utf8")).toBe("gate fork-check");
    expect(readFileSync(rt.stdinFile, "utf8")).toBe(PAYLOAD);
  });

  test("an allow verdict passes through", async () => {
    const rt = stubRt(JSON.stringify(ALLOW), 0);
    const { stdout } = await runHook(rt.path, PAYLOAD);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("a payload far past a pipe buffer is drained and handed over whole", async () => {
    const big = JSON.stringify({ session_id: "s", tool_input: { pad: "x".repeat(256 * 1024) } });
    const rt = stubRt(DENY_LINE, 0);
    const { stdout } = await runHook(rt.path, big);
    expect(stdout).toBe(`${DENY_LINE}\n`);
    expect(readFileSync(rt.stdinFile, "utf8")).toBe(big);
  });

  test("rt CLI missing from PATH: allow", async () => {
    const { stdout, exitCode } = await runHook(PATH_WITHOUT_RT, PAYLOAD);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("fork-check exiting nonzero: allow", async () => {
    const rt = stubRt('{"ok":false,"error":"boom"}', 1);
    const { stdout, exitCode } = await runHook(rt.path, PAYLOAD);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("an rt that predates the verb and prints usage with exit 0: allow, never the usage text", async () => {
    const rt = stubRt("usage: rt gate <open|ask|answer|wait|list>", 0);
    const { stdout } = await runHook(rt.path, PAYLOAD);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });

  test("fork-check printing nothing: allow", async () => {
    const rt = stubRt("", 0);
    const { stdout } = await runHook(rt.path, PAYLOAD);
    expect(JSON.parse(stdout.trim())).toEqual(ALLOW);
  });
});
