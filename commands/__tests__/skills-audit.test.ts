import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditJsonPayload, buildAuditInvocation, buildAuditPrompt, resolveAuditInputs, skillsAudit } from "../skills-audit.ts";
import { buildClaudeArgv } from "../../lib/agent-argv/claude.ts";

const paths = ["/p/skills/ship/SKILL.md", "/p/attachments/f/SKILL.md"];
const tools = [{ name: "git_push", description: "Push the tree's current branch." }, { name: "mr_create", description: "Create an MR." }];
const SESSION = "11111111-1111-4111-8111-111111111111";

describe("buildAuditPrompt", () => {
  test("names every file path and every tool with its description, and no file text", () => {
    const p = buildAuditPrompt(paths, tools);
    for (const f of paths) expect(p).toContain(f);
    for (const t of tools) { expect(p).toContain(t.name); expect(p).toContain(t.description); }
    expect(p).toContain("Read each file");
  });
  test("asks for the three pattern-proof findings and a per-finding file:line", () => {
    const p = buildAuditPrompt(paths, tools);
    expect(p).toContain("plain words");
    expect(p).toContain("shell variables");
    expect(p).toContain("wrapped");
    expect(p).toContain("file:line");
  });
  test("stays small however large the pack is", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `/p/attachments/f${i}/SKILL.md`);
    expect(buildAuditPrompt(many, tools).length).toBeLessThan(120_000);
  });
});

describe("buildAuditInvocation", () => {
  const LOCKDOWN = ["--tools=Read", "--allowedTools=Read", "--strict-mcp-config", "--permission-mode=dontAsk", "--setting-sources=user"];

  test("is a headless claude run with the prompt, Read only, no bypass, no account", () => {
    const inv = buildAuditInvocation("PROMPT", SESSION);
    expect(inv).toMatchObject({ headless: true, prompt: "PROMPT", session: { kind: "start", sessionId: SESSION }, yolo: false });
    expect(inv.extraArgs).toBe(LOCKDOWN.join(" "));
    const argv = buildClaudeArgv(inv, { claude: "/bin/claude" });
    expect(argv[0]).toBe("/bin/claude");
    expect(argv).toContain("-p");
    expect(argv.slice(argv.indexOf("--output-format"), argv.indexOf("--output-format") + 2)).toEqual(["--output-format", "json"]);
    for (const token of LOCKDOWN) expect(argv).toContain(token);
    expect(argv.at(-1)).toBe("PROMPT");
    expect(argv.some((a) => a.includes("dangerously"))).toBe(false);
    expect(inv.account).toBeUndefined();
  });

  test("every lockdown flag is one --flag or --flag=value token, so no variadic option can take the prompt", () => {
    const argv = buildClaudeArgv(buildAuditInvocation("PROMPT", SESSION), { claude: "/bin/claude" });
    const start = argv.indexOf(LOCKDOWN[0]!);
    expect(argv.slice(start, start + LOCKDOWN.length)).toEqual(LOCKDOWN);
    expect(argv.slice(start + LOCKDOWN.length)).toEqual(["PROMPT"]);
  });
});

describe("auditJsonPayload", () => {
  test("carries claude's exit code beside the report and stays advisory", () => {
    const p = auditJsonPayload({ pack: "acme", packDir: "/p" }, ["skills/x/SKILL.md"], "findings: 0", 3);
    expect(p).toEqual({ pack: "acme", packDir: "/p", files: ["skills/x/SKILL.md"], report: "findings: 0", advisory: true, claudeExit: 3 });
  });
});

/** Mocks process.exit to throw a sentinel so the real test process never
    dies, and reads the spies' recorded calls before mockRestore() (bun's
    mockRestore() clears .mock.calls). Matches commands/__tests__/deps.test.ts. */
async function runCapturingExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[] }> {
  const errors: string[] = [];
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await fn();
    return { exitCode: undefined, errors };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors };
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}

describe("resolveAuditInputs", () => {
  test("no --pack or --pack-dir: ok:false, one-line message", async () => {
    const r = await resolveAuditInputs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("rt skills audit: pass --pack <name> or --pack-dir <dir>");
  });

  test("a --pack-dir that does not exist: ok:false, checkPack's SkillsUsageError caught rather than thrown", async () => {
    const r = await resolveAuditInputs(["--pack-dir", "/definitely/does/not/exist/rt-skills-audit-test"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message.startsWith("rt skills audit: ")).toBe(true);
      expect(r.message).toContain("not an existing directory");
    }
  });

  test("a resolvable pack dir but no claude binary: ok:false, injected resolver never touches real PATH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-skills-audit-"));
    try {
      const r = await resolveAuditInputs(["--pack-dir", dir], () => null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe("rt skills audit: no claude binary on PATH; the audit needs a Claude login");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skillsAudit exit paths", () => {
  test("no --pack or --pack-dir exits 2 with a clean one-line message", async () => {
    const { exitCode, errors } = await runCapturingExit(() => skillsAudit([]));
    expect(exitCode).toBe(2);
    expect(errors).toEqual(["rt skills audit: pass --pack <name> or --pack-dir <dir>"]);
  });

  test("an unresolvable --pack-dir exits 2, not the uncaught SkillsUsageError's exit 1 + stack trace", async () => {
    const { exitCode, errors } = await runCapturingExit(() =>
      skillsAudit(["--pack-dir", "/definitely/does/not/exist/rt-skills-audit-test"]),
    );
    expect(exitCode).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("not an existing directory");
  });
});
